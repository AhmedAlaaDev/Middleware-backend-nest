import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

import { SUPPORTED_COMPANY_CODES } from '@/common/company/company-code';

export class ARTruckingDto {
  @IsNotEmpty()
  @IsString()
  @IsIn(SUPPORTED_COMPANY_CODES, {
    message: `companyId must be one of: ${SUPPORTED_COMPANY_CODES.join(', ')}`,
  })
  companyId: string;

  @IsOptional()
  @IsString()
  billingCodeId?: string;

  @ApiProperty({
    type: 'string',
    format: 'binary',
  })
  dataFile: any;
}
