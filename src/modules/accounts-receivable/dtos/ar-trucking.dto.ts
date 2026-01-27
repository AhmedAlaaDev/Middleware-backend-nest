import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ARTruckingDto {
  @IsNotEmpty()
  @IsString()
  companyId: string;

  @IsOptional()
  @IsString()
  billingCodeId?: string;

  @ApiProperty({
    type: 'string',
    format: 'binary',
  })
  dataFile: any;
}
