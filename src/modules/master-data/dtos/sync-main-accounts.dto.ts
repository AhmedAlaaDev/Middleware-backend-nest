import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsNotEmpty } from 'class-validator';

import { SUPPORTED_COMPANY_CODES } from '@/common/company/company-code';

export class SyncMainAccountsDto {
  @ApiProperty({
    description:
      'Chart of accounts. Optional for MAS: it is read from the company ledger.',
    example: 'Chart of Accounts',
    required: false,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  chartOfAccounts?: string;

  @ApiProperty({
    description:
      'Company whose ledger chart applies when chartOfAccounts is omitted',
    enum: SUPPORTED_COMPANY_CODES,
    required: false,
  })
  @IsOptional()
  @IsIn(SUPPORTED_COMPANY_CODES)
  company?: string;
}
