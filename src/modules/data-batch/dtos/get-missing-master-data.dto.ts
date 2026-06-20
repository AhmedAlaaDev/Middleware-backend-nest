import { Type } from 'class-transformer';
import { IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';

import type {
  CustomerCreationStatus,
  MissingMasterDataType,
} from '@/modules/data-batch/interfaces/data-batch-missing-master-data.interface';

export class GetMissingMasterDataDto {
  /**
   * Filter by remediation type
   */
  @IsOptional()
  @IsEnum(['customer'] as const satisfies MissingMasterDataType[])
  type?: MissingMasterDataType;

  /**
   * Filter by creation status
   */
  @IsOptional()
  @IsString()
  creationStatus?: CustomerCreationStatus;

  /**
   * Search by missingValue (partial match)
   */
  @IsOptional()
  @IsString()
  search?: string;

  /**
   * Page number (1-based)
   * @example 1
   */
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  page?: number = 1;

  /**
   * Items per page
   * @example 30
   */
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  limit?: number = 30;
}
