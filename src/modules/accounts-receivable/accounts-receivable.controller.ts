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
import { ARFreightDto } from '@/modules/accounts-receivable/dtos/ar-freight.dto';
import { ARTruckingDto } from '@/modules/accounts-receivable/dtos/ar-trucking.dto';
import { ProcessARFreightCommand } from '@/modules/accounts-receivable/commands/process-ar-freight.command';
import { ProcessARTruckingCommand } from '@/modules/accounts-receivable/commands/process-ar-trucking.command';

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

  /**
   * Trucking Document
   */
  @Post('Trucking-Document')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Upload Excel file + metadata',
    type: ARTruckingDto,
  })
  @UseInterceptors(FileInterceptor('dataFile'))
  public async truckingDocument(
    @UploadedFile(new ExcelFilePipe()) file: MulterFile,
    @Body() body: ARTruckingDto,
  ) {
    const result = await this.commandBus.execute(
      new ProcessARTruckingCommand(
        file.buffer,
        body.companyId,
        body.billingCodeId,
      ),
    );

    return result;
  }
}
