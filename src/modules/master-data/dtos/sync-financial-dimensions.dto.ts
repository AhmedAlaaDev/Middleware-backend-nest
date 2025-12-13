import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional } from 'class-validator';

export class SyncFinancialDimensionsDto {
  @ApiProperty({
    description: 'Company code',
    example: 'm-p',
    required: false,
  })
  @IsString()
  @IsOptional()
  company?: string;
}
