import { IsOptional, IsString } from 'class-validator';

import { PaginatedDto } from '@/common/dtos/paginated.dto';

export class GetBillingCodesDto extends PaginatedDto {
  /**
   * Company code
   * @example m-p
   */
  @IsOptional()
  @IsString()
  company?: string;

  /**
   * Billing classification code
   * @example ABC
   */
  @IsOptional()
  @IsString()
  billingClassification?: string;
}
