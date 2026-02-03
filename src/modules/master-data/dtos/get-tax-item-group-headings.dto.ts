import { IsOptional, IsString } from 'class-validator';

import { PaginatedDto } from '@/common/dtos/paginated.dto';

export class GetTaxItemGroupHeadingsDto extends PaginatedDto {
  /**
   * Company (dataAreaId)
   * @example m-p
   */
  @IsOptional()
  @IsString()
  dataAreaId?: string;

  /**
   * Tax item group code (exact match)
   * @example VAT-14%
   */
  @IsOptional()
  @IsString()
  taxItemGroup?: string;
}
