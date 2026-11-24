import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsString } from 'class-validator';

import { SUPPORTED_COMPANY_CODES } from '@/common/company/company-code';

export class ClosingFreightDifferenceDto {
  /**
   * Company ID
   * @example mas
   */
  @IsNotEmpty()
  @IsString()
  @IsIn(SUPPORTED_COMPANY_CODES, {
    message: `companyId must be one of: ${SUPPORTED_COMPANY_CODES.join(', ')}`,
  })
  companyId: string;

  @ApiProperty({
    type: 'string',
    format: 'binary',
  })
  dataFile: any;
}
