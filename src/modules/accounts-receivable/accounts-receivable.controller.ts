import {
  Body,
  Controller,
  FileTypeValidator,
  ParseFilePipe,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes } from '@nestjs/swagger';

import { ARFreightDto } from '@/modules/accounts-receivable/dtos/ar-freight.dto';

/**
 * Data Migration - Account Receivable
 */
@Controller('DataMigration/AccountReceivable')
export class AccountsReceivableController {
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
  public freightDocument(
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          // new FileTypeValidator({
          //   fileType:
          //     'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          // }),
          // new FileTypeValidator({
          //   fileType: 'application/vnd.ms-excel',
          // }),
        ],
      }),
    )
    file: MulterFile,
    @Body() body: ARFreightDto,
  ) {
    console.log(body);
    console.log(file);

    return body;
  }
}
