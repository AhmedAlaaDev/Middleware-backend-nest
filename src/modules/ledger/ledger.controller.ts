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
import { ProcessFreightClosingEntryCommand } from '@/modules/ledger/commands/process-freight-closing-entry.command';
import { ProcessTruckingClosingEntryCommand } from '@/modules/ledger/commands/process-trucking-closing-entry.command';
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
