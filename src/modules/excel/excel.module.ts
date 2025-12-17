import { Module } from '@nestjs/common';

import { ExcelJsAdapter } from '@/modules/excel/adapters/exceljs.adapter';
import { ExcelController } from '@/modules/excel/excel.controller';
import { ExcelService } from '@/modules/excel/excel.service';
import { IExcelAdapter } from '@/modules/excel/interfaces/excel-adapter.interface';

@Module({
  controllers: [ExcelController],
  providers: [
    {
      provide: IExcelAdapter,
      useClass: ExcelJsAdapter,
    },
    ExcelService,
  ],
  exports: [ExcelService],
})
export class ExcelModule {}
