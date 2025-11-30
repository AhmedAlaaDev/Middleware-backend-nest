import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../database/services/prisma.service';
import { MultiLayerCacheService } from '../../cache/services/multi-layer-cache.service';
import { ConfigService } from '@nestjs/config';

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
    private readonly prisma: PrismaService,
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
  async getFinancialDimensions(): Promise<FinancialDimension[]> {
    return this.cache.get(
      'master-data:financial-dimensions:all',
      async () => {
        const dimensions = await this.prisma.financialDimension.findMany({
          include: {
            dimensionValues: true,
          },
        });

        return dimensions.map((d: any) => ({
          id: d.id,
          financialKey: d.financialKey,
          dimensionValues: d.dimensionValues.map((v: any) => ({
            id: v.id,
            financialDimensionKey: v.financialDimensionKey,
            value: v.value,
            description: v.description || undefined,
          })),
        }));
      },
      {
        l1Ttl: this.configService.get<number>('cache.l1Ttl', 300) * 1000, // 5 minutes
        l2Ttl: this.configService.get<number>('cache.l2Ttl', 1800) * 1000, // 30 minutes
        l3Ttl: this.configService.get<number>('cache.l3Ttl', 7200) * 1000, // 2 hours
      },
    );
  }

  /**
   * Get dimension values by dimension key (cached)
   */
  async getDimensionValues(
    financialKey: string,
  ): Promise<FinancialDimensionValue[]> {
    return this.cache.get(
      `master-data:dimension-values:${financialKey}`,
      async () => {
        const dimension = await this.prisma.financialDimension.findUnique({
          where: { financialKey },
          include: { dimensionValues: true },
        });

        if (!dimension) {
          return [];
        }

        return dimension.dimensionValues.map((v: any) => ({
          id: v.id,
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
  async getAccountCustomerInvoiceMappings(
    serviceType: ServiceTypes,
  ): Promise<AccountCustomerInvoiceMapping[]> {
    return this.cache.get(
      `master-data:account-mappings:${serviceType}`,
      async () => {
        const mappings =
          await this.prisma.accountCustomerInvoiceMapping.findMany({
            where: { serviceType },
          });

        return mappings.map((m: any) => ({
          id: m.id,
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
  async getChartOfAccounts(): Promise<ChartOfAccount[]> {
    return this.cache.get(
      'master-data:chart-of-accounts:all',
      async () => {
        const charts = await this.prisma.chartOfAccount.findMany({
          include: {
            accounts: true,
          },
        });

        return charts.map((c: any) => ({
          id: c.id,
          chartNumber: c.chartNumber,
          accounts: c.accounts.map((a: any) => ({
            id: a.id,
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
  async getMainAccounts(chartNumber: string): Promise<MainAccount[]> {
    return this.cache.get(
      `master-data:main-accounts:${chartNumber}`,
      async () => {
        const accounts = await this.prisma.mainAccount.findMany({
          where: { chartNumber },
        });

        return accounts.map((a: any) => ({
          id: a.id,
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

  /**
   * Invalidate cache for master data
   */
  async invalidateCache(): Promise<void> {
    await Promise.all([
      this.cache.delete('master-data:financial-dimensions:all'),
      this.cache.delete('master-data:chart-of-accounts:all'),
      this.cache.delete('master-data:account-mappings:1'),
      this.cache.delete('master-data:account-mappings:2'),
    ]);
  }
}

