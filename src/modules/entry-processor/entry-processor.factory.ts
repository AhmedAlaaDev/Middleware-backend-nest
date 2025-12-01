import { Injectable, Logger } from '@nestjs/common';

import {
  EntryProcessorTypes,
  IEntryProcessor,
} from '@/modules/entry-processor/interfaces/entry-processor.interface';
import { AccountReceivableFreightEntryProcessor } from '@/modules/entry-processor/processors/account-receivable-freight-entry.processor';
import { AccountReceivableTruckingEntryProcessor } from '@/modules/entry-processor/processors/account-receivable-trucking-entry.processor';

@Injectable()
export class EntryProcessorFactory {
  private readonly logger = new Logger(EntryProcessorFactory.name);
  private readonly processors: Map<string, IEntryProcessor> = new Map();

  constructor(
    private readonly accountReceivableFreightProcessor: AccountReceivableFreightEntryProcessor,
    private readonly accountReceivableTruckingProcessor: AccountReceivableTruckingEntryProcessor,
    // Add other processors here
  ) {
    this.registerProcessors();
  }

  private registerProcessors(): void {
    this.processors.set(
      'AccountReceivableFreightEntryProcessor',
      this.accountReceivableFreightProcessor,
    );
    this.processors.set(
      'AccountReceivableTruckingEntryProcessor',
      this.accountReceivableTruckingProcessor,
    );
    // Register other processors
  }

  public getProcessor(
    entryProcessorType: EntryProcessorTypes | string,
  ): IEntryProcessor {
    const processor = this.processors.get(entryProcessorType.toString());

    if (!processor) {
      this.logger.error(
        `Entry processor not found for type: ${entryProcessorType}`,
      );
      throw new Error(
        `Entry processor not found for type: ${entryProcessorType}`,
      );
    }

    return processor;
  }

  public getProcessorByName(name: string): IEntryProcessor {
    const processor = this.processors.get(name);

    if (!processor) {
      this.logger.error(`Entry processor not found with name: ${name}`);
      throw new Error(`Entry processor not found with name: ${name}`);
    }

    return processor;
  }

  public getAllProcessors(): IEntryProcessor[] {
    return Array.from(this.processors.values());
  }
}
