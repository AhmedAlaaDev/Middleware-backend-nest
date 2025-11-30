import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { LedgerController } from './controllers/ledger.controller';
import { EntryProcessorsModule } from '../entry-processors/entry-processors.module';
import { DataBatchesModule } from '../data-batches/data-batches.module';

const CommandHandlers = [];
const QueryHandlers = [];

@Module({
  imports: [CqrsModule, EntryProcessorsModule, DataBatchesModule],
  controllers: [LedgerController],
  providers: [...CommandHandlers, ...QueryHandlers],
})
export class LedgerModule {}

