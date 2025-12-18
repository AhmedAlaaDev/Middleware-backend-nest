# Adding a New Module or EntryProcessorType

This document describes the complete cycle for adding a new module or a new EntryProcessorType to the D365FO Middleware NestJS backend. This guide is designed to help AI agents understand the workflow and implementation requirements.

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites - What the User Provides](#prerequisites---what-the-user-provides)
3. [Implementation Steps](#implementation-steps)
4. [Processor Rules (Universal)](#processor-rules-universal)
5. [File Structure Reference](#file-structure-reference)
6. [Step-by-Step Implementation Guide](#step-by-step-implementation-guide)

---

## Overview

When adding a new module or EntryProcessorType, you need to create:

- **For a NEW MODULE:**
  - Module folder structure (`src/modules/{module-name}/`)
  - Models (raw data)
  - Interfaces (DFO data)
  - Commands and handlers
  - DTOs
  - Controller
  - Module file
  - Processor (in `entry-processor` module)
  - Register processor in factory and module

- **For a NEW ENTRY in EXISTING MODULE:**
  - Add new processor to `entry-processor` module
  - Register processor in factory and module
  - Add new command/handler/controller endpoint (required)

---

## Prerequisites - What the User Provides

Before starting implementation, the user must provide:

1. **Raw Excel Data Shape**: The structure of the Excel file columns that will be imported
   - Example: Fields like `UniqueId`, `LINENUMBER`, `JOURNALBATCHNUMBER`, `VOUCHER`, `TRANSDATE`, etc.
   - This will be used to create the **Raw Data Model**

2. **DFO Shape After Mapping**: The structure of the data after transformation (Dynamics 365 Finance & Operations format)
   - This can contain:
     - **Lines only**: Just line items
     - **Lines + Header**: Line items with a batch header
     - **Lines + Header + Settled**: Line items with header and settlement information
   - This will be used to create the **DFO Data Interface**

3. **Required Dimensions Array**: An array of financial dimension names that need to be validated
   - Example: `['MainAccount', 'Activity', 'CostCenters', 'BusinessUnit', 'Location', 'Customer', ...]`
   - These dimensions will be validated in the processor's `validateAsync` method

---

## Processor Rules (Universal)

All processors MUST follow these rules:

### Rule 1: MAX 1000 Lines Per Batch

- **Check**: `currentBatchLines.length + voucherLines.length > 1000`
- **Action**: If adding the voucher would exceed 1000 lines, close the current batch and start a new one

### Rule 2: Month Isolation

- **Requirement**: Groups data by month
- **Constraint**: A batch is NEVER allowed to mix months
- **Implementation**: Use `getMonthKey(TRANSDATE)` to group by month

### Rule 3: Don't Split Voucher

- **Requirement**: Processes data as `month → voucher → lines`
- **Constraint**: If a voucher won't fit in the current batch, close the batch early (≤ 999 lines) and start a new batch
- **Action**: Write the entire voucher group in the new batch
- **Edge Case**: If a single voucher exceeds 1000 lines, keep it intact in a single batch (log a warning)

### Rule 4: Clean, DRY, SOLID Code

- **CLEAN**: Readable, well-structured code
- **DRY**: Don't Repeat Yourself - extract common logic
- **SOLID**: Follow SOLID principles
- **Goal**: Easy to read and maintain

### Rule 5: Module vs Entry Creation

- **New Module**: Create complete module structure (commands, dtos, interfaces, models, controller, module) + processor
- **New Entry in Module**: Add processor to existing module, register it, and add new command/handler/controller endpoint (required)

---

## File Structure Reference

### Example: `cash-in` Module Structure

```
src/modules/cash-in/
├── cash-in.module.ts                    # Module definition
├── cash-in.controller.ts                # REST API endpoints
├── commands/
│   ├── process-cash-in-freight.comand.ts # Command class
│   └── handlers/
│       └── process-cash-in-freight.handler.ts  # Command handler
├── dtos/
│   └── cash-in-freight-doc.dto.ts       # DTO for API requests
├── interfaces/
│   └── cash-in-freight-dfo-data.interface.ts  # DFO data interfaces
└── models/
    └── cash-in-freight-raw-data.model.ts     # Raw Excel data model
```

### Entry Processor Location

```
src/modules/entry-processor/
├── processors/
│   └── cash-in-freight-entry.processor.ts    # Processor implementation
├── entry-processor.factory.ts                # Factory that registers processors
└── entry-processors.module.ts                # Module that provides all processors
```

---

## Step-by-Step Implementation Guide

### Step 1: Create Raw Data Model

**Location**: `src/modules/{module-name}/models/{entry-name}-raw-data.model.ts`

**Purpose**: Represents the structure of raw Excel data

**Template**:

```typescript
import { RawDataModel } from '@/modules/entry-processor/interfaces/entry-processor.interface';

type LookupCell<T = any> = { formula?: string; result?: T } | T;

export class {EntryName}RawData {
  UniqueId: number;
  LINENUMBER: number;
  // ... other fields from Excel

  constructor(data: RawDataModel) {
    Object.assign(this, {
      ...data,
      // Handle lookup cells
      // Normalize types (numbers, booleans, strings)
      // Add helper flags if needed
    });
  }

  // Helper methods for type conversion
  private lookupResult<T = any>(value: LookupCell<T>): T { /* ... */ }
  private lookupResultAsString(value: LookupCell<any>): string { /* ... */ }
  private lookupResultAsNumber(value: LookupCell<any>): number { /* ... */ }
  private toBoolean(value: any): boolean { /* ... */ }
}
```

**Reference**: See `src/modules/cash-in/models/cash-in-freight-raw-data.model.ts`

---

### Step 2: Create DFO Data Interface

**Location**: `src/modules/{module-name}/interfaces/{entry-name}-dfo-data.interface.ts`

**Purpose**: Represents the structure of data after transformation (Dynamics 365 format)

**Structure Options**:

#### Option A: Lines Only

```typescript
export class {EntryName}DFOLine implements DynDataModel {
  // Line properties
  LineNumber: number;
  DimensionModel: AccountDimensionsModel;
  // ... other line fields

  private errors: Array<{ property: string; message: string }> = [];

  // Error handling methods
  get ErrorCount(): number;
  get ErrorsText(): string;
  AddError(property: string, message: string): void;
  GetErrors(): string[];
}
```

#### Option B: Lines + Header

```typescript
export class {EntryName}DFOHeader {
  JOURNALBATCHNUMBER: string;
  DESCRIPTION: string;
  // ... header fields
}

export class {EntryName}DFOLineBase {
  header: {EntryName}DFOHeader;
  // ... line fields
}

export class {EntryName}DFOLine extends {EntryName}DFOLineBase implements DynDataModel {
  // Error handling
}
```

#### Option C: Lines + Header + Settled

```typescript
export class {EntryName}DFOHeader { /* ... */ }
export class {EntryName}DFOSettled { /* ... */ }

export class {EntryName}DFOLineBase {
  header: {EntryName}DFOHeader;
  settled: {EntryName}DFOSettled;
  // ... line fields
}

export class {EntryName}DFOLine extends {EntryName}DFOLineBase implements DynDataModel {
  // Error handling
}
```

**Reference**: See `src/modules/cash-in/interfaces/cash-in-freight-dfo-data.interface.ts`

---

### Step 3: Create Processor

**Location**: `src/modules/entry-processor/processors/{entry-name}-entry.processor.ts`

**Purpose**: Implements the business logic for transforming and validating data

**Key Requirements**:

1. **Extend `EntryProcessorBase`**
2. **Set `entryProcessorType`** (from `EntryProcessorTypes` enum)
3. **Set `requiredDimensions`** array
4. **Implement `formatAndEnrichAsync`**:
   - Map raw data to models
   - Sort by line number
   - Build month → voucher map
   - Apply batch rules (MAX 1000, month isolation, don't split voucher)
   - Transform to DFO format
5. **Implement `validateAsync`**:
   - Validate main accounts (if `ACCOUNTTYPE === 'Ledger'`)
   - Validate all required dimensions
6. **Implement `insertIntoDynamicsAsync`** (can be empty for now)

**Template Structure**:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';
import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import { EntryProcessorBase } from '@/modules/entry-processor/processors/base/entry-processor.base';
// ... other imports

@Injectable()
export class {EntryName}EntryProcessor extends EntryProcessorBase {
  private readonly procLogger = new Logger({EntryName}EntryProcessor.name);

  readonly entryProcessorType = EntryProcessorTypes.{EntryType};
  private readonly MAX_LINES_PER_BATCH = 1000;

  readonly requiredDimensions = [
    'MainAccount',
    'Activity',
    // ... other dimensions from user
  ] as const;

  constructor(
    customerInvoiceService: CustomerInvoiceService,
    queryBus: QueryBus,
    db: DBService,
  ) {
    super(customerInvoiceService, queryBus, db);
  }

  public async formatAndEnrichAsync(
    data: RawDataModel[],
    company: string,
  ): Promise<DynDataModel[]> {
    // STEP 1: Map & sort
    const sortedLines = this.sortLinesByLineNumber(this.mapToModels(data));

    // STEP 2: Build month → voucher map
    const monthVoucherMap = this.buildVoucherMap(sortedLines);

    // STEP 3: Batch processing (apply rules)
    const eData: {EntryName}DFOLine[] = [];
    let journalBatchNum = await this.getNextBatchNumber();
    let voucherNum = await this.getNextVoucherNumber();
    let currentBatchLines: {EntryName}DFOLine[] = [];
    let currentBatchMonth: string | null = null;
    let currentHeader: {EntryName}DFOHeader | null = null;
    let lineNumber = 1;

    for (const [monthKey, voucherMap] of monthVoucherMap.entries()) {
      for (const [voucherKey, voucherLines] of voucherMap.entries()) {
        const headerLine = voucherLines[0];
        const groupLineCount = voucherLines.length;

        const monthChanged = currentBatchMonth !== monthKey;
        const wouldExceedLimit =
          currentBatchLines.length + groupLineCount > this.MAX_LINES_PER_BATCH;

        // Rule 1 & 2: Check month change or limit
        if (monthChanged || wouldExceedLimit || currentHeader === null) {
          // Close previous batch
          if (currentBatchLines.length > 0 && currentHeader) {
            this.flushBatch(currentHeader, currentBatchLines, eData);
            journalBatchNum++;
          }

          // Start new batch
          currentBatchMonth = monthKey;
          currentHeader = this.startNewBatch(headerLine, journalBatchNum);
          currentBatchLines = [];
          lineNumber = 1;
        }

        // Rule 3: Don't split voucher (even if it exceeds 1000)
        if (groupLineCount > this.MAX_LINES_PER_BATCH) {
          this.procLogger.warn(
            `Voucher ${voucherKey} has ${groupLineCount} lines (> ${this.MAX_LINES_PER_BATCH}). Keeping it in a single batch.`,
          );
        }

        const voucher = voucherNum++;

        // Process all lines in voucher
        for (const rawLine of voucherLines) {
          const enrichedLine = await this.buildLine({
            rawLine,
            header: currentHeader,
            company,
            voucher,
            lineNumber,
          });
          currentBatchLines.push(enrichedLine);
          lineNumber++;
        }
      }
    }

    // Final flush
    if (currentBatchLines.length > 0 && currentHeader) {
      this.flushBatch(currentHeader, currentBatchLines, eData);
    }

    return eData as unknown as DynDataModel[];
  }

  public async validateAsync(
    data: DynDataModel[],
    _company: string,
  ): Promise<DynDataModel[]> {
    const lines = data as unknown as {EntryName}DFOLine[];

    // Load dimensions
    const dimensionsMap: Record<string, IFinancialDimensionValue[]> = {};
    for (const key of this.requiredDimensions) {
      dimensionsMap[key] = (await this.getFinancialDimensionValues(key)) || [];
    }

    const mainAccounts = (await this.getAllMainAccounts()).map(
      ({ accountNumber }) => ({ accountNumber }),
    );

    // Validate each line
    for (const line of lines) {
      if (line.ACCOUNTTYPE === 'Ledger') {
        this.validateMainAccount(line, mainAccounts);
      }
      // Validate all required dimensions
      this.validateActivityName(line, dimensionsMap.Activity);
      this.validateCostCenter(line, dimensionsMap.CostCenters);
      // ... validate other dimensions
    }

    return data;
  }

  public insertIntoDynamicsAsync(): Promise<void> {
    return Promise.resolve();
  }

  // Private helper methods
  private mapToModels(data: RawDataModel[]): {EntryName}RawData[] { /* ... */ }
  private sortLinesByLineNumber(lines: {EntryName}RawData[]): {EntryName}RawData[] { /* ... */ }
  private buildVoucherMap(sortedLines: {EntryName}RawData[]): MonthVoucherMap { /* ... */ }
  private startNewBatch(headerLine: {EntryName}RawData, journalBatchNum: number): {EntryName}DFOHeader { /* ... */ }
  private flushBatch(header: {EntryName}DFOHeader, batchLines: {EntryName}DFOLine[], eData: {EntryName}DFOLine[]): void { /* ... */ }
  private async buildLine(args: { /* ... */ }): Promise<{EntryName}DFOLine> { /* ... */ }
  private async getNextBatchNumber(): Promise<number> { /* ... */ }
  private async getNextVoucherNumber(): Promise<number> { /* ... */ }
}
```

**References**:

- `src/modules/entry-processor/processors/cash-in-freight-entry.processor.ts`
- `src/modules/entry-processor/processors/vendor-trucking-entry.processor.ts`

---

### Step 4: Add EntryProcessorType to Enum

**Location**: `src/modules/data-batch/enums/data-batch.enum.ts`

**Action**: Add new enum value to `EntryProcessorTypes`

```typescript
export enum EntryProcessorTypes {
  // ... existing values
  {NewEntryType} = {nextNumber},
}
```

**Note**: Use the next available number in sequence.

---

### Step 5: Register Processor in Factory

**Location**: `src/modules/entry-processor/entry-processor.factory.ts`

**Actions**:

1. **Import the processor**:

```typescript
import { {EntryName}EntryProcessor } from '@/modules/entry-processor/processors/{entry-name}-entry.processor';
```

2. **Add to constructor**:

```typescript
constructor(
  // ... existing processors
  private readonly {entryName}Processor: {EntryName}EntryProcessor,
) {
  this.registerProcessors();
}
```

3. **Register in `registerProcessors()` method**:

```typescript
private registerProcessors(): void {
  // ... existing registrations
  this.processors.set(
    EntryProcessorTypes.{EntryType},
    this.{entryName}Processor,
  );
}
```

---

### Step 6: Register Processor in Module

**Location**: `src/modules/entry-processor/entry-processors.module.ts`

**Actions**:

1. **Import the processor**:

```typescript
import { {EntryName}EntryProcessor } from '@/modules/entry-processor/processors/{entry-name}-entry.processor';
```

2. **Add to `EntryProcessors` array**:

```typescript
const EntryProcessors = [
  // ... existing processors
  {EntryName}EntryProcessor,
];
```

---

### Step 7: Add Processor Name Constant (Optional but Recommended)

**Location**: `src/modules/entry-processor/enums/entry-processor-names.constant.ts`

**Action**: Add processor name constant

```typescript
export const ENTRY_PROCESSOR_NAMES = {
  // ... existing names
  {ENTRY_TYPE}: '{EntryName}EntryProcessor',
} as const;
```

---

### Step 8: Create Command/Handler/Controller for New Entry in Existing Module

If this is a **new entry in an existing module**, you need to add:

#### 8.1: Create DTO (if not already exists)

**Location**: `src/modules/{existing-module-name}/dtos/{entry-name}-doc.dto.ts`

```typescript
import { ExcelFileCompanyIdDto } from '@/common/dtos/excel-file-company-id.dto';

export class {EntryName}DocDto extends ExcelFileCompanyIdDto {}
```

#### 8.2: Create Command

**Location**: `src/modules/{existing-module-name}/commands/process-{entry-name}.comand.ts`

```typescript
import { Command } from '@nestjs/cqrs';
import { IDataBatch } from '@/modules/data-batch/interfaces/data-batch.interface';

export class Process{EntryName}Command extends Command<IDataBatch> {
  constructor(
    public readonly fileBuffer: Buffer,
    public readonly companyId?: string,
  ) {
    super();
  }
}
```

#### 8.3: Create Command Handler

**Location**: `src/modules/{existing-module-name}/commands/handlers/process-{entry-name}.handler.ts`

```typescript
import { BadRequestException, Injectable } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { Process{EntryName}Command } from '@/modules/{existing-module-name}/commands/process-{entry-name}.comand';
import { {EntryName}RawData } from '@/modules/{existing-module-name}/models/{entry-name}-raw-data.model';
import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import { IDataBatch } from '@/modules/data-batch/interfaces/data-batch.interface';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';
import { EntryProcessorFactory } from '@/modules/entry-processor/entry-processor.factory';
import { ENTRY_PROCESSOR_NAMES } from '@/modules/entry-processor/enums/entry-processor-names.constant';
import { ExcelService } from '@/modules/excel/excel.service';

@CommandHandler(Process{EntryName}Command)
@Injectable()
export class Process{EntryName}Handler implements ICommandHandler<Process{EntryName}Command> {
  constructor(
    private readonly excelService: ExcelService,
    private readonly processorFactory: EntryProcessorFactory,
    private readonly dataBatchService: DataBatchService,
  ) {}

  public async execute({
    companyId,
    fileBuffer,
  }: Process{EntryName}Command): Promise<IDataBatch> {
    const company = companyId || 'm-p';

    const rawData = await this.excelService.excelToJson<{EntryName}RawData>(fileBuffer);

    if (!rawData || rawData.length === 0) {
      throw new BadRequestException('Empty file');
    }

    const processor = this.processorFactory.getProcessorByName(
      EntryProcessorTypes.{EntryType},
    );

    const enriched = await processor.formatAndEnrichAsync(rawData, company);
    const validated = await processor.validateAsync(enriched, company);

    const dataBatch = await this.dataBatchService.createAsync(
      EntryProcessorTypes.{EntryType},
      ENTRY_PROCESSOR_NAMES.{ENTRY_TYPE},
      company,
      `{Entry Name} ${Date.now()}`,
      rawData,
      validated,
      undefined,
      'last.ledger.voucher.{entry-name}', // Setting key for voucher number
    );

    return dataBatch;
  }
}
```

#### 8.4: Add Controller Endpoint

**Location**: `src/modules/{existing-module-name}/{existing-module-name}.controller.ts`

**Action**: Add a new endpoint method to the existing controller

```typescript
import { Process{EntryName}Command } from '@/modules/{existing-module-name}/commands/process-{entry-name}.comand';
import { {EntryName}DocDto } from '@/modules/{existing-module-name}/dtos/{entry-name}-doc.dto';

// ... existing controller code ...

@Post('{EntryName}-Document')
@ApiConsumes('multipart/form-data')
@ApiBody({
  description: 'Upload Excel file + metadata',
  type: {EntryName}DocDto,
})
@UseInterceptors(FileInterceptor('dataFile'))
public async {entryName}Document(
  @ExcelFile() file: MulterFile,
  @Body() { companyId }: {EntryName}DocDto,
) {
  const result = await this.commandBus.execute(
    new Process{EntryName}Command(file.buffer, companyId),
  );
  return result;
}
```

#### 8.5: Register Handler in Module

**Location**: `src/modules/{existing-module-name}/{existing-module-name}.module.ts`

**Action**: Add the new handler to the `providers` array

```typescript
import { Process{EntryName}Handler } from '@/modules/{existing-module-name}/commands/handlers/process-{entry-name}.handler';

@Module({
  // ... existing imports
  providers: [
    // ... existing handlers
    Process{EntryName}Handler,
  ],
})
export class {ExistingModuleName}Module {}
```

---

### Step 9: Create Module Structure (For New Module Only)

If this is a **new module** (not just a new entry in an existing module), create:

#### 9.1: Create DTO

**Location**: `src/modules/{module-name}/dtos/{entry-name}-doc.dto.ts`

```typescript
import { ExcelFileCompanyIdDto } from '@/common/dtos/excel-file-company-id.dto';

export class {EntryName}DocDto extends ExcelFileCompanyIdDto {}
```

#### 9.2: Create Command

**Location**: `src/modules/{module-name}/commands/process-{entry-name}.comand.ts`

```typescript
import { Command } from '@nestjs/cqrs';
import { IDataBatch } from '@/modules/data-batch/interfaces/data-batch.interface';

export class Process{EntryName}Command extends Command<IDataBatch> {
  constructor(
    public readonly fileBuffer: Buffer,
    public readonly companyId?: string,
  ) {
    super();
  }
}
```

#### 9.3: Create Command Handler

**Location**: `src/modules/{module-name}/commands/handlers/process-{entry-name}.handler.ts`

```typescript
import { BadRequestException, Injectable } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { Process{EntryName}Command } from '@/modules/{module-name}/commands/process-{entry-name}.comand';
import { {EntryName}RawData } from '@/modules/{module-name}/models/{entry-name}-raw-data.model';
import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import { IDataBatch } from '@/modules/data-batch/interfaces/data-batch.interface';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';
import { EntryProcessorFactory } from '@/modules/entry-processor/entry-processor.factory';
import { ENTRY_PROCESSOR_NAMES } from '@/modules/entry-processor/enums/entry-processor-names.constant';
import { ExcelService } from '@/modules/excel/excel.service';

@CommandHandler(Process{EntryName}Command)
@Injectable()
export class Process{EntryName}Handler implements ICommandHandler<Process{EntryName}Command> {
  constructor(
    private readonly excelService: ExcelService,
    private readonly processorFactory: EntryProcessorFactory,
    private readonly dataBatchService: DataBatchService,
  ) {}

  public async execute({
    companyId,
    fileBuffer,
  }: Process{EntryName}Command): Promise<IDataBatch> {
    const company = companyId || 'm-p';

    const rawData = await this.excelService.excelToJson<{EntryName}RawData>(fileBuffer);

    if (!rawData || rawData.length === 0) {
      throw new BadRequestException('Empty file');
    }

    const processor = this.processorFactory.getProcessorByName(
      EntryProcessorTypes.{EntryType},
    );

    const enriched = await processor.formatAndEnrichAsync(rawData, company);
    const validated = await processor.validateAsync(enriched, company);

    const dataBatch = await this.dataBatchService.createAsync(
      EntryProcessorTypes.{EntryType},
      ENTRY_PROCESSOR_NAMES.{ENTRY_TYPE},
      company,
      `{Entry Name} ${Date.now()}`,
      rawData,
      validated,
      undefined,
      'last.ledger.voucher.{entry-name}', // Setting key for voucher number
    );

    return dataBatch;
  }
}
```

#### 9.4: Create Controller

**Location**: `src/modules/{module-name}/{module-name}.controller.ts`

```typescript
import { Body, Controller, Post, UseInterceptors } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes } from '@nestjs/swagger';
import { ExcelFile } from '@/common/decorators/excel-file.decorator';
import { Process{EntryName}Command } from '@/modules/{module-name}/commands/process-{entry-name}.comand';
import { {EntryName}DocDto } from '@/modules/{module-name}/dtos/{entry-name}-doc.dto';

@ApiBearerAuth()
@Controller('DataMigration/{ModuleName}')
export class {ModuleName}Controller {
  constructor(private readonly commandBus: CommandBus) {}

  @Post('{EntryName}-Document')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Upload Excel file + metadata',
    type: {EntryName}DocDto,
  })
  @UseInterceptors(FileInterceptor('dataFile'))
  public async {entryName}Document(
    @ExcelFile() file: MulterFile,
    @Body() { companyId }: {EntryName}DocDto,
  ) {
    const result = await this.commandBus.execute(
      new Process{EntryName}Command(file.buffer, companyId),
    );
    return result;
  }
}
```

#### 9.5: Create Module File

**Location**: `src/modules/{module-name}/{module-name}.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { {ModuleName}Controller } from '@/modules/{module-name}/{module-name}.controller';
import { Process{EntryName}Handler } from '@/modules/{module-name}/commands/handlers/process-{entry-name}.handler';
import { DataBatchModule } from '@/modules/data-batch/data-batch.module';
import { EntryProcessorsModule } from '@/modules/entry-processor/entry-processors.module';
import { ExcelModule } from '@/modules/excel/excel.module';
import { MasterDataModule } from '@/modules/master-data/master-data.module';

@Module({
  imports: [
    ExcelModule,
    EntryProcessorsModule,
    DataBatchModule,
    CqrsModule,
    MasterDataModule,
  ],
  controllers: [{ModuleName}Controller],
  providers: [Process{EntryName}Handler],
})
export class {ModuleName}Module {}
```

#### 9.6: Register Module in App Module

**Location**: `src/app.module.ts`

**Action**: Add the new module to the `imports` array

```typescript
import { {ModuleName}Module } from '@/modules/{module-name}/{module-name}.module';

@Module({
  imports: [
    // ... existing modules
    {ModuleName}Module,
  ],
  // ...
})
export class AppModule {}
```

---

## Summary Checklist

### For New Module:

- [ ] Create raw data model
- [ ] Create DFO data interface
- [ ] Create processor
- [ ] Add EntryProcessorType to enum
- [ ] Register processor in factory
- [ ] Register processor in entry-processors module
- [ ] Add processor name constant
- [ ] Create DTO
- [ ] Create command
- [ ] Create command handler
- [ ] Create controller
- [ ] Create module file
- [ ] Register module in app.module.ts

### For New Entry in Existing Module:

- [ ] Create raw data model (if different from existing)
- [ ] Create DFO data interface (if different from existing)
- [ ] Create processor
- [ ] Add EntryProcessorType to enum
- [ ] Register processor in factory
- [ ] Register processor in entry-processors module
- [ ] Add processor name constant
- [ ] Create DTO (if not already exists)
- [ ] Create command
- [ ] Create command handler
- [ ] Add controller endpoint to existing controller
- [ ] Register handler in existing module

---

## Key Implementation Notes

1. **Batch Processing Logic**: Always follow the three rules (MAX 1000, month isolation, don't split voucher)
2. **Dimension Validation**: Use the `requiredDimensions` array to validate all necessary dimensions
3. **Error Handling**: Implement error collection in DFO line classes using `AddError()` method
4. **Code Quality**: Keep processors CLEAN, DRY, and SOLID
5. **Naming Conventions**:
   - Models: `{EntryName}RawData`
   - Interfaces: `{EntryName}DFOLine`, `{EntryName}DFOHeader`, `{EntryName}DFOSettled`
   - Processors: `{EntryName}EntryProcessor`
   - Commands: `Process{EntryName}Command`
   - Handlers: `Process{EntryName}Handler`

---

## References

- Example Module: `src/modules/cash-in/`
- Example Processor: `src/modules/entry-processor/processors/cash-in-freight-entry.processor.ts`
- Base Processor: `src/modules/entry-processor/processors/base/entry-processor.base.ts`
- Processor Factory: `src/modules/entry-processor/entry-processor.factory.ts`
- EntryProcessorTypes Enum: `src/modules/data-batch/enums/data-batch.enum.ts`
