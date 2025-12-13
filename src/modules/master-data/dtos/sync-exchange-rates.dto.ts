import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class SyncExchangeRatesDto {
  @ApiProperty({
    description: 'Company code',
    example: 'm-p',
    required: true,
  })
  @IsString()
  @IsNotEmpty()
  company: string;

  @ApiProperty({
    description: 'Rate type',
    example: 'default',
    required: false,
  })
  @IsString()
  @IsOptional()
  rateType?: string;
}
