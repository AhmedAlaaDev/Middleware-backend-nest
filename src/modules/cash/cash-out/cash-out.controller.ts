import { Body, Controller, Post, UseInterceptors } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes } from '@nestjs/swagger';

import { ExcelFile } from '@/common/decorators/excel-file.decorator';
import { ProcessCashOutFreightCommand } from '@/modules/cash/cash-out/commands/process-cash-out-freight.comand';
import { CashOutFreightDocDto } from '@/modules/cash/cash-out/dtos/cash-out-freight-doc.dto';

/**
 * Data Migration - Cash-Out
 */
@ApiBearerAuth()
@Controller('DataMigration/CashOut')
export class CashOutController {
  constructor(private readonly commandBus: CommandBus) {}

  /**
   * Freight Document
   */
  @Post('Freight-Document')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Upload Excel file + metadata',
    type: CashOutFreightDocDto,
  })
  @UseInterceptors(FileInterceptor('dataFile'))
  public async freightDocument(
    @ExcelFile() file: MulterFile,
    @Body() { companyId }: CashOutFreightDocDto,
  ) {
    const result = await this.commandBus.execute(
      new ProcessCashOutFreightCommand(file.buffer, companyId),
    );

    return result;
  }
}
