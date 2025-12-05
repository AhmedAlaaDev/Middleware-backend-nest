import { Transform } from 'class-transformer';
import { IsArray, IsEnum, IsOptional, IsString } from 'class-validator';

import { PaginatedDto } from '@/common/dtos/paginated.dto';
import { EntryProcessorTypes } from '@/modules/db/schemas/data-batch.schema';

export class DataBatchListDto extends PaginatedDto {
  /**
   * Entry processor types to filter
   */
  @IsOptional()
  @IsArray()
  @Transform(({ value }) =>
    Array.isArray(value) ? value.map((v) => Number(v)) : [Number(value)],
  )
  @IsEnum(EntryProcessorTypes, { each: true })
  entryProcessorTypes?: EntryProcessorTypes[];

  /**
   * Batch number ids to filter
   */
  @IsOptional()
  @IsArray()
  @IsString()
  batchNumberIds?: string[];
}
