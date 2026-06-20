import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsOptional, IsEnum } from 'class-validator';

export class CreateCustomerDto {
  @ApiProperty({ example: 'C000001' })
  @IsNotEmpty()
  @IsString()
  customerAccount: string;

  @ApiProperty({ example: 'Customer Name' })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty({
    example: 'Domestic',
    enum: ['Domestic', 'Foreign', 'RelatParty'],
  })
  @IsNotEmpty()
  @IsEnum(['Domestic', 'Foreign', 'RelatParty'])
  customerGroupId: string;

  @ApiProperty({ example: 'Taxable', enum: ['Taxable', 'Non-Taxabl'] })
  @IsNotEmpty()
  @IsEnum(['Taxable', 'Non-Taxabl'])
  salesTaxGroup: string;

  @ApiProperty({
    example: '30 Days',
    enum: [
      '0 Days',
      '3 Days',
      '7 Days',
      '15 Days',
      '30 Days',
      '45 Days',
      '60 Days',
    ],
  })
  @IsNotEmpty()
  @IsEnum([
    '0 Days',
    '3 Days',
    '7 Days',
    '15 Days',
    '30 Days',
    '45 Days',
    '60 Days',
  ])
  paymentTerms: string;

  @ApiProperty({ example: 'Organization', enum: ['Organization', 'Personal'] })
  @IsNotEmpty()
  @IsEnum(['Organization', 'Personal'])
  partyType: string;

  @ApiProperty({ example: 'No', enum: ['Yes', 'No'] })
  @IsNotEmpty()
  @IsEnum(['Yes', 'No'])
  isSalesTaxIncludedInPrices: string;

  @ApiProperty({ example: 'EGY', default: 'EGY' })
  @IsOptional()
  @IsString()
  addressCountryRegionId?: string;

  @ApiProperty({ example: 'EGP', default: 'EGP' })
  @IsOptional()
  @IsString()
  salesCurrencyCode?: string;

  @ApiProperty({ example: '123456789' })
  @IsOptional()
  @IsString()
  taxExemptNumber?: string;
}
