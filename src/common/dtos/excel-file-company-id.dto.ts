import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class ExcelFileCompanyIdDto {
  /**
   * Company ID
   * @example m-p
   */
  @IsOptional()
  @IsString()
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
