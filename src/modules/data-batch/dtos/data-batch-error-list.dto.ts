import { IsNotEmpty, IsString } from 'class-validator';

import { PaginatedDto } from '@/common/dtos/paginated.dto';

export class DataBatchErrorListDto extends PaginatedDto {
  /**
   * Batch id
   */
  @IsNotEmpty()
  @IsString()
  batchId: string;
}
