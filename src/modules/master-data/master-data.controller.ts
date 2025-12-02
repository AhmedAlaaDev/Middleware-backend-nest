import { Controller, Get, Post, Query, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import { CommandBus, QueryBus } from '@nestjs/cqrs';

import { GetAccountMappingsQuery } from '@/modules/master-data/queries/get-account-mappings.query';
import { GetCustomersQuery } from '@/modules/master-data/queries/get-customers.query';
import { GetBillingClassificationsQuery } from '@/modules/master-data/queries/get-billing-classifications.query';
import { GetBillingCodesQuery } from '@/modules/master-data/queries/get-billing-codes.query';
import { GetFinancialDimensionsQuery } from '@/modules/master-data/queries/get-financial-dimensions.query';
import { GetMainAccountsQuery } from '@/modules/master-data/queries/get-main-accounts.query';
import { SaveAccountMappingsCommand, AccountMappingData } from '@/modules/master-data/commands/save-account-mappings.command';
import { SyncBillingDataCommand } from '@/modules/master-data/commands/sync-billing-data.command';
import { SyncFinancialDimensionsCommand } from '@/modules/master-data/commands/sync-financial-dimensions.command';
import { SyncMainAccountsCommand } from '@/modules/master-data/commands/sync-main-accounts.command';
import { SyncVendorsCommand } from '@/modules/master-data/commands/sync-vendors.command';
import { GetVendorsQuery } from '@/modules/master-data/queries/get-vendors.query';
import { ServiceTypes } from '@/modules/master-data/types/master-data.types';

/**
 * Finance - Master Data
 */
@Controller('Finance/MasterData')
export class MasterDataController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  /**
   * Get customer list from D365FO (Query)
   */
  @Get('customers')
  @ApiResponse({
    status: 200,
    description: 'Customer list retrieved successfully',
  })
  public getCustomersAsync(
    @Query('company') company: string,
    @Query('skipCount') skipCount?: number,
    @Query('maxCount') maxCount?: number,
    @Query('searchTerm') searchTerm?: string,
  ) {
    return this.queryBus.execute(
      new GetCustomersQuery(
        company,
        skipCount ? parseInt(skipCount.toString(), 10) : 0,
        maxCount ? parseInt(maxCount.toString(), 10) : 50,
        searchTerm,
      ),
    );
  }

  /**
   * Get financial dimensions from database (Query)
   */
  @Get('financial-dimensions')
  @ApiResponse({
    status: 200,
    description: 'Financial dimensions retrieved successfully',
  })
  public getFinancialDimensionsAsync() {
    return this.queryBus.execute(new GetFinancialDimensionsQuery());
  }

  /**
   * Sync financial dimensions from D365FO (insert if not exist, update if exists)
   */
  @Post('financial-dimensions/sync')
  @HttpCode(HttpStatus.OK)
  @ApiResponse({
    status: 200,
    description: 'Financial dimensions synced successfully',
  })
  public syncFinancialDimensionsAsync(
    @Query('company') company?: string,
  ) {
    return this.commandBus.execute(
      new SyncFinancialDimensionsCommand(company),
    );
  }

  /**
   * Get billing classifications from database (Query)
   */
  @Get('billing-classifications')
  @ApiResponse({
    status: 200,
    description: 'Billing classifications retrieved successfully',
  })
  public getBillingClassificationsAsync(
    @Query('company') company?: string,
  ) {
    return this.queryBus.execute(
      new GetBillingClassificationsQuery(company),
    );
  }

  /**
   * Get billing codes from database (Query)
   */
  @Get('billing-codes')
  @ApiResponse({
    status: 200,
    description: 'Billing codes retrieved successfully',
  })
  public getBillingCodesAsync(
    @Query('company') company?: string,
    @Query('billingClassification') billingClassification?: string,
  ) {
    return this.queryBus.execute(
      new GetBillingCodesQuery(company, billingClassification),
    );
  }

  /**
   * Sync billing data from D365FO (insert if not exist, update if exists)
   */
  @Post('billing-data/sync')
  @HttpCode(HttpStatus.OK)
  @ApiResponse({
    status: 200,
    description: 'Billing data synced successfully',
  })
  public syncBillingDataAsync(@Query('company') company: string) {
    return this.commandBus.execute(new SyncBillingDataCommand(company));
  }

  /**
   * Get main accounts from database (Query)
   */
  @Get('main-accounts')
  @ApiResponse({
    status: 200,
    description: 'Main accounts retrieved successfully',
  })
  public getMainAccountsAsync(
    @Query('chartOfAccounts') chartOfAccounts?: string,
  ) {
    return this.queryBus.execute(new GetMainAccountsQuery(chartOfAccounts));
  }

  /**
   * Sync main accounts from D365FO (insert if not exist, update if exists)
   */
  @Post('main-accounts/sync')
  @HttpCode(HttpStatus.OK)
  @ApiResponse({
    status: 200,
    description: 'Main accounts synced successfully',
  })
  public syncMainAccountsAsync(
    @Query('chartOfAccounts') chartOfAccounts: string,
  ) {
    return this.commandBus.execute(
      new SyncMainAccountsCommand(chartOfAccounts),
    );
  }

  /**
   * Get account customer invoice mappings from database (Query)
   */
  @Get('account-mappings')
  @ApiResponse({
    status: 200,
    description: 'Account mappings retrieved successfully',
  })
  public getAccountMappingsAsync(
    @Query('serviceType') serviceType?: ServiceTypes,
  ) {
    return this.queryBus.execute(new GetAccountMappingsQuery(serviceType));
  }

  /**
   * Save account mappings (insert if not exist, update if exists)
   */
  @Post('account-mappings')
  @HttpCode(HttpStatus.OK)
  @ApiResponse({
    status: 200,
    description: 'Account mappings saved successfully',
  })
  public saveAccountMappingsAsync(
    @Body() mappings: AccountMappingData[],
  ) {
    return this.commandBus.execute(new SaveAccountMappingsCommand(mappings));
  }

  /**
   * Get vendors from database (Query)
   */
  @Get('vendors')
  @ApiResponse({
    status: 200,
    description: 'Vendors retrieved successfully',
  })
  public getVendorsAsync(
    @Query('company') company?: string,
  ) {
    return this.queryBus.execute(new GetVendorsQuery(company));
  }

  /**
   * Sync vendors from D365FO (insert if not exist, update if exists)
   */
  @Post('vendors/sync')
  @HttpCode(HttpStatus.OK)
  @ApiResponse({
    status: 200,
    description: 'Vendors synced successfully',
  })
  public syncVendorsAsync(@Query('company') company: string) {
    return this.commandBus.execute(new SyncVendorsCommand(company));
  }
}
