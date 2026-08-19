import { Injectable, Logger } from '@nestjs/common';

import { D365FOClientService } from './d365fo-client.service';
import { ODataQueryBuilderService } from './odata-query-builder.service';

import {
  LedgerJournalHeaderRequest,
  LedgerJournalHeaderResponse,
  LedgerJournalLineRequest,
  LedgerJournalLineResponse,
} from '@/modules/d365fo/types/d365fo-ledger.type';

const CROSS_COMPANY = '?cross-company=true';

export interface CustodySettlementTarget {
  documentNumber: string;
  currency: string;
  amount: number;
  operationNumber: string;
}

export interface CustodySettlementLedgerLine {
  JournalBatchNumber?: string;
  LineNumber?: number;
  Document?: string;
  CurrencyCode?: string;
  DebitAmount?: number;
  CreditAmount?: number;
  FinTagDisplayValue?: string;
  Invoice?: string;
  Voucher?: string;
}

/**
 * Service for managing general journal entries in D365FO
 */
@Injectable()
export class GeneralJournalService {
  private readonly logger = new Logger(GeneralJournalService.name);

  constructor(
    private readonly d365foClient: D365FOClientService,
    private readonly queryBuilder: ODataQueryBuilderService,
  ) {}

  public static custodySettlementTargetKey(
    target: CustodySettlementTarget,
  ): string {
    return [
      target.documentNumber.trim().toLowerCase(),
      target.currency.trim().toUpperCase(),
      Number(target.amount || 0).toFixed(2),
      GeneralJournalService.normalizeOperation(target.operationNumber),
    ].join('|');
  }

  public async findCustodySettlementTargets(
    company: string,
    targets: CustodySettlementTarget[],
  ): Promise<Map<string, CustodySettlementLedgerLine[]>> {
    const result = new Map<string, CustodySettlementLedgerLine[]>();
    const uniqueTargets = [
      ...new Map(
        targets.map((target) => [
          GeneralJournalService.custodySettlementTargetKey(target),
          target,
        ]),
      ).values(),
    ];
    for (const target of uniqueTargets) {
      result.set(GeneralJournalService.custodySettlementTargetKey(target), []);
    }

    const documents = [
      ...new Set(
        uniqueTargets
          .map((target) => target.documentNumber.trim())
          .filter(Boolean),
      ),
    ];

    for (let index = 0; index < documents.length; index += 20) {
      const documentChunk = documents.slice(index, index + 20);
      const filter = this.queryBuilder.and(
        this.queryBuilder.eq('dataAreaId', company),
        `(${this.queryBuilder.or(
          ...documentChunk.map((document) =>
            this.queryBuilder.eq('Document', document),
          ),
        )})`,
      );
      const query = this.queryBuilder.buildQuery('/data/LedgerJournalLines', {
        filter,
        top: 10000,
        select: [
          'JournalBatchNumber',
          'LineNumber',
          'Document',
          'CurrencyCode',
          'DebitAmount',
          'CreditAmount',
          'FinTagDisplayValue',
          'Invoice',
          'Voucher',
        ],
        crossCompany: true,
      });
      const response = await this.d365foClient.get<CustodySettlementLedgerLine>(
        query,
        {
          useCache: false,
        },
      );

      for (const line of response.value ?? []) {
        const lineTarget: CustodySettlementTarget = {
          documentNumber: String(line.Document ?? ''),
          currency: String(line.CurrencyCode ?? ''),
          amount: Math.max(
            Math.abs(Number(line.DebitAmount ?? 0)),
            Math.abs(Number(line.CreditAmount ?? 0)),
          ),
          operationNumber: String(line.FinTagDisplayValue ?? '').split('|')[0],
        };
        const key =
          GeneralJournalService.custodySettlementTargetKey(lineTarget);
        if (result.has(key)) result.get(key)!.push(line);
      }
    }

    return result;
  }

  private static normalizeOperation(value: string): string {
    return String(value ?? '')
      .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
      .trim()
      .toLowerCase();
  }

  /**
   * Create a general journal header (cross-company)
   */
  public async createJournalHeader(
    company: string,
    data: LedgerJournalHeaderRequest,
  ): Promise<LedgerJournalHeaderResponse> {
    this.logger.debug(`Creating journal header for company: ${company}`);

    const payload = { ...data, dataAreaId: data.dataAreaId || company };
    return this.d365foClient.post<
      LedgerJournalHeaderRequest,
      LedgerJournalHeaderResponse
    >(`/data/LedgerJournalHeaders${CROSS_COMPANY}`, payload);
  }

  /**
   * Create a general journal line (cross-company)
   */
  public async createJournalLine(
    company: string,
    data: LedgerJournalLineRequest,
  ): Promise<LedgerJournalLineResponse> {
    this.logger.debug(
      `Creating journal line for company: ${company}, batch: ${data.JournalBatchNumber}`,
    );

    const payload = { ...data, dataAreaId: data.dataAreaId || company };
    const paymentMethod = this.sanitizePaymentMethod(payload.PaymentMethod);
    if (paymentMethod) {
      payload.PaymentMethod = paymentMethod;
    } else {
      delete payload.PaymentMethod;
    }

    return this.d365foClient.post<
      LedgerJournalLineRequest,
      LedgerJournalLineResponse
    >(`/data/LedgerJournalLines${CROSS_COMPANY}`, payload);
  }

  private sanitizePaymentMethod(value?: unknown): string | undefined {
    const s = String(value ?? '').trim();
    if (!s) return undefined;
    if (
      /^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(s) ||
      /^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}/.test(s) ||
      /^\d{4}-\d{2}-\d{2}T/.test(s)
    ) {
      return undefined;
    }
    return s;
  }

  /**
   * Delete a general journal header (cross-company)
   * Endpoint: /data/LedgerJournalHeaders(dataAreaId='...',JournalBatchNumber='...')?cross-company=true
   */
  public async deleteJournalHeader(
    dataAreaId: string,
    journalBatchNumber: string,
  ): Promise<void> {
    this.logger.debug(
      `Deleting journal header for company: ${dataAreaId}, batch: ${journalBatchNumber}`,
    );
    const dataAreaIdEsc = this.escapeODataKey(dataAreaId);
    const batchEsc = this.escapeODataKey(journalBatchNumber);
    const endpoint = `/data/LedgerJournalHeaders(dataAreaId='${dataAreaIdEsc}',JournalBatchNumber='${batchEsc}')${CROSS_COMPANY}`;
    await this.d365foClient.delete(endpoint);
  }

  /**
   * Delete a general journal line (cross-company)
   * Endpoint: /data/LedgerJournalLines(dataAreaId='...',JournalBatchNumber='...',LineNumber=...)?cross-company=true
   */
  public async deleteJournalLine(
    dataAreaId: string,
    journalBatchNumber: string,
    lineNumber: number,
  ): Promise<void> {
    this.logger.debug(
      `Deleting journal line for company: ${dataAreaId}, batch: ${journalBatchNumber}, line: ${lineNumber}`,
    );
    const dataAreaIdEsc = this.escapeODataKey(dataAreaId);
    const batchEsc = this.escapeODataKey(journalBatchNumber);
    const endpoint = `/data/LedgerJournalLines(dataAreaId='${dataAreaIdEsc}',JournalBatchNumber='${batchEsc}',LineNumber=${lineNumber})${CROSS_COMPANY}`;
    await this.d365foClient.delete(endpoint);
  }

  /**
   * Escape single quotes in OData key string values (double the quote)
   */
  private escapeODataKey(value: string): string {
    return value.replace(/'/g, "''");
  }

  /**
   * Get general journal headers
   */
  public async getJournalHeaders(
    company: string,
    options?: {
      skipCount?: number;
      maxCount?: number;
      useCache?: boolean;
      filters?: string | string[];
      select?: string[];
      orderBy?: string | string[];
    },
  ): Promise<any[]> {
    const {
      skipCount = 0,
      maxCount = 100,
      useCache = false,
      filters,
      select,
      orderBy,
    } = options || {};

    const baseFilter = this.queryBuilder.eq('dataAreaId', company);
    const filter = filters
      ? this.queryBuilder.and(
          baseFilter,
          Array.isArray(filters)
            ? this.queryBuilder.buildFilterExpression(filters)
            : filters,
        )
      : baseFilter;

    const query = this.queryBuilder.buildQuery('/data/LedgerJournalHeaders', {
      filter,
      top: maxCount,
      skip: skipCount,
      select,
      orderBy,
      crossCompany: true,
    });

    this.logger.debug(`Fetching journal headers for company: ${company}`);

    const response = await this.d365foClient.get<any>(query, {
      useCache,
      cacheTtl: 5 * 60 * 1000, // 5 minutes
    });

    return response.value;
  }

  /**
   * Get general journal lines by JournalBatchNumber (LedgerJournalLines uses JournalBatchNumber)
   */
  public async getJournalLines(
    company: string,
    journalBatchNumber: string,
    options?: {
      skipCount?: number;
      maxCount?: number;
      useCache?: boolean;
      select?: string[];
      orderBy?: string | string[];
    },
  ): Promise<any[]> {
    const {
      skipCount = 0,
      maxCount = 1000,
      useCache = false,
      select,
      orderBy,
    } = options || {};

    const filter = this.queryBuilder.and(
      this.queryBuilder.eq('dataAreaId', company),
      this.queryBuilder.eq('JournalBatchNumber', journalBatchNumber),
    );

    const query = this.queryBuilder.buildQuery('/data/LedgerJournalLines', {
      filter,
      top: maxCount,
      skip: skipCount,
      select,
      orderBy,
      crossCompany: true,
    });

    this.logger.debug(
      `Fetching journal lines for company: ${company}, batch: ${journalBatchNumber}`,
    );

    const response = await this.d365foClient.get<any>(query, {
      useCache,
      cacheTtl: 5 * 60 * 1000, // 5 minutes
    });

    return response.value;
  }
}
