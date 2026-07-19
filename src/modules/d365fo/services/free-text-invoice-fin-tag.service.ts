import { Injectable, Logger } from '@nestjs/common';

import { D365FOClientService } from './d365fo-client.service';
import { DfoErrorExtractorService } from './dfo-error-extractor.service';

export interface FreeTextInvoiceFinTagLine {
  lineNumber: number;
  tags: string;
}

export interface FreeTextInvoiceFinTagUpdateRequest {
  _contract: {
    CompanyId: string;
    HeaderRecordId: number;
    HeaderDisplayValue: string;
    lines: FreeTextInvoiceFinTagLine[];
  };
}

/**
 * Service for updating financial tags on free text invoices in D365FO
 */
@Injectable()
export class FreeTextInvoiceFinTagService {
  private readonly logger = new Logger(FreeTextInvoiceFinTagService.name);

  constructor(
    private readonly d365foClient: D365FOClientService,
    private readonly dfoErrorExtractor: DfoErrorExtractorService,
  ) {}

  /**
   * Update financial tags for a free text invoice header and its lines
   * @param company Company data area ID
   * @param headerRecordId The InvoiceIdentifier of the header
   * @param headerDisplayValue The header financial tag display value
   * @param lines Line financial tags: [{ lineNumber, tags }]
   */
  public async updateFinTag(
    company: string,
    headerRecordId: number,
    headerDisplayValue: string,
    lines: FreeTextInvoiceFinTagLine[],
  ): Promise<any> {
    this.logger.debug(
      `Updating fin tag for invoice ${headerRecordId} in company: ${company}`,
    );

    const payload: FreeTextInvoiceFinTagUpdateRequest = {
      _contract: {
        CompanyId: company,
        HeaderRecordId: headerRecordId,
        HeaderDisplayValue: headerDisplayValue,
        lines,
      },
    };

    try {
      const response = await this.d365foClient.post<
        FreeTextInvoiceFinTagUpdateRequest,
        any
      >(
        '/api/services/FreeTextInvoiceServiceGroup/FreeTextInvoiceFinTagService/update',
        payload,
      );

      this.logger.debug(
        `Successfully updated fin tag for invoice ${headerRecordId}`,
      );

      return response;
    } catch (error) {
      const errorDetails = this.dfoErrorExtractor.extractMessage(error);
      this.logger.error(
        `Failed to update fin tag for invoice ${headerRecordId}: ${errorDetails}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
  }
}
