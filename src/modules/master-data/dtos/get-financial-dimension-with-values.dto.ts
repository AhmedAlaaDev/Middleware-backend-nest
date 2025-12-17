import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class GetFinancialDimensionWithValuesDto {
  /**
   *
   * Financial dimension key (e.g. Department, CostCenter, etc.)
   * @example SubVendor
   */
  @IsNotEmpty()
  @IsString()
  financialKey: string;

  /**
   * Optional filter on dimension value (case-insensitive partial match)
   * @example Su-000110
   */
  @IsOptional()
  @IsString()
  value?: string;
}
