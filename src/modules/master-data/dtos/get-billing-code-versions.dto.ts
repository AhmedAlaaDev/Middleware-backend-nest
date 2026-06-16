import { IsOptional, IsString } from 'class-validator';

import { PaginatedDto } from '@/common/dtos/paginated.dto';

export class GetBillingCodeVersionsDto extends PaginatedDto {
  /**
   * Company code
   * @example m-p
   */
  @IsOptional()
  @IsString()
  company?: string;

  /**
   * Billing code
   * @example YD001
   */
  @IsOptional()
  @IsString()
  billingCode?: string;

  /**
   * Billing code description
   * @example Lift off - Msc Egypt
   */
  @IsOptional()
  @IsString()
  billingCodeDescription?: string;
}
