import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';

import { SUPPORTED_COMPANY_CODES } from '@/common/company/company-code';

export class VendorPaymentSettlementUploadDto {
  @ApiProperty({
    type: 'string',
    format: 'binary',
    description:
      'Vendor payment journal export containing Description values such as "Unmarked - <invoice>".',
  })
  dataFile: any;

  /**
   * Optional selected company. When given, every workbook row with a Company value
   * must match it. Omit for the legacy behaviour: the rows decide the company.
   */
  @ApiPropertyOptional({
    enum: SUPPORTED_COMPANY_CODES,
    description:
      'Selected company (m-p or mas). Rows for another company reject the whole file. Omit to keep the legacy row-driven behaviour.',
  })
  @IsOptional()
  @IsIn(SUPPORTED_COMPANY_CODES)
  companyId?: string;

  @ApiPropertyOptional({
    type: 'boolean',
    default: false,
    description:
      'When true, resolve and validate every row without creating settlement marks.',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  dryRun: boolean = false;
}
