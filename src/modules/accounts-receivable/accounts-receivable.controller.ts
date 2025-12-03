import {
  Body,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes } from '@nestjs/swagger';

import { ExcelFilePipe } from '@/common/pipes/excel-file.pipe';
import { ARFreightDto } from '@/modules/accounts-receivable/dtos/ar-freight.dto';
import { ExcelService } from '@/modules/excel/excel.service';

/**
 * Data Migration - Account Receivable
 */
@Controller('DataMigration/AccountReceivable')
export class AccountsReceivableController {
  constructor(private readonly excelService: ExcelService) {}

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
    const data = await this.excelService.excelToJson(file.buffer);

    console.info(body);

    return data.slice(0, 10);
  }
}
