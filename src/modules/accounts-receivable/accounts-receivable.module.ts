import { Module } from '@nestjs/common';

import { AccountsReceivableController } from '@/modules/accounts-receivable/accounts-receivable.controller';

@Module({
  imports: [],
  controllers: [AccountsReceivableController],
  providers: [],
})
export class AccountsReceivableModule {}
