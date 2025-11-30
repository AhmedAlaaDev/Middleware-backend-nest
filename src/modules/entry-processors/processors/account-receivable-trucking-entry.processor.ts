import { Injectable } from '@nestjs/common';
import { EntryProcessorTypes } from '../../../data-batches/schemas/data-batch.schema';
import { EntryProcessorBase } from './base/entry-processor.base';
import { D365FODataService } from '../../d365fo/services/d365fo-data.service';
import { MasterDataService } from '../../master-data/services/master-data.service';
import { PrismaService } from '../../database/services/prisma.service';
import { RawDataModel, DynDataModel } from '../../interfaces/entry-processor.interface';

@Injectable()
export class AccountReceivableTruckingEntryProcessor extends EntryProcessorBase {
  readonly entryProcessorType = EntryProcessorTypes.AccountReceivableTrucking;
  readonly requiredDimensions = [
    'MainAccount',
    'Activity',
    'CostCenters',
    'BusinessUnit',
    'Location',
    'Customer',
    'SubCustomer',
    'ChargeType',
    'SalesMan',
    'CoordinatorMan',
    'FreightType',
    'Direction',
  ];

  constructor(
    d365FODataService: D365FODataService,
    masterDataService: MasterDataService,
    prisma: PrismaService,
  ) {
    super(d365FODataService, masterDataService, prisma);
  }

  async formatAndEnrichAsync(
    data: RawDataModel[],
    company: string,
    billingClassId?: string,
  ): Promise<DynDataModel[]> {
    // Similar to freight processor but for trucking
    return [];
  }

  async validateAsync(
    data: DynDataModel[],
    company: string,
    billingClassId?: string,
  ): Promise<DynDataModel[]> {
    return data;
  }

  async insertIntoDynamicsAsync(
    data: DynDataModel[],
    company: string,
  ): Promise<void> {
    // Implementation
  }

  parseToDimensions(dimensionString: string): any {
    return {};
  }

  convertToStringDimensions(dimensionsModel: any): string {
    return '';
  }
}

