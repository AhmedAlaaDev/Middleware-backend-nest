import {
  Body,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes } from '@nestjs/swagger';

import { ExcelFilePipe } from '@/common/pipes/excel-file.pipe';
import { PostLedgerBatchToDFOCommand } from '@/modules/ledger/commands/post-ledger-batch-to-dfo.command';
import { ProcessClosingFreightDifferenceCommand } from '@/modules/ledger/commands/process-closing-freight-difference.command';
import { ProcessCustodySettlementEntryCommand } from '@/modules/ledger/commands/process-custody-settlement-entry.command';
import { ProcessFreightClosingEntryCommand } from '@/modules/ledger/commands/process-freight-closing-entry.command';
import { ProcessTruckingClosingEntryCommand } from '@/modules/ledger/commands/process-trucking-closing-entry.command';
import { ClosingFreightDifferenceDto } from '@/modules/ledger/dtos/closing-freight-difference.dto';
import { LedgerClosingEntryDto } from '@/modules/ledger/dtos/ledger-closing-entry.dto';
import { PostToDFODto } from '@/modules/ledger/dtos/post-to-dfo.dto';

/**
 * Data Migration - Ledger Closing Entries
 */
@ApiBearerAuth()
@Controller('DataMigration/Ledger')
export class LedgerController {
  constructor(private readonly commandBus: CommandBus) {}

  /**
   * Freight Closing Entry Document
   */
  @Post('Freight-Closing-Entry')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Upload Excel file + metadata',
    type: LedgerClosingEntryDto,
  })
  @UseInterceptors(FileInterceptor('dataFile'))
  public async freightClosingEntry(
    @UploadedFile(new ExcelFilePipe()) file: MulterFile,
    @Body() body: LedgerClosingEntryDto,
  ) {
    const result = await this.commandBus.execute(
      new ProcessFreightClosingEntryCommand(file.buffer, body.companyId),
    );

    return result;
  }

  /**
   * Freight Closing Difference Document
   */
  @Post('Freight-Closing-Difference')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Upload Excel file + metadata',
    type: ClosingFreightDifferenceDto,
  })
  @UseInterceptors(FileInterceptor('dataFile'))
  public async freightClosingDifference(
    @UploadedFile(new ExcelFilePipe()) file: MulterFile,
    @Body() body: ClosingFreightDifferenceDto,
  ) {
    const result = await this.commandBus.execute(
      new ProcessClosingFreightDifferenceCommand(file.buffer, body.companyId),
    );

    return result;
  }

  /**
   * Custody Settlement Entry Document
   */
  @Post('custody-settlement')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Upload Excel file + metadata',
    type: LedgerClosingEntryDto,
  })
  @UseInterceptors(FileInterceptor('dataFile'))
  public async custodySettlementEntry(
    @UploadedFile(new ExcelFilePipe()) file: MulterFile,
    @Body() body: LedgerClosingEntryDto,
  ) {
    const result = await this.commandBus.execute(
      new ProcessCustodySettlementEntryCommand(body.companyId, file.buffer),
    );

    return result;
  }

  /**
   * Trucking Closing Entry Document
   */
  @Post('Trucking-Closing-Entry')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Upload Excel file + metadata',
    type: LedgerClosingEntryDto,
  })
  @UseInterceptors(FileInterceptor('dataFile'))
  public async truckingClosingEntry(
    @UploadedFile(new ExcelFilePipe()) file: MulterFile,
    @Body() body: LedgerClosingEntryDto,
  ) {
    const result = await this.commandBus.execute(
      new ProcessTruckingClosingEntryCommand(file.buffer, body.companyId),
    );

    return result;
  }

  /**
   * Post batch to D365FO
   */
  @Post('PostToDFO')
  @ApiBody({
    description: 'Post ledger journal batch enhanced records to D365FO',
    type: PostToDFODto,
  })
  public async postToDFO(@Body() body: PostToDFODto) {
    const result = await this.commandBus.execute(
      new PostLedgerBatchToDFOCommand(body.batchId),
    );

    return result;
  }
}
