import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { DBService } from '@/modules/db/db.service';
import { MultiLayerCacheService } from '@/modules/resilience/services/mutli-layer-cache.service';

export enum ServiceTypes {
  Freight = 1,
  Trucking = 2,
  FreightCreditNote = 3,
  TruckingCreditNote = 4,
}

export const ServiceTypesEnum = ServiceTypes;

export interface FinancialDimension {
  id: string;
  financialKey: string;
  dimensionValues: FinancialDimensionValue[];
}

export interface FinancialDimensionValue {
  id: string;
  financialDimensionKey: string;
  value: string;
  description?: string;
}

export interface AccountCustomerInvoiceMapping {
  id: string;
  name: string;
  customerAccount: string;
  invoiceAccount: string;
  serviceType: ServiceTypes;
}

export interface ChartOfAccount {
  id: string;
  chartNumber: string;
  accounts?: MainAccount[];
}

export interface MainAccount {
  id: string;
  chartNumber: string;
  accountNumber: string;
}

@Injectable()
export class MasterDataService implements OnModuleInit {
  private readonly logger = new Logger(MasterDataService.name);
  private readonly cacheWarmupEnabled: boolean;

  constructor(
    private readonly db: DBService,
    private readonly cache: MultiLayerCacheService,
    private readonly configService: ConfigService,
  ) {
    this.cacheWarmupEnabled = this.configService.get<boolean>(
      'MASTER_DATA_CACHE_WARMUP',
      true,
    );
  }

  async onModuleInit() {
    if (this.cacheWarmupEnabled) {
      this.logger.log('Warming up master data cache...');
      await this.warmUpCache();
    }
  }

  /**
   * Get all financial dimensions with values (cached)
   */
  public async getFinancialDimensions(): Promise<FinancialDimension[]> {
    return this.cache.get('master-data:financial-dimensions:all', async () => {
      const dimensions = await this.db.financialDimensionModel
        .find()
        .populate('dimensionValues') // uses ref in schema
        .lean();

      return dimensions.map((d: any) => ({
        id: d._id.toString(),
        financialKey: d.financialKey,
        dimensionValues: (d?.dimensionValues || []).map((v: any) => ({
          id: v._id.toString(),
          financialDimensionKey: v.financialDimensionKey,
          value: v.value,
          description: v.description || undefined,
        })),
      }));
    });
  }

  /**
   * Get dimension values by dimension key (cached)
   */
  public async getDimensionValues(
    financialKey: string,
  ): Promise<FinancialDimensionValue[]> {
    return this.cache.get(
      `master-data:dimension-values:${financialKey}`,
      async () => {
        const dimension = (await this.db.financialDimensionModel
          .findOne({ financialKey })
          .populate('dimensionValues')
          .lean()) as any;

        if (!dimension) {
          return [];
        }

        return dimension.dimensionValues.map((v: any) => ({
          id: v._id.toString(),
          financialDimensionKey: v.financialDimensionKey,
          value: v.value,
          description: v.description || undefined,
        }));
      },
      {
        l1Ttl: 300000,
        l2Ttl: 1800000,
        l3Ttl: 7200000,
      },
    );
  }

  /**
   * Get account customer invoice mappings by service type (cached)
   */
  public async getAccountCustomerInvoiceMappings(
    serviceType: ServiceTypes,
  ): Promise<AccountCustomerInvoiceMapping[]> {
    return this.cache.get(
      `master-data:account-mappings:${serviceType}`,
      async () => {
        const mappings = await this.db.accountCustomerInvoiceMappingModel
          .find({ serviceType })
          .lean();

        return mappings.map((m: any) => ({
          id: m._id.toString(),
          name: m.name,
          customerAccount: m.customerAccount,
          invoiceAccount: m.invoiceAccount,
          serviceType: m.serviceType as ServiceTypes,
        }));
      },
      {
        l1Ttl: 300000,
        l2Ttl: 1800000,
        l3Ttl: 7200000,
      },
    );
  }

  /**
   * Get chart of accounts with accounts (cached)
   */
  public async getChartOfAccounts(): Promise<ChartOfAccount[]> {
    return this.cache.get(
      'master-data:chart-of-accounts:all',
      async () => {
        const charts = await this.db.chartOfAccountModel
          .find()
          .populate('accounts')
          .lean();

        return charts.map((c: any) => ({
          id: c._id.toString(),
          chartNumber: c.chartNumber,
          accounts: (c.accounts || []).map((a: any) => ({
            id: a._id.toString(),
            chartNumber: a.chartNumber,
            accountNumber: a.accountNumber,
          })),
        }));
      },
      {
        l1Ttl: 300000,
        l2Ttl: 1800000,
        l3Ttl: 7200000,
      },
    );
  }

  /**
   * Get main accounts by chart number (cached)
   */
  public async getMainAccounts(chartNumber: string): Promise<MainAccount[]> {
    return this.cache.get(
      `master-data:main-accounts:${chartNumber}`,
      async () => {
        const accounts = await this.db.mainAccountModel
          .find({ chartNumber })
          .lean();

        return accounts.map((a) => ({
          id: a._id.toString(),
          chartNumber: a.chartNumber,
          accountNumber: a.accountNumber,
        }));
      },
      {
        l1Ttl: 300000,
        l2Ttl: 1800000,
        l3Ttl: 7200000,
      },
    );
  }

  /**
   * Get all main accounts across all charts (cached)
   */
  public async getAllMainAccounts(): Promise<MainAccount[]> {
    return this.cache.get(
      'master-data:main-accounts:all',
      async () => {
        const accounts = await this.db.mainAccountModel.find().lean();

        return accounts.map((a) => ({
          id: a._id.toString(),
          chartNumber: a.chartNumber,
          accountNumber: a.accountNumber,
        }));
      },
      {
        l1Ttl: 300000,
        l2Ttl: 1800000,
        l3Ttl: 7200000,
      },
    );
  }

  /**
   * Get financial dimension values as string array by dimension key (cached)
   */
  public async getFinancialDimensionValues(
    financialKey: string,
  ): Promise<string[]> {
    const dimensionValues = await this.getDimensionValues(financialKey);
    return dimensionValues.map((dv) => dv.value);
  }

  /**
   * Invalidate cache for master data
   */
  public async invalidateCache(): Promise<void> {
    await Promise.all([
      this.cache.delete('master-data:financial-dimensions:all'),
      this.cache.delete('master-data:chart-of-accounts:all'),
      this.cache.delete('master-data:account-mappings:1'),
      this.cache.delete('master-data:account-mappings:2'),
    ]);
  }

  /**
   * Warm up cache on startup
   */
  private async warmUpCache(): Promise<void> {
    try {
      const warmupTasks = [
        this.getFinancialDimensions(),
        this.getChartOfAccounts(),
        this.getAccountCustomerInvoiceMappings(ServiceTypes.Freight),
        this.getAccountCustomerInvoiceMappings(ServiceTypes.Trucking),
      ];

      await Promise.all(warmupTasks);
      this.logger.log('Master data cache warmed up successfully');
    } catch (error) {
      this.logger.error('Failed to warm up master data cache', error);
    }
  }
}
