import { IsOptional, IsString } from 'class-validator';

import { PaginatedDto } from '@/common/dtos/paginated.dto';

export class GetPaymentTermsDto extends PaginatedDto {
  /**
   * Company code
   * @example m-p
   */
  @IsOptional()
  @IsString()
  company?: string;

  /**
   * Payment term name (case-insensitive partial match)
   * @example 30 Days
   */
  @IsOptional()
  @IsString()
  name?: string;
}
