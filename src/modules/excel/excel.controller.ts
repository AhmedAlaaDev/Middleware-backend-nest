import {
  Controller,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
} from '@nestjs/swagger';

import { PaginatedDto } from '@/common/dtos/paginated.dto';
import { IPaginatedRes } from '@/common/interfaces/paginated-res.interface';
import { ExcelFilePipe } from '@/common/pipes/excel-file.pipe';
import { ExcelService } from '@/modules/excel/excel.service';

@ApiBearerAuth()
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
  @ApiOkResponse({
    description: 'Paginated rows from the Excel file',
    schema: {
      type: 'object',
      properties: {
        items: { type: 'array', items: {} },
        totalCount: { type: 'number' },
        pageSize: { type: 'number' },
        pageNumber: { type: 'number' },
        totalPages: { type: 'number' },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file'))
  public async excelToJson(
    @UploadedFile(new ExcelFilePipe()) file: Express.Multer.File,
    @Query() pagination: PaginatedDto,
  ): Promise<IPaginatedRes<unknown>> {
    const data = await this.excelService.excelToJson<unknown>(file.buffer);
    const totalCount = data.length;
    const skipCount = pagination.skipCount ?? 0;
    const maxCount = pagination.maxCount ?? 150;
    const items = data.slice(skipCount, skipCount + maxCount);

    return new IPaginatedRes(items, totalCount, maxCount, skipCount);
  }
}
