import { Body, Controller, Post, UseInterceptors } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes } from '@nestjs/swagger';

import { ExcelFile } from '@/common/decorators/excel-file.decorator';
import {
  PostVendorBatchToDFOCommand,
  ProcessVendorFreightAdjustmentCommand,
  ProcessVendorFreightCommand,
  ProcessVendorTruckingAdjustmentCommand,
  ProcessVendorTruckingCommand,
} from '@/modules/vendor/commands';
import {
  PostToDFODto,
  VendorFreightAdjustmentDocDto,
  VendorFreightDocDto,
  VendorTruckingAdjustmentDocDto,
  VendorTruckingDocDto,
} from '@/modules/vendor/dtos';

/**
 * Data Migration - Vendor
 */
@ApiBearerAuth()
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
   * Freight Document Adjustment
   */
  @Post('Freight-Document-Adjustment')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Upload Excel file + metadata',
    type: VendorFreightAdjustmentDocDto,
  })
  @UseInterceptors(FileInterceptor('dataFile'))
  public async freightDocumentAdjustment(
    @ExcelFile() file: MulterFile,
    @Body() { companyId }: VendorFreightAdjustmentDocDto,
  ) {
    const result = await this.commandBus.execute(
      new ProcessVendorFreightAdjustmentCommand(file.buffer, companyId),
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

  /**
   * Trucking Document Adjustment
   */
  @Post('Trucking-Document-Adjustment')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Upload Excel file + metadata',
    type: VendorTruckingAdjustmentDocDto,
  })
  @UseInterceptors(FileInterceptor('dataFile'))
  public async truckingDocumentAdjustment(
    @ExcelFile() file: MulterFile,
    @Body() { companyId }: VendorTruckingAdjustmentDocDto,
  ) {
    const result = await this.commandBus.execute(
      new ProcessVendorTruckingAdjustmentCommand(file.buffer, companyId),
    );

    return result;
  }

  /**
   * Post batch to D365FO
   */
  @Post('PostToDFO')
  @ApiBody({
    description: 'Post batch enhanced records to D365FO',
    type: PostToDFODto,
  })
  public async postToDFO(@Body() body: PostToDFODto) {
    const result = await this.commandBus.execute(
      new PostVendorBatchToDFOCommand(body.batchId),
    );

    return result;
  }
}
