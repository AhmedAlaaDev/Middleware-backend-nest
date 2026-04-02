import { Body, Controller, Post, UseInterceptors } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes } from '@nestjs/swagger';

import { ExcelFile } from '@/common/decorators';
import {
  ProcessCashInFreightCommand,
  ProcessCashInTruckingCommand,
  ProcessCashOutFreightCommand,
  ProcessCashOutTruckingCommand,
  PostCashBatchToDFOCommand,
} from '@/modules/cash/commands';
import {
  CashInFreightDocDto,
  CashInTruckingDocDto,
  CashOutFreightDocDto,
  CashOutTruckingDocDto,
  PostToDFODto,
} from '@/modules/cash/dtos';

/**
 * Data Migration - Cash (single controller for Cash-In and Cash-Out)
 */
@ApiBearerAuth()
@Controller('DataMigration/Cash')
export class CashController {
  constructor(private readonly commandBus: CommandBus) {}

  /**
   * Cash-Out Freight Document
   */
  @Post('CashOut-Freight-Document')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Upload Excel file + metadata',
    type: CashOutFreightDocDto,
  })
  @UseInterceptors(FileInterceptor('dataFile'))
  public async cashOutFreightDocument(
    @ExcelFile() file: MulterFile,
    @Body() { companyId }: CashOutFreightDocDto,
  ) {
    return this.commandBus.execute(
      new ProcessCashOutFreightCommand(file.buffer, companyId),
    );
  }

  /**
   * Cash-In Freight Document
   */
  @Post('CashIn-Freight-Document')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Upload Excel file + metadata',
    type: CashInFreightDocDto,
  })
  @UseInterceptors(FileInterceptor('dataFile'))
  public async cashInFreightDocument(
    @ExcelFile() file: MulterFile,
    @Body() { companyId }: CashInFreightDocDto,
  ) {
    return this.commandBus.execute(
      new ProcessCashInFreightCommand(file.buffer, companyId),
    );
  }

  /**
   * Cash-Out Fleet (trucking) Document
   */
  @Post('CashOut-Trucking-Document')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Upload Excel file + metadata',
    type: CashOutTruckingDocDto,
  })
  @UseInterceptors(FileInterceptor('dataFile'))
  public async cashOutTruckingDocument(
    @ExcelFile() file: MulterFile,
    @Body() { companyId }: CashOutTruckingDocDto,
  ) {
    return this.commandBus.execute(
      new ProcessCashOutTruckingCommand(file.buffer, companyId),
    );
  }

  /**
   * Cash-In Fleet (trucking) Document
   */
  @Post('CashIn-Trucking-Document')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Upload Excel file + metadata',
    type: CashInTruckingDocDto,
  })
  @UseInterceptors(FileInterceptor('dataFile'))
  public async cashInTruckingDocument(
    @ExcelFile() file: MulterFile,
    @Body() { companyId }: CashInTruckingDocDto,
  ) {
    return this.commandBus.execute(
      new ProcessCashInTruckingCommand(file.buffer, companyId),
    );
  }

  /**
   * Post cash batch to D365FO (CustomerPaymentJournalHeaders/Lines)
   */
  @Post('PostToDFO')
  @ApiBody({
    description: 'Post cash batch enhanced records to D365FO',
    type: PostToDFODto,
  })
  public async postToDFO(@Body() body: PostToDFODto) {
    return this.commandBus.execute(new PostCashBatchToDFOCommand(body.batchId));
  }
}
