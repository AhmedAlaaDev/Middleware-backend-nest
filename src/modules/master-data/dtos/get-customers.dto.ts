import { IsOptional, IsString } from 'class-validator';

import { PaginatedDto } from '@/common/dtos/paginated.dto';

export class GetCustomersDto extends PaginatedDto {
  /**
   * Company code
   * @example m-p
   */
  @IsOptional()
  @IsString()
  company?: string;

  /**
   * Search term (account/name/alias)
   * @example CUST
   */
  @IsOptional()
  @IsString()
  searchTerm?: string;
}
