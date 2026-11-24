import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

import { SUPPORTED_COMPANY_CODES } from '@/common/company/company-code';

export class ExcelFileCompanyIdDto {
  /**
   * Company (legal entity) the upload is posted to. Required by the UI;
   * legacy callers that omit it fall back to m-p. Explicit unsupported
   * values are rejected.
   * @example mas
   */
  @IsOptional()
  @IsIn(SUPPORTED_COMPANY_CODES, {
    message: `companyId must be one of: ${SUPPORTED_COMPANY_CODES.join(', ')}`,
  })
  companyId?: string;

  /**
   * Raw Excel data file
   */
  @ApiProperty({
    type: 'string',
    format: 'binary',
  })
  dataFile: any;
}
