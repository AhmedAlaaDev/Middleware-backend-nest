import { Body, Controller, Post, UseInterceptors } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes } from '@nestjs/swagger';

import { ExcelFile } from '@/common/decorators/excel-file.decorator';
import { ProcessVendorFreightCommand } from '@/modules/vendor/commands/process-vendor-freight.comand';
import { ProcessVendorTruckingCommand } from '@/modules/vendor/commands/process-vendor-trucking.comand';
import { VendorFreightDocDto } from '@/modules/vendor/dtos/vendor-freight-doc.dto';
import { VendorTruckingDocDto } from '@/modules/vendor/dtos/vendor-trucking-doc.dto';

/**
 * Data Migration - Vendor
 */
@Controller('DataMigration/Vendor')
export class VendorController {
  constructor(private readonly commandBus: CommandBus) {}

  /**
   * Freight Document
   */
  @Post('Freight-Document')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Upload Excel file + metadata',
    type: VendorFreightDocDto,
  })
  @UseInterceptors(FileInterceptor('dataFile'))
  public async freightDocument(
    @ExcelFile() file: MulterFile,
    @Body() { companyId }: VendorFreightDocDto,
  ) {
    const result = await this.commandBus.execute(
      new ProcessVendorFreightCommand(file.buffer, companyId),
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
    type: VendorFreightDocDto,
  })
  @UseInterceptors(FileInterceptor('dataFile'))
  public async truckingDocument(
    @ExcelFile() file: MulterFile,
    @Body() { companyId }: VendorTruckingDocDto,
  ) {
    const result = await this.commandBus.execute(
      new ProcessVendorTruckingCommand(file.buffer, companyId),
    );

    return result;
  }
}
