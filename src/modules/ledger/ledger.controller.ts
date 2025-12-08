import {
  Body,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes } from '@nestjs/swagger';

import { ExcelFilePipe } from '@/common/pipes/excel-file.pipe';
import { LedgerClosingEntryDto } from '@/modules/ledger/dtos/ledger-closing-entry.dto';
import { ProcessTruckingClosingEntryCommand } from '@/modules/ledger/commands/process-trucking-closing-entry.command';

/**
 * Data Migration - Ledger Closing Entries
 */
@Controller('DataMigration/Ledger')
export class LedgerController {
  constructor(private readonly commandBus: CommandBus) {}

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
}

