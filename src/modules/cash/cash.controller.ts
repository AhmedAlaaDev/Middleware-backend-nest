import { Body, Controller, Post, UseInterceptors } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes } from '@nestjs/swagger';

import { ExcelFile } from '@/common/decorators';
import {
  ProcessCashInFreightCommand,
  ProcessCashOutFreightCommand,
} from '@/modules/cash/commands';
import { CashInFreightDocDto, CashOutFreightDocDto } from '@/modules/cash/dtos';

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
}
