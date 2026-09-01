import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

export class VendorPaymentSettlementUploadDto {
  @ApiProperty({
    type: 'string',
    format: 'binary',
    description:
      'Vendor payment journal export containing Description values such as "Unmarked - <invoice>".',
  })
  dataFile: any;

  @ApiPropertyOptional({
    type: 'boolean',
    default: false,
    description:
      'When true, resolve and validate every row without creating settlement marks.',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  dryRun: boolean = false;
}
