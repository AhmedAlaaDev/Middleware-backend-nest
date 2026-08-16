import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';

import { CashJournalRoute } from '@/modules/cash/services/cash-journal-routing.service';
import { dfoErrorMessage } from '@/modules/d365fo/errors/dfo-api.error';
import { DataBatchStatus } from '@/modules/data-batch/enums/data-batch.enum';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';
import { OperationalLoggerService } from '@/modules/observability/services/operational-logger.service';
import { TraceContextService } from '@/modules/observability/services/trace-context.service';
import { QUEUES } from '@/modules/queue/constants/queues';
import {
  CashJournalPostingGroup,
  PostCustomerPaymentJournalDFOJobPayload,
  RoutedCashJournalPostingGroup,
} from '@/modules/queue/contracts/post-customer-payment-journal-dfo-job.contract';
import { QueueJobGroupStatus } from '@/modules/queue/schemas/queue-job-group.schema';
import { BatchPostingControlService } from '@/modules/queue/services/batch-posting-control.service';
import { PostingErrorCollector } from '@/modules/queue/services/posting-error-collector.service';
import { QueueJobStoreService } from '@/modules/queue/services/queue-job-store.service';
import { CashJournalPostingStrategy } from '@/modules/queue/strategies/cash-journal-posting.strategy';
import { CustomerPaymentJournalPostingStrategy } from '@/modules/queue/strategies/customer-payment-journal-posting.strategy';
import { IDfoPostingStrategy } from '@/modules/queue/strategies/dfo-posting-strategy.interface';

const LINE_CHUNK_SIZE = 20;

interface RoutedCreatedHeader {
  headerKey: string;
  dataAreaId: string;
  route?: CashJournalRoute;
}

/** Why the worker stopped walking the journals of a batch. */
type PostGroupsOutcome = 'completed' | 'paused';

@Processor(QUEUES.DFO_CUSTOMER_PAYMENT_JOURNAL, { concurrency: 1 })
export class PostCustomerPaymentJournalDFOProcessor extends WorkerHost {
  constructor(
    private readonly strategy: CustomerPaymentJournalPostingStrategy,
    private readonly cashJournalStrategy: CashJournalPostingStrategy,
    private readonly batches: DataBatchService,
    private readonly jobs: QueueJobStoreService,
    private readonly logs: OperationalLoggerService,
    private readonly trace: TraceContextService,
    private readonly pauseControl: BatchPostingControlService,
  ) {
    super();
  }

  process(job: Job<PostCustomerPaymentJournalDFOJobPayload>): Promise<void> {
    return this.trace.run(
      {
        correlationId: job.data.correlationId,
        batchId: job.data.batchId,
        jobId: String(job.id),
        queueName: QUEUES.DFO_CUSTOMER_PAYMENT_JOURNAL,
      },
      () => this.processJob(job),
    );
  }

  private async processJob(
    job: Job<PostCustomerPaymentJournalDFOJobPayload>,
  ): Promise<void> {
    const jobId = String(job.id);
    const collector = new PostingErrorCollector();
    const legacyGroups = (
      job.data as PostCustomerPaymentJournalDFOJobPayload & {
        groupedJournals?: CashJournalPostingGroup[];
      }
    ).groupedJournals;
    if (legacyGroups?.length) {
      await this.jobs.prepare({
        ...job.data,
        correlationId: job.data.correlationId ?? job.data.batchId,
        payloadVersion: job.data.payloadVersion,
        jobId,
        queueName: QUEUES.DFO_CUSTOMER_PAYMENT_JOURNAL,
        jobName: job.name,
        groups: legacyGroups,
      });
    }
    await this.jobs.markActive(jobId, job.attemptsMade);
    await this.emit('queue.job.active', 'active');
    try {
      if ((await this.postGroups(job)) === 'paused') return;
      await this.jobs.markCompleted(jobId);
      await this.emit('queue.job.completed', 'completed');
    } catch (error) {
      const message = dfoErrorMessage(error);
      collector.addHeaderError(message, 'Job processing');
      const finalAttempt = this.isFinalAttempt(job);
      if (finalAttempt) {
        await this.jobs.markFailed(jobId, message);
        await this.failBatch(job.data.batchId, collector);
      } else {
        await this.jobs.markRetrying(jobId, message);
      }
      await this.emit(
        finalAttempt ? 'queue.job.failed' : 'queue.job.retrying',
        finalAttempt ? 'failed' : 'retrying',
        error,
      );
      throw error;
    }
  }

  private async postGroups(
    job: Job<PostCustomerPaymentJournalDFOJobPayload>,
  ): Promise<PostGroupsOutcome> {
    const jobId = String(job.id);
    const groups = await this.jobs.listGroups<CashJournalPostingGroup>(jobId);
    if (!groups.length) throw new Error('No durable customer payment groups');
    // Headers created in this attempt (or reused from a prior attempt). Finance
    // owns FO cleanup on failure; we keep these IDs so retry can resume.
    const created: RoutedCreatedHeader[] = [];
    const deferredSettlementErrors: Error[] = [];
    let completedGroups = groups.filter(
      (record) => record.status === QueueJobGroupStatus.COMPLETED,
    ).length;

    for (const record of groups) {
      const routedGroup = this.asRoutedGroup(record.payload);
      if (job.data.payloadVersion === 2 && !routedGroup) {
        throw new Error(
          'Cash journal payload version 2 requires route metadata for every group',
        );
      }
      const postingStrategy = this.selectStrategy(
        routedGroup,
        job.data.cashDirection ?? 'in',
      );
      if (record.status === QueueJobGroupStatus.COMPLETED) {
        // A deployment may stop after a group is durably completed but before
        // the batch is finalized. Re-read Finance on resume instead of blindly
        // trusting the old journal number.
        if (routedGroup && record.createdHeaderId) {
          await this.verifyRoutedJournalIntegrity(
            record.createdHeaderId,
            job.data.company,
            record.payload.lines,
            routedGroup.integrationMarker,
          );
        }
        continue;
      }
      // Checked between journals, never inside one: completed journals and any
      // already-posted FO patches stay in place for a later resume/retry.
      if (await this.pauseControl.isPaused(job.data.batchId)) {
        await this.pauseControl.recordWorkerStopped({
          batchId: job.data.batchId,
          jobId,
          queueName: QUEUES.DFO_CUSTOMER_PAYMENT_JOURNAL,
          completedGroups,
          totalGroups: groups.length,
        });
        return 'paused';
      }
      await this.jobs.markGroupActive(jobId, record.index);

      try {
        const persistedHeaderId = record.createdHeaderId;
        let headerId = persistedHeaderId;
        let linesAlreadyComplete = false;

        // Recover from a crash between Finance header creation and Mongo
        // persistence by the exact upload marker. Never guess when Finance
        // contains more than one header for the same marker.
        if (routedGroup?.integrationMarker) {
          const markerHeaders = postingStrategy.findHeadersByIntegrationMarker
            ? await postingStrategy.findHeadersByIntegrationMarker(
                routedGroup.integrationMarker,
                job.data.company,
              )
            : [];
          if (markerHeaders.length > 1) {
            throw new Error(
              `[DATA INTEGRITY] Integration marker ${routedGroup.integrationMarker} exists on multiple Finance journals (${markerHeaders.join(', ')}). No journal was selected and no new journal was created.`,
            );
          }
          if (markerHeaders.length === 1) {
            headerId = markerHeaders[0];
            if (record.createdHeaderId !== headerId) {
              await this.jobs.setCreatedHeader(jobId, record.index, headerId);
            }
          }
        }

        if (headerId && routedGroup) {
          const state = await this.cashJournalStrategy.getJournalIntegrityState(
            headerId,
            job.data.company,
          );
          if (!state.headerExists) {
            headerId = undefined;
          } else if (
            routedGroup.integrationMarker &&
            !this.hasIntegrationMarker(
              state.headerDescription,
              routedGroup.integrationMarker,
            )
          ) {
            // The number was deleted and later reused by Finance. Never post
            // into or delete that unrelated journal; create a fresh header.
            headerId = undefined;
          } else if (state.lineCount >= record.payload.lines.length) {
            await this.verifyRoutedJournalIntegrity(
              headerId,
              job.data.company,
              record.payload.lines,
              routedGroup.integrationMarker,
            );
            linesAlreadyComplete = true;
          }
        } else if (headerId && postingStrategy.headerExists) {
          const exists = await postingStrategy.headerExists(
            headerId,
            job.data.company,
          );
          if (!exists) {
            headerId = undefined;
          }
        }
        if (!headerId) {
          if (routedGroup && postingStrategy.assertNoExternalSettlementOwners) {
            await postingStrategy.assertNoExternalSettlementOwners(
              record.payload.lines,
              job.data.company,
            );
          }
          headerId = await this.createAndTrackHeader(
            postingStrategy,
            record.payload.header,
            created,
            jobId,
            record.index,
            job.data.company,
            routedGroup?.route,
          );
        } else {
          created.push({
            headerKey: headerId,
            dataAreaId: job.data.company,
            route: routedGroup?.route,
          });
        }
        // SpecTrans self-cite recovery deletes the journal and throws
        // "was not found"; recreate and rematch. FO may reuse the same
        // journal number after delete, so allow a couple of recreates
        // in-process before bubbling to BullMQ.
        const maxHeaderRecreates = 2;
        for (let recreate = 0; !linesAlreadyComplete; recreate++) {
          try {
            await postingStrategy.postLinesForHeader(
              headerId,
              record.payload.lines,
              job.data.company,
              LINE_CHUNK_SIZE,
            );
            if (routedGroup) {
              await this.verifyRoutedJournalIntegrity(
                headerId,
                job.data.company,
                record.payload.lines,
                routedGroup.integrationMarker,
              );
            }
            break;
          } catch (error) {
            if (
              recreate >= maxHeaderRecreates ||
              !this.isMissingPersistedHeaderError(error, headerId)
            ) {
              throw error;
            }

            const staleHeaderKey = headerId;
            const staleHeaderIndex = created.findIndex(
              (header) => header.headerKey === staleHeaderKey,
            );
            if (staleHeaderIndex >= 0) created.splice(staleHeaderIndex, 1);

            headerId = await this.createAndTrackHeader(
              postingStrategy,
              record.payload.header,
              created,
              jobId,
              record.index,
              job.data.company,
              routedGroup?.route,
            );
          }
        }
        await this.jobs.completeGroup(jobId, record.index);
        completedGroups += 1;
        await job.updateProgress({
          completedGroups: record.index + 1,
          totalGroups: groups.length,
        });
      } catch (error) {
        // Do not roll back FO journals/lines: the finance backend owns cleanup.
        // Keep completed groups and persisted header IDs so BullMQ retry resumes
        // from the failed journal and skips FO patches that already posted.
        if (created.length) {
          await this.storeHeaderIds(
            job.data.batchId,
            created.map((header) => header.headerKey),
          );
        }
        if (this.isIndependentSettlementIntegrityError(error)) {
          deferredSettlementErrors.push(
            error instanceof Error ? error : new Error(dfoErrorMessage(error)),
          );
          continue;
        }
        throw error;
      }
    }
    if (deferredSettlementErrors.length > 0) {
      if (created.length) {
        await this.storeHeaderIds(
          job.data.batchId,
          created.map((header) => header.headerKey),
        );
      }
      throw new Error(
        `${deferredSettlementErrors.map((error) => error.message).join(' | ')} Remaining independent journal groups were processed; retry will revisit only unresolved groups.`,
      );
    }
    await this.completeBatch(job.data.batchId, [
      ...groups
        .map((group) => group.createdHeaderId)
        .filter((id): id is string => Boolean(id)),
      ...created.map((header) => header.headerKey),
    ]);
    return 'completed';
  }

  private isIndependentSettlementIntegrityError(error: unknown): boolean {
    const message = dfoErrorMessage(error);
    return (
      message.includes('[DATA INTEGRITY]') &&
      message.includes('invoice settlement mismatch')
    );
  }

  private async createAndTrackHeader(
    strategy: IDfoPostingStrategy,
    headerRequest: unknown,
    created: RoutedCreatedHeader[],
    jobId: string,
    groupIndex: number,
    dataAreaId: string,
    route?: CashJournalRoute,
  ): Promise<string> {
    const result = await strategy.postHeadersInBatches([headerRequest], 1);
    if (result.headerIds.length !== 1 || !result.headerIds[0]?.trim()) {
      throw new Error('D365FO did not return one payment header ID');
    }

    const headerId = result.headerIds[0];
    // Persist the FO journal number before posting lines so a later retry can
    // reuse this header instead of creating a duplicate.
    created.push({ headerKey: headerId, dataAreaId, route });
    await this.jobs.setCreatedHeader(jobId, groupIndex, headerId);
    return headerId;
  }

  private isMissingPersistedHeaderError(
    error: unknown,
    headerId: string,
  ): boolean {
    const message = dfoErrorMessage(error).toLowerCase();
    return message.includes(`journal ${headerId.toLowerCase()} was not found`);
  }

  private async verifyRoutedJournalIntegrity(
    headerId: string,
    dataAreaId: string,
    expectedLines: unknown[],
    integrationMarker?: string,
  ): Promise<void> {
    const expectedLineCount = expectedLines.length;
    let actualLineCount = 0;
    for (let attempt = 0; attempt < 4; attempt++) {
      const state = await this.cashJournalStrategy.getJournalIntegrityState(
        headerId,
        dataAreaId,
      );
      actualLineCount = state.lineCount;
      if (
        state.headerExists &&
        integrationMarker &&
        !this.hasIntegrationMarker(state.headerDescription, integrationMarker)
      ) {
        throw new Error(
          `[DATA INTEGRITY] Journal ${headerId} belongs to a different Finance transaction: expected integration marker [${integrationMarker}], found description "${state.headerDescription ?? ''}". No lines were posted to that journal.`,
        );
      }
      if (state.headerExists && actualLineCount === expectedLineCount) {
        await this.cashJournalStrategy.assertJournalSettlementIntegrity(
          headerId,
          expectedLines,
          dataAreaId,
        );
        return;
      }
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw this.integrityError(headerId, expectedLineCount, actualLineCount);
  }

  private hasIntegrationMarker(
    description: string | undefined,
    integrationMarker: string,
  ): boolean {
    return String(description ?? '').includes(`[${integrationMarker}]`);
  }

  private integrityError(
    headerId: string,
    expectedLineCount: number,
    actualLineCount: number,
  ): Error {
    return new Error(
      `[DATA INTEGRITY] Journal ${headerId} was not confirmed in D365FO exactly once: expected ${expectedLineCount} line(s), found ${actualLineCount}. The batch was not marked Posted and no new journal was created.`,
    );
  }

  private asRoutedGroup(
    group: CashJournalPostingGroup,
  ): RoutedCashJournalPostingGroup | undefined {
    if (!('route' in group) || !group.route) return undefined;
    return group;
  }

  private selectStrategy(
    routedGroup: RoutedCashJournalPostingGroup | undefined,
    legacyDirection: 'in' | 'out',
  ): IDfoPostingStrategy {
    if (routedGroup) {
      this.cashJournalStrategy.setRouteContext(routedGroup.route);
      return this.cashJournalStrategy;
    }

    // Backward compatibility for durable jobs created before task 2045.
    this.strategy.setHeaderCashDirectionContext(legacyDirection);
    return this.strategy;
  }

  private async completeBatch(
    batchId: string,
    headerIds: string[],
  ): Promise<void> {
    // Completion is authoritative: only the header currently attached to each
    // durable group belongs in the user-facing DFO ID list. Earlier recovery
    // attempts are retained during failures for cleanup, but must not remain
    // mixed with the final journals after all groups are verified.
    await this.batches.updateDfoIdsAsync(batchId, [
      ...new Set(headerIds.filter((id) => Boolean(id.trim()))),
    ]);
    await this.batches.clearDfoPostingErrorsAsync(batchId);
    await this.batches.clearDfoAttemptedIdsAsync(batchId);
    await this.batches.updateStatusAsync(batchId, DataBatchStatus.Posted);
  }

  private async failBatch(
    batchId: string,
    collector: PostingErrorCollector,
  ): Promise<void> {
    await this.batches.updateDfoPostingErrorsAsync(
      batchId,
      collector.getFormattedErrorMessages(),
    );
    await this.batches.updateStatusAsync(batchId, DataBatchStatus.Canceled);
  }

  private async storeHeaderIds(
    batchId: string,
    headerIds: string[],
  ): Promise<void> {
    if (!headerIds.length) return;
    const batch = await this.batches.getByIdAsync(batchId);
    await this.batches.updateDfoAttemptedIdsAsync(batchId, [
      ...new Set([...(batch?.dfoAttemptedIds ?? []), ...headerIds]),
    ]);
  }

  private isFinalAttempt(job: Job): boolean {
    return job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
  }

  private emit(
    eventType: string,
    status: string,
    error?: unknown,
  ): Promise<void> {
    return this.logs.emit({
      level: error ? 'error' : 'info',
      message: `Customer payment job ${status}`,
      context: PostCustomerPaymentJournalDFOProcessor.name,
      eventType,
      status,
      error:
        error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : undefined,
    });
  }
}
