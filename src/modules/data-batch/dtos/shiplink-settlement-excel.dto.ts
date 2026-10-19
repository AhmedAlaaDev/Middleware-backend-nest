import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class ShiplinkSettlementExcelDto {
  @ApiProperty({
    type: 'string',
    format: 'binary',
    description:
      'Enhanced Shiplink cash-in workbook, for example enhanced-records-6aac53398ff32cc04095a789.xlsx.',
  })
  enhancedRecords: any;

  @ApiProperty({
    type: 'string',
    format: 'binary',
    description:
      'Shiplink invoice or CashInEntries workbook used to select which lines to settle. InvoiceDueDate is taken from DueDate when present, otherwise TRANSDATE, and replaced with the open invoice due date from Finance before each write.',
  })
  invoiceFile: any;

  @ApiPropertyOptional({
    example: 'Mesco-000015882',
    description:
      'Optional Finance journal batch to settle. Omit to settle every journal in the workbook.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  journalBatchNumber?: string;

  @ApiPropertyOptional({
    type: 'boolean',
    default: false,
    description:
      'When true, build the PaymentJournalLineSettledInvoices bodies without posting them.',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  dryRun?: boolean;
}
