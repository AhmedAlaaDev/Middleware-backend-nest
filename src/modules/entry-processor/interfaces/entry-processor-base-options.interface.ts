import { EntryProcessorBaseDependencies } from '@/modules/entry-processor/services/entry-processor-base-dependencies.service';

export interface EntryProcessorBaseOptions {
  dependencies: EntryProcessorBaseDependencies;
  rateType?: string;
}
