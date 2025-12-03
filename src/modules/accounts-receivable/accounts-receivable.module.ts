import { Module } from '@nestjs/common';

import { AccountsReceivableController } from '@/modules/accounts-receivable/accounts-receivable.controller';
import { ExcelModule } from '@/modules/excel/excel.module';

@Module({
  imports: [ExcelModule],
  controllers: [AccountsReceivableController],
  providers: [],
})
export class AccountsReceivableModule {}
