import { Transform } from 'class-transformer';
import { IsArray, IsEnum, IsOptional, IsString } from 'class-validator';

import { PaginatedDto } from '@/common/dtos/paginated.dto';
import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';

export class DataBatchListDto extends PaginatedDto {
  /**
   * Entry processor types to filter
   */
  @IsOptional()
  @IsArray()
  @Transform(({ value }) =>
    Array.isArray(value) ? value.map((v) => Number(v)) : [Number(value)],
  )
  @IsEnum(EntryProcessorTypes, {
    each: true,
    message:
      'entryProcessorTypes value must be one of the following values: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16',
  })
  entryProcessorTypes?: EntryProcessorTypes[];

  /**
   * Batch number ids to filter
   */
  @IsOptional()
  @Transform(({ value }) => (Array.isArray(value) ? value : [value]))
  @IsArray()
  @IsString({
    each: true,
  })
  batchNumberIds?: string[];
}
