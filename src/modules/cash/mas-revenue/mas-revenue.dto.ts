import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';

import {
  MAS_REVENUE_COMPANY_ID,
  MAS_REVENUE_TEMPLATE_VERSION,
} from './mas-revenue.constants';

export class MasRevenuePreviewDto {
  /** Must be "mas". Required: there is no default company for this flow. */
  @ApiProperty({ example: MAS_REVENUE_COMPANY_ID })
  @IsString()
  @IsIn([MAS_REVENUE_COMPANY_ID])
  companyId: string;

  /** Template contract version the file was built from. */
  @ApiProperty({ example: MAS_REVENUE_TEMPLATE_VERSION })
  @Type(() => Number)
  @IsInt()
  @IsIn([MAS_REVENUE_TEMPLATE_VERSION])
  templateVersion: number;

  /** Raw workbook (.xlsx). Sent as the multipart field "dataFile". */
  @ApiProperty({ type: 'string', format: 'binary' })
  dataFile?: unknown;
}

export class MasRevenueSubmitDto {
  /** Review version returned by the preview. Only version 1 exists today. */
  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  @IsIn([1])
  reviewVersion: number;

  /** Server-issued hash of the reviewed snapshot. */
  @ApiProperty({ example: 'b1d3...' })
  @IsString()
  @IsNotEmpty()
  @Length(64, 64)
  payloadHash: string;

  /**
   * Stable key for this submit attempt. Re-sending the same key returns the
   * existing batch instead of creating another.
   */
  @ApiProperty({ example: 'client-generated-uuid' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  idempotencyKey: string;
}

export class MasRevenueLinesQueryDto {
  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  page?: number;

  @ApiPropertyOptional({ example: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  pageSize?: number;
}
