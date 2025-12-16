import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class LedgerClosingEntryDto {
  @IsNotEmpty()
  @IsString()
  companyId: string;

  @ApiProperty({
    type: 'string',
    format: 'binary',
  })
  dataFile: any;
}
