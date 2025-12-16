import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class ARTruckingDto {
  @IsNotEmpty()
  @IsString()
  companyId: string;

  @IsNotEmpty()
  @IsString()
  billingCodeId: string;

  @ApiProperty({
    type: 'string',
    format: 'binary',
  })
  dataFile: any;
}
