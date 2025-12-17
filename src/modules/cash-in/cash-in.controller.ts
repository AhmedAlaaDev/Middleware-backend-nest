import { Body, Controller, Post, UseInterceptors } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes } from '@nestjs/swagger';

import { ExcelFile } from '@/common/decorators/excel-file.decorator';
import { ProcessCashInFreightCommand } from '@/modules/cash-in/commands/process-cash-in-freight.comand';
import { CashInFreightDocDto } from '@/modules/cash-in/dtos/cash-in-freight-doc.dto';

/**
 * Data Migration - Cash-In
 */
@ApiBearerAuth()
@Controller('DataMigration/CashIn')
export class CashInController {
  constructor(private readonly commandBus: CommandBus) {}

  /**
   * Freight Document
   */
  @Post('Freight-Document')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Upload Excel file + metadata',
    type: CashInFreightDocDto,
  })
  @UseInterceptors(FileInterceptor('dataFile'))
  public async freightDocument(
    @ExcelFile() file: MulterFile,
    @Body() { companyId }: CashInFreightDocDto,
  ) {
    const result = await this.commandBus.execute(
      new ProcessCashInFreightCommand(file.buffer, companyId),
    );

    return result;
  }
}
