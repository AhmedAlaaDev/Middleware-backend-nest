import { IsOptional, IsString } from 'class-validator';

import { PaginatedDto } from '@/common/dtos/paginated.dto';

export class GetMainAccountsDto extends PaginatedDto {
  /**
   * Chart of accounts number
   * @example Chart of Accounts
   */
  @IsOptional()
  @IsString()
  chartOfAccounts?: string;

  /**
   * Main account name (case-insensitive partial match)
   * @example Cash
   */
  @IsOptional()
  @IsString()
  accountName?: string;
}
