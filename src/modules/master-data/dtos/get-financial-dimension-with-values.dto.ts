import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class GetFinancialDimensionWithValuesDto {
  @ApiPropertyOptional({
    description: 'Financial dimension key (e.g. Department, CostCenter, etc.)',
    example: 'SubVendor',
  })
  @IsNotEmpty()
  @IsString()
  financialKey: string;

  @ApiPropertyOptional({
    description:
      'Optional filter on dimension value (case-insensitive partial match)',
    example: 'Su-000110',
  })
  @IsOptional()
  @IsString()
  value?: string;
}
