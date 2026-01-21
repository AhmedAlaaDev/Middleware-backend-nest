import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ARFreightDto {
  @IsNotEmpty()
  @IsString()
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
