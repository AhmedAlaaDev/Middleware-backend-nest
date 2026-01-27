import { Injectable, Logger } from '@nestjs/common';

import { D365FOClientService } from './d365fo-client.service';
import { DfoErrorExtractorService } from './dfo-error-extractor.service';

export interface FreeTextInvoiceFinTagUpdateRequest {
  _contract: {
    CompanyId: string;
    HeaderRecordId: number;
    HeaderDisplayValue: string;
    LineDataString: string;
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
   * @param headerDisplayValue The header default dimension display value
   * @param lineDataString Formatted string: "lineNumber1,tagValue1;lineNumber2,tagValue2"
   */
  public async updateFinTag(
    company: string,
    headerRecordId: number,
    headerDisplayValue: string,
    lineDataString: string,
  ): Promise<any> {
    this.logger.debug(
      `Updating fin tag for invoice ${headerRecordId} in company: ${company}`,
    );

    const payload: FreeTextInvoiceFinTagUpdateRequest = {
      _contract: {
        CompanyId: company,
        HeaderRecordId: headerRecordId,
        HeaderDisplayValue: headerDisplayValue,
        LineDataString: lineDataString,
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
