import { Body, Controller, Post, UseInterceptors } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes } from '@nestjs/swagger';

import { ExcelFile } from '@/common/decorators/excel-file.decorator';
import { ProcessVendorFreightAdjustmentCommand } from '@/modules/vendor/commands/process-vendor-freight-adjustment.comand';
import { ProcessVendorFreightCommand } from '@/modules/vendor/commands/process-vendor-freight.comand';
import { ProcessVendorTruckingAdjustmentCommand } from '@/modules/vendor/commands/process-vendor-trucking-adjustment.comand';
import { ProcessVendorTruckingCommand } from '@/modules/vendor/commands/process-vendor-trucking.comand';
import { PostVendorBatchToDFOCommand } from '@/modules/vendor/commands/post-vendor-batch-to-dfo.command';
import { VendorFreightAdjustmentDocDto } from '@/modules/vendor/dtos/vendor-freight-adjustment-doc.dto';
import { VendorFreightDocDto } from '@/modules/vendor/dtos/vendor-freight-doc.dto';
import { VendorTruckingAdjustmentDocDto } from '@/modules/vendor/dtos/vendor-trucking-adjustment-doc.dto';
import { VendorTruckingDocDto } from '@/modules/vendor/dtos/vendor-trucking-doc.dto';
import { PostToDFODto } from '@/modules/vendor/dtos/post-to-dfo.dto';

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
