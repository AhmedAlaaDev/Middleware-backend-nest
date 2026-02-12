import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class LedgerClosingEntryDto {
  /**
   * Company ID
   * @example 'm-p'
   */
  @IsNotEmpty()
  @IsString()
  companyId: string;

  @ApiProperty({
    type: 'string',
    format: 'binary',
  })
  dataFile: any;
}
