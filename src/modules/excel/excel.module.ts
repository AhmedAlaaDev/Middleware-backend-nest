import { Module } from '@nestjs/common';

import { ExcelJsAdapter } from '@/modules/excel/adapters/exceljs.adapter';
import { ExcelService } from '@/modules/excel/excel.service';
import { IExcelAdapter } from '@/modules/excel/interfaces/excel-adapter.interface';

@Module({
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
