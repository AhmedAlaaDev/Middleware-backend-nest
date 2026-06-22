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

import { ExcelFilePipe } from '@/common/pipes';
import {
  PostARBatchToDFOCommand,
  ProcessARFreightCommand,
  ProcessARFreightCreditNoteCommand,
  ProcessARTruckingCommand,
  ProcessARTruckingCreditNoteCommand,
  ProcessARYardCommand,
  ProcessARShippingLinesCommand,
} from '@/modules/accounts-receivable/commands';
import {
  ARFreightDto,
  ARTruckingDto,
  PostToDFODto,
} from '@/modules/accounts-receivable/dtos';

/**
 * Data Migration - Account Receivable
 */
@ApiBearerAuth()
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
   * Freight Credit Note Document
   */
  @Post('Freight-CreditNote-Document')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Upload Excel file + metadata',
    type: ARFreightDto,
  })
  @UseInterceptors(FileInterceptor('dataFile'))
  public async freightCreditNoteDocument(
    @UploadedFile(new ExcelFilePipe()) file: MulterFile,
    @Body() body: ARFreightDto,
  ) {
    const result = await this.commandBus.execute(
      new ProcessARFreightCreditNoteCommand(file.buffer, body.companyId, ''),
    );

    return result;
  }

  /**
   * Trucking Credit Note Document
   */
  @Post('Trucking-CreditNote-Document')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Upload Excel file + metadata',
    type: ARTruckingDto,
  })
  @UseInterceptors(FileInterceptor('dataFile'))
  public async truckingCreditNoteDocument(
    @UploadedFile(new ExcelFilePipe()) file: MulterFile,
    @Body() body: ARTruckingDto,
  ) {
    const result = await this.commandBus.execute(
      new ProcessARTruckingCreditNoteCommand(
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

  /**
   * Yard Document
   */
  @Post('Yard-Document')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Upload Excel file + metadata',
    type: ARFreightDto,
  })
  @UseInterceptors(FileInterceptor('dataFile'))
  public async yardDocument(
    @UploadedFile(new ExcelFilePipe()) file: MulterFile,
    @Body() body: ARFreightDto,
  ) {
    const result = await this.commandBus.execute(
      new ProcessARYardCommand(file.buffer, body.companyId),
    );

    return result;
  }

  /**
   * Shipping Lines Document
   */
  @Post('Shipping-Lines-Document')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Upload Excel file + metadata',
    type: ARFreightDto,
  })
  @UseInterceptors(FileInterceptor('dataFile'))
  public async shippingLinesDocument(
    @UploadedFile(new ExcelFilePipe()) file: MulterFile,
    @Body() body: ARFreightDto,
  ) {
    return this.commandBus.execute(
      new ProcessARShippingLinesCommand(file.buffer, body.companyId),
    );
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
      new PostARBatchToDFOCommand(body.batchId),
    );

    return result;
  }
}
