import {
  Body,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes } from '@nestjs/swagger';
import { CommandBus } from '@nestjs/cqrs';

import { ExcelFilePipe } from '@/common/pipes/excel-file.pipe';
import { ARFreightDto } from '@/modules/accounts-receivable/dtos/ar-freight.dto';
import { ProcessARFreightCommand } from '@/modules/accounts-receivable/commands/process-ar-freight.command';

/**
 * Data Migration - Account Receivable
 */
@Controller('DataMigration/AccountReceivable')
export class AccountsReceivableController {
  constructor(private readonly commandBus: CommandBus) {}

  /**
   * Freight Document
   */
  @Post('Freight-Document')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Upload Excel file + metadata',
    type: ARFreightDto,
  })
  @UseInterceptors(FileInterceptor('dataFile'))
  public async freightDocument(
    @UploadedFile(new ExcelFilePipe()) file: MulterFile,
    @Body() body: ARFreightDto,
  ) {
    const result = await this.commandBus.execute(
      new ProcessARFreightCommand(
        file.buffer,
        body.companyId,
        body.billingCodeId,
      ),
    );

    return result;
  }
}
