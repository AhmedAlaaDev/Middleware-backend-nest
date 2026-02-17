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
import {
  PostClosingBatchToDFOCommand,
  ProcessClosingFreightDifferenceCommand,
  ProcessCustodySettlementEntryCommand,
  ProcessFreightClosingEntryCommand,
  ProcessTruckingClosingEntryCommand,
} from '@/modules/closing/commands';
import {
  ClosingEntryDto,
  ClosingFreightDifferenceDto,
  PostToDFODto,
} from '@/modules/closing/dtos';

/**
 * Data Migration - Closing Entries
 */
@ApiBearerAuth()
@Controller('DataMigration/Closing')
export class ClosingController {
  constructor(private readonly commandBus: CommandBus) {}

  /**
   * Freight Closing Entry Document
   */
  @Post('Freight-Closing-Entry')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Upload Excel file + metadata',
    type: ClosingEntryDto,
  })
  @UseInterceptors(FileInterceptor('dataFile'))
  public async freightClosingEntry(
    @UploadedFile(new ExcelFilePipe()) file: MulterFile,
    @Body() body: ClosingEntryDto,
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
    type: ClosingEntryDto,
  })
  @UseInterceptors(FileInterceptor('dataFile'))
  public async custodySettlementEntry(
    @UploadedFile(new ExcelFilePipe()) file: MulterFile,
    @Body() body: ClosingEntryDto,
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
    type: ClosingEntryDto,
  })
  @UseInterceptors(FileInterceptor('dataFile'))
  public async truckingClosingEntry(
    @UploadedFile(new ExcelFilePipe()) file: MulterFile,
    @Body() body: ClosingEntryDto,
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
      new PostClosingBatchToDFOCommand(body.batchId),
    );

    return result;
  }
}
