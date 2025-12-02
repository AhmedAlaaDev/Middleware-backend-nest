import { Type } from 'class-transformer';
import { IsNumber, IsOptional, Min } from 'class-validator';

export class PaginatedDto {
  /**
   * Skip count should be >= 0
   */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  skipCount?: number = 0;

  /**
   * Max count should be >= 0
   */
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  maxCount?: number = 150;
}
