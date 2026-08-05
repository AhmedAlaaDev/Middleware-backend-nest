import { Injectable, Logger } from '@nestjs/common';

import { CashEntryRawDataModel } from '@/modules/cash/models/cash-entry-raw-data.model';
import {
  CashJournalRoutingService,
  CashTargetProcessor,
} from '@/modules/cash/services/cash-journal-routing.service';

export type CashInResolvedProcessor = 'cash-in' | 'cash-out';

export interface CashInSafeTypeRoutingFailure {
  uniqueId: string;
  voucher: string;
  lineNumbers: Array<number | string>;
  safeTypes: string[];
  targetProcessors: string[];
  message: string;
  lines: CashEntryRawDataModel[];
}

export interface CashInSafeTypeRoutingSplit {
  cashInLines: CashEntryRawDataModel[];
  cashOutFreightLines: CashEntryRawDataModel[];
  cashOutFleetLines: CashEntryRawDataModel[];
  failures: CashInSafeTypeRoutingFailure[];
  routedCashOutUniqueIds: string[];
}

@Injectable()
export class CashInSafeTypeRoutingService {
  private readonly logger = new Logger(CashInSafeTypeRoutingService.name);

  constructor(
    private readonly cashJournalRoutingService: CashJournalRoutingService,
  ) {}

  public normalizeBusinessValue(value?: unknown): string {
    return String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/[\s_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  public isCustodySettlementSafeType(value?: unknown): boolean {
    const normalized = this.normalizeBusinessValue(value).replace(/\s+/g, '');
    return normalized === 'custodysettlement';
  }

  public resolveTargetProcessor(
    value: unknown,
    fallback?: CashTargetProcessor,
  ): CashTargetProcessor | undefined {
    const normalized = this.normalizeBusinessValue(value).replace(/\s+/g, '');
    if (normalized === 'fleet') return 'Fleet';
    if (normalized === 'freight') return 'Freight';
    return fallback;
  }

  public readTargetProcessor(line: CashEntryRawDataModel): unknown {
    return (
      line.TargetProcessor ||
      (line as any).TARGETPROCESSOR ||
      (line as any).Targetprocessor ||
      (line as any).targetProcessor
    );
  }

  /**
   * Split Cash-In Excel UniqueId groups before Cash-In-specific transforms.
   * Custody Settlement groups go to Cash-Out; others stay in Cash-In.
   */
  public splitCashInGroups(
    lines: CashEntryRawDataModel[],
    options: { defaultTargetProcessor: CashTargetProcessor },
  ): CashInSafeTypeRoutingSplit {
    const groups = new Map<string, CashEntryRawDataModel[]>();
    for (const line of lines) {
      const uniqueId = String(line.UniqueId ?? '');
      if (!groups.has(uniqueId)) groups.set(uniqueId, []);
      groups.get(uniqueId)!.push(line);
    }

    const result: CashInSafeTypeRoutingSplit = {
      cashInLines: [],
      cashOutFreightLines: [],
      cashOutFleetLines: [],
      failures: [],
      routedCashOutUniqueIds: [],
    };

    for (const [uniqueId, groupLines] of groups.entries()) {
      const voucher = String(groupLines[0]?.VOUCHER ?? '');
      const safeTypes = [
        ...new Set(
          groupLines.map((line) => String(line.SafeType ?? '').trim()).filter(Boolean),
        ),
      ];
      const rawSafeTypeTokens = [
        ...new Set(
          groupLines.map((line) =>
            this.normalizeBusinessValue(line.SafeType).replace(/\s+/g, ''),
          ),
        ),
      ];

      if (rawSafeTypeTokens.length > 1) {
        result.failures.push({
          uniqueId,
          voucher,
          lineNumbers: groupLines.map((line) => line.LINENUMBER),
          safeTypes,
          targetProcessors: groupLines.map((line) =>
            String(this.readTargetProcessor(line) ?? ''),
          ),
          message:
            'Conflicting Safe Type values were found within the same Cash-In transaction group.',
          lines: groupLines,
        });
        continue;
      }

      const groupSafeType = groupLines[0]?.SafeType;
      if (!this.isCustodySettlementSafeType(groupSafeType)) {
        this.logger.debug(
          `Transaction group retained in Cash-In processing based on Safe Type. ${JSON.stringify(
            {
              uniqueId,
              voucher,
              safeType: groupSafeType,
              resolvedProcessor: 'cash-in',
              lineCount: groupLines.length,
            },
          )}`,
        );
        result.cashInLines.push(...groupLines);
        continue;
      }

      const targetTokens = [
        ...new Set(
          groupLines.map((line) =>
            this.normalizeBusinessValue(this.readTargetProcessor(line)).replace(
              /\s+/g,
              '',
            ),
          ),
        ),
      ].filter(Boolean);

      if (targetTokens.length > 1) {
        result.failures.push({
          uniqueId,
          voucher,
          lineNumbers: groupLines.map((line) => line.LINENUMBER),
          safeTypes,
          targetProcessors: targetTokens,
          message:
            'Conflicting Target Processor values were found within the same Custody Settlement group.',
          lines: groupLines,
        });
        continue;
      }

      const explicitTarget = targetTokens[0]
        ? this.resolveTargetProcessor(targetTokens[0])
        : undefined;
      const targetProcessor =
        explicitTarget ?? options.defaultTargetProcessor;

      if (!targetProcessor) {
        result.failures.push({
          uniqueId,
          voucher,
          lineNumbers: groupLines.map((line) => line.LINENUMBER),
          safeTypes,
          targetProcessors: [],
          message: 'Target Processor is required for Custody Settlement.',
          lines: groupLines,
        });
        continue;
      }

      let route;
      try {
        route = this.cashJournalRoutingService.resolve({
          safeType: 'Custody Settlement',
          targetProcessor,
        });
      } catch (error: any) {
        result.failures.push({
          uniqueId,
          voucher,
          lineNumbers: groupLines.map((line) => line.LINENUMBER),
          safeTypes,
          targetProcessors: [targetProcessor],
          message:
            error?.message ||
            'A valid Target Processor is required for the Custody Settlement transaction.',
          lines: groupLines,
        });
        continue;
      }

      if (groupLines.length === 0) {
        result.failures.push({
          uniqueId,
          voucher,
          lineNumbers: [],
          safeTypes,
          targetProcessors: [targetProcessor],
          message:
            'The Custody Settlement transaction does not contain any valid lines for Cash-Out processing.',
          lines: groupLines,
        });
        continue;
      }

      this.logger.log(
        `Transaction group routed to Cash-Out because Safe Type is Custody Settlement. ${JSON.stringify(
          {
            uniqueId,
            voucher,
            safeType: 'Custody Settlement',
            targetProcessor,
            resolvedProcessor: 'cash-out',
            routingReason: 'SafeType: Custody Settlement',
            targetModule: route.module,
            targetJournalName: route.journalName,
            d365Api: route.headerApi,
            lineCount: groupLines.length,
          },
        )}`,
      );

      result.routedCashOutUniqueIds.push(uniqueId);
      if (targetProcessor === 'Fleet') {
        result.cashOutFleetLines.push(...groupLines);
      } else {
        result.cashOutFreightLines.push(...groupLines);
      }
    }

    return result;
  }
}
