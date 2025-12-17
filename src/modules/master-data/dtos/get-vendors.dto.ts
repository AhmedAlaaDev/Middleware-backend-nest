import { IsOptional, IsString } from 'class-validator';

import { PaginatedDto } from '@/common/dtos/paginated.dto';

export class GetVendorsDto extends PaginatedDto {
  /**
   * Company code
   * @example USMF
   */
  @IsOptional()
  @IsString()
  company?: string;
}
