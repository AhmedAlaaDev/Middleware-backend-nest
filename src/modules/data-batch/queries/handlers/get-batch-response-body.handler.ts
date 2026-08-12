import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { Types } from 'mongoose';

import { GetBatchResponseBodyQuery } from '@/modules/data-batch/queries/get-batch-response-body.query';
import {
  DataBatchErrorRepository,
  DataBatchRepository,
  DataEnhancedRecordRepository,
} from '@/modules/data-batch/repositories/interfaces';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';
import { D365FOClientService } from '@/modules/d365fo/services/d365fo-client.service';
import { ApplicationLogQueryService } from '@/modules/observability/services/application-log-query.service';

export interface IBatchResponseBodyResult {
  journalBatchNumber?: string;
  batchId: string;
  batch: any | null;
  inputContract?: any;
  enhancedRecords?: any[];
  dfoResponse?: Record<string, any>;
  dfoIds: string[];
  dfoPostingErrors: string[];
  logsCount: number;
  logs: any[];
  batchErrors: any[];
}

@Injectable()
@QueryHandler(GetBatchResponseBodyQuery)
export class GetBatchResponseBodyHandler
  implements IQueryHandler<GetBatchResponseBodyQuery>
{
  private readonly logger = new Logger(GetBatchResponseBodyHandler.name);

  constructor(
    private readonly dataBatchService: DataBatchService,
    private readonly dataBatchRepository: DataBatchRepository,
    private readonly dataBatchErrorRepository: DataBatchErrorRepository,
    private readonly dataEnhancedRecordRepository: DataEnhancedRecordRepository,
    private readonly applicationLogQueryService: ApplicationLogQueryService,
    private readonly d365foClient: D365FOClientService,
  ) {}

  public async execute(
    query: GetBatchResponseBodyQuery,
  ): Promise<IBatchResponseBodyResult> {
    const { batchId } = query;

    let batch: any = null;
    const isObjectId = Types.ObjectId.isValid(batchId);

    // 1. Attempt to fetch batch by ID if it's a valid ObjectId, otherwise search by journal number / dfoIds
    if (isObjectId) {
      batch = await this.dataBatchService.getByIdAsync(batchId);
    }
    if (!batch) {
      const matches = await this.dataBatchRepository.getList(
        { batchNumberIds: [batchId] },
        { maxCount: 1 },
      );
      if (matches && matches.length > 0) {
        batch = matches[0];
      }
    }

    // Determine the primary journal batch number (e.g. Mesco-000013814)
    const journalBatchNumber = !isObjectId
      ? batchId
      : batch?.dfoIds?.[0] || undefined;

    // 2. Fetch live D365FO response if a journal batch number is available
    let dfoResponse: Record<string, any> = {};
    if (journalBatchNumber) {
      dfoResponse = await this.fetchDfoResponse(journalBatchNumber);
    } else if (batch?.dfoIds?.length) {
      for (const dfoId of batch.dfoIds) {
        const resp = await this.fetchDfoResponse(dfoId);
        dfoResponse = { ...dfoResponse, ...resp };
      }
    }

    // 3. Fetch logs from observability logs database
    const rawLogs = await this.applicationLogQueryService.getLogsByBatchId(batchId);

    let allLogs = rawLogs;
    if (batch && batch.id !== batchId) {
      const extraLogs = await this.applicationLogQueryService.getLogsByBatchId(batch.id);
      const logMap = new Map();
      for (const log of [...rawLogs, ...extraLogs]) {
        logMap.set(log.eventId || (log as any)._id?.toString(), log);
      }
      allLogs = Array.from(logMap.values());
    }

    const actualBatchId = batch ? batch.id : batchId;

    // 4. Fetch batch errors and enhanced input records
    let batchErrors: any[] = [];
    let enhancedRecords: any[] = [];
    if (Types.ObjectId.isValid(actualBatchId)) {
      [batchErrors, enhancedRecords] = await Promise.all([
        this.dataBatchErrorRepository.getList({ batchId: actualBatchId }),
        this.dataEnhancedRecordRepository.getList(actualBatchId).catch(() => []),
      ]);
    }

    // Extract posted _contract input payload from operational log payloads if available
    let inputContract: any = null;
    for (const log of allLogs) {
      const reqBody = (log as any)?.payload?.request?.body || (log as any)?.payload?.request;
      if (reqBody && reqBody._contract) {
        inputContract = reqBody._contract;
        break;
      }
    }

    const hasDfoData = Object.keys(dfoResponse).length > 0;
    if (!batch && !hasDfoData && allLogs.length === 0 && batchErrors.length === 0) {
      throw new NotFoundException(
        `No D365FO records, batch details, logs, or response bodies found for '${batchId}'`,
      );
    }

    return {
      journalBatchNumber,
      batchId: actualBatchId,
      inputContract,
      enhancedRecords,
      batch: batch || null,
      dfoResponse,
      dfoIds: batch?.dfoIds || (journalBatchNumber ? [journalBatchNumber] : []),
      dfoPostingErrors: batch?.dfoPostingErrors || [],
      logsCount: allLogs.length,
      logs: allLogs,
      batchErrors: batchErrors,
    };
  }

  /**
   * Fetch live response from D365FO for a journal batch number (headers + lines)
   */
  private async fetchDfoResponse(journalBatchNumber: string): Promise<Record<string, any>> {
    const results: Record<string, any> = {};
    const entityPairs = [
      { header: 'VendorPaymentJournalHeaders', lines: 'VendorPaymentJournalLines' },
      { header: 'LedgerJournalHeaders', lines: 'LedgerJournalLines' },
      { header: 'CustomerPaymentJournalHeaders', lines: 'CustomerPaymentJournalLines' },
      { header: 'VendorInvoiceHeaders', lines: 'VendorInvoiceLines' },
    ];

    for (const pair of entityPairs) {
      try {
        const headerEndpoint = `/data/${pair.header}?cross-company=true&$filter=JournalBatchNumber eq '${journalBatchNumber}'`;
        const headerRes = await this.d365foClient.get<any>(headerEndpoint, { useCache: false });

        if (headerRes && headerRes.value && headerRes.value.length > 0) {
          results[pair.header] = headerRes.value;

          try {
            const linesEndpoint = `/data/${pair.lines}?cross-company=true&$filter=JournalBatchNumber eq '${journalBatchNumber}'`;
            const linesRes = await this.d365foClient.get<any>(linesEndpoint, { useCache: false });
            const lines = linesRes?.value || [];
            
            // Enrich lines with MarkedLines array if MarkedInvoice exists
            for (const line of lines) {
              if (line.MarkedInvoice) {
                line.MarkedLines = [
                  {
                    InvoiceNumber: line.MarkedInvoice,
                    SettleVoucher: line.SettleVoucher || '',
                  },
                ];
              } else {
                line.MarkedLines = [];
              }
            }
            results[pair.lines] = lines;
          } catch (lineErr: any) {
            this.logger.warn(`Failed to fetch ${pair.lines} for ${journalBatchNumber}: ${lineErr?.message}`);
            results[pair.lines] = [];
          }
        }
      } catch (err: any) {
        this.logger.debug(`Entity ${pair.header} query skipped or failed: ${err?.message}`);
      }
    }

    return results;
  }
}
