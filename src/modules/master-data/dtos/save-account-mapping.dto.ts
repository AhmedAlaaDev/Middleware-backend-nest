import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { ServiceTypes } from '@/modules/master-data/types/master-data.types';

export class SaveAccountMappingDto {
  @ApiProperty({
    description: 'Name of the account mapping',
    example: 'Freight Service Account',
    required: true,
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    description: 'Customer account number',
    example: 'CUST001',
    required: true,
  })
  @IsString()
  @IsNotEmpty()
  customerAccount: string;

  @ApiProperty({
    description: 'Invoice account number',
    example: 'INV001',
    required: true,
  })
  @IsString()
  @IsNotEmpty()
  invoiceAccount: string;

  @ApiProperty({
    description: 'Service type',
    enum: ServiceTypes,
    example: ServiceTypes.Freight,
    required: true,
  })
  @IsEnum(ServiceTypes)
  @IsNotEmpty()
  serviceType: ServiceTypes;
}

