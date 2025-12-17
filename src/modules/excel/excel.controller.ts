import {
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes } from '@nestjs/swagger';

import { ExcelFilePipe } from '@/common/pipes/excel-file.pipe';
import { Public } from '@/modules/auth/decorators/public.decorator';
import { ExcelService } from '@/modules/excel/excel.service';

@Public()
@Controller('excel')
export class ExcelController {
  constructor(private readonly excelService: ExcelService) {}

  @Post('to-json')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
      required: ['file'],
    },
  })
  @UseInterceptors(FileInterceptor('file'))
  public async excelToJson(
    @UploadedFile(new ExcelFilePipe()) file: MulterFile,
  ): Promise<unknown[]> {
    const data = (
      await this.excelService.excelToJson<unknown>(file.buffer)
    ).slice(0, 10);

    return data;
  }
}
