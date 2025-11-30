import { IEntryProcessor, RawDataModel, DynDataModel } from '../../interfaces/entry-processor.interface';
import { EntryProcessorTypes } from '../../../data-batches/schemas/data-batch.schema';
import { D365FODataService } from '../../../d365fo/services/d365fo-data.service';
import { MasterDataService } from '../../../master-data/services/master-data.service';
import { PrismaService } from '../../../database/services/prisma.service';

export abstract class EntryProcessorBase implements IEntryProcessor {
  abstract readonly entryProcessorType: EntryProcessorTypes;
  abstract readonly requiredDimensions: string[];

  constructor(
    protected readonly d365FODataService: D365FODataService,
    protected readonly masterDataService: MasterDataService,
    protected readonly prisma: PrismaService,
  ) {}

  abstract formatAndEnrichAsync(
    data: RawDataModel[],
    company: string,
    billingClassId?: string,
  ): Promise<DynDataModel[]>;

  abstract validateAsync(
    data: DynDataModel[],
    company: string,
    billingClassId?: string,
  ): Promise<DynDataModel[]>;

  abstract insertIntoDynamicsAsync(
    data: DynDataModel[],
    company: string,
  ): Promise<void>;

  abstract parseToDimensions(dimensionString: string): any;
  abstract convertToStringDimensions(dimensionsModel: any): string;
}

