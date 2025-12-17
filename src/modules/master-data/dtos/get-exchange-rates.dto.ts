import { IsOptional, IsString } from 'class-validator';

import { PaginatedDto } from '@/common/dtos/paginated.dto';

export class GetExchangeRatesDto extends PaginatedDto {
  /**
   * Rate type
   * @example default
   */
  @IsOptional()
  @IsString()
  rateType?: string;

  /**
   * From currency
   * @example USD
   */
  @IsOptional()
  @IsString()
  fromCurrency?: string;

  /**
   * To currency
   * @example EGP
   */
  @IsOptional()
  @IsString()
  toCurrency?: string;

  /**
   * From date
   * @example 2025-01-01
   */
  @IsOptional()
  @IsString()
  fromDate?: string;

  /**
   * To date
   * @example 2025-01-30
   */
  @IsOptional()
  @IsString()
  toDate?: string;
}
