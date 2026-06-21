import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, IsOptional, IsEnum } from 'class-validator';

const Trim = () =>
  Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

export class CreateCustomerDto {
  @ApiProperty({ example: 'C000001' })
  @IsNotEmpty()
  @IsString()
  @Trim()
  customerAccount: string;

  @ApiProperty({ example: 'Customer Name' })
  @IsNotEmpty()
  @IsString()
  @Trim()
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
  @IsNotEmpty()
  @IsString()
  @Trim()
  addressCountryRegionId: string;

  @ApiProperty({ example: 'EGP', default: 'EGP' })
  @IsNotEmpty()
  @IsString()
  @Trim()
  salesCurrencyCode: string;

  @ApiProperty({ example: '123456789' })
  @IsOptional()
  @IsString()
  @Trim()
  taxExemptNumber?: string;
}
