import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { ApiResponse, ApiBody, ApiBearerAuth } from '@nestjs/swagger';

import { ApiPaginatedResponse } from '@/common/decorators/api-paginated-response.decorator';
import { IPaginatedRes } from '@/common/interfaces/paginated-res.interface';
import {
  CreateSyncBillingDataJobCommand,
  CreateSyncCustomersJobCommand,
  CreateSyncExchangeRatesJobCommand,
  CreateSyncFinancialDimensionsJobCommand,
  CreateSyncMainAccountsJobCommand,
  CreateSyncVendorsJobCommand,
  SaveAccountMappingsCommand,
} from '@/modules/master-data/commands';
import {
  GetExchangeRatesDto,
  GetFinancialDimensionDto,
  SaveAccountMappingDto,
  SyncBillingDataDto,
  SyncCustomersDto,
  SyncExchangeRatesDto,
  SyncFinancialDimensionsDto,
  SyncMainAccountsDto,
  SyncStatusDto,
  SyncVendorsDto,
} from '@/modules/master-data/dtos';
import { ServiceTypes } from '@/modules/master-data/enums';
import {
  ICreateAccountCustomerInvoiceMapping,
  IFinancialDimension,
} from '@/modules/master-data/interfaces';
import {
  GetAccountMappingsQuery,
  GetBillingClassificationsQuery,
  GetBillingCodesQuery,
  GetCustomersQuery,
  GetExchangeRatesQuery,
  GetFinancialDimensionsQuery,
  GetMainAccountsQuery,
  GetSyncStatusQuery,
  GetVendorsQuery,
} from '@/modules/master-data/queries';

/**
 * Finance - Master Data
 */
@ApiBearerAuth()
@Controller('Finance/MasterData')
export class MasterDataController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  /**
   * Get customers from database (Query)
   */
  @Get('customers')
  @ApiResponse({
    status: 200,
    description: 'Customers retrieved successfully',
  })
  public getCustomersAsync(
    @Query('company') company?: string,
    @Query('searchTerm') searchTerm?: string,
  ) {
    return this.queryBus.execute(new GetCustomersQuery(company, searchTerm));
  }

  /**
   * Sync customers from D365FO (insert if not exist, update if exists)
   */
  @Post('customers/sync')
  @HttpCode(HttpStatus.OK)
  @ApiResponse({
    status: 200,
    description: 'Sync job created successfully',
  })
  @ApiResponse({
    status: 409,
    description: 'A sync job is already pending or processing',
  })
  public async syncCustomersAsync(@Query() dto: SyncCustomersDto) {
    return this.commandBus.execute(
      new CreateSyncCustomersJobCommand(dto.company),
    );
  }

  /**
   * Get financial dimensions from database (Query)
   */
  @Get('financial-dimensions')
  @ApiPaginatedResponse(IFinancialDimension)
  public getFinancialDimensionsAsync(
    @Query() query: GetFinancialDimensionDto,
  ): Promise<IPaginatedRes<IFinancialDimension>> {
    return this.queryBus.execute(
      new GetFinancialDimensionsQuery(query.maxCount, query.skipCount),
    );
  }

  /**
   * Sync financial dimensions from D365FO (insert if not exist, update if exists)
   */
  @Post('financial-dimensions/sync')
  @HttpCode(HttpStatus.OK)
  @ApiResponse({
    status: 200,
    description: 'Sync job created successfully',
  })
  @ApiResponse({
    status: 409,
    description: 'A sync job is already pending or processing',
  })
  public async syncFinancialDimensionsAsync(
    @Query() dto: SyncFinancialDimensionsDto,
  ) {
    return this.commandBus.execute(
      new CreateSyncFinancialDimensionsJobCommand(dto.company),
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
  public getBillingClassificationsAsync(@Query('company') company?: string) {
    return this.queryBus.execute(new GetBillingClassificationsQuery(company));
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
    description: 'Sync job created successfully',
  })
  @ApiResponse({
    status: 409,
    description: 'A sync job is already pending or processing',
  })
  public async syncBillingDataAsync(@Query() dto: SyncBillingDataDto) {
    return this.commandBus.execute(
      new CreateSyncBillingDataJobCommand(dto.company),
    );
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
    description: 'Sync job created successfully',
  })
  @ApiResponse({
    status: 409,
    description: 'A sync job is already pending or processing',
  })
  public async syncMainAccountsAsync(@Query() dto: SyncMainAccountsDto) {
    return this.commandBus.execute(
      new CreateSyncMainAccountsJobCommand(dto.chartOfAccounts),
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
   * Each mapping object must include: name, customerAccount, invoiceAccount, and serviceType
   * Request body should be an array of mapping objects: [{ name, customerAccount, invoiceAccount, serviceType }, ...]
   */
  @Post('account-mappings')
  @HttpCode(HttpStatus.OK)
  @ApiBody({
    description:
      'Array of account mappings. Each mapping must include: name, customerAccount, invoiceAccount, and serviceType',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'customerAccount', 'invoiceAccount', 'serviceType'],
        properties: {
          name: {
            type: 'string',
            example: 'Freight Service Account',
            description: 'Name of the account mapping',
          },
          customerAccount: {
            type: 'string',
            example: 'CUST001',
            description: 'Customer account number',
          },
          invoiceAccount: {
            type: 'string',
            example: 'INV001',
            description: 'Invoice account number',
          },
          serviceType: {
            type: 'number',
            enum: [1, 2, 3, 4],
            example: 1,
            description:
              'Service type: 1=Freight, 2=Trucking, 3=FreightCreditNote, 4=TruckingCreditNote',
          },
        },
      },
    },
    examples: {
      example1: {
        summary: 'Array of account mappings',
        value: [
          {
            name: 'Freight Service Account',
            customerAccount: 'CUST001',
            invoiceAccount: 'INV001',
            serviceType: 1,
          },
          {
            name: 'Trucking Service Account',
            customerAccount: 'CUST002',
            invoiceAccount: 'INV002',
            serviceType: 2,
          },
        ],
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Account mappings saved successfully',
  })
  public saveAccountMappingsAsync(@Body() mappings: SaveAccountMappingDto[]) {
    // Convert DTO to command data format
    const commandMappings: ICreateAccountCustomerInvoiceMapping[] =
      mappings.map((m) => ({
        name: m.name,
        customerAccount: m.customerAccount,
        invoiceAccount: m.invoiceAccount,
        serviceType: m.serviceType,
      }));
    return this.commandBus.execute(
      new SaveAccountMappingsCommand(commandMappings),
    );
  }

  /**
   * Get vendors from database (Query)
   */
  @Get('vendors')
  @ApiResponse({
    status: 200,
    description: 'Vendors retrieved successfully',
  })
  public async getVendorsAsync(@Query('company') company?: string) {
    return this.queryBus.execute(new GetVendorsQuery({ company }));
  }

  /**
   * Sync vendors from D365FO (insert if not exist, update if exists)
   */
  @Post('vendors/sync')
  @HttpCode(HttpStatus.OK)
  @ApiResponse({
    status: 200,
    description: 'Sync job created successfully',
  })
  @ApiResponse({
    status: 409,
    description: 'A sync job is already pending or processing',
  })
  public async syncVendorsAsync(@Query() dto: SyncVendorsDto) {
    return this.commandBus.execute(
      new CreateSyncVendorsJobCommand(dto.company),
    );
  }

  /**
   * Get exchange rates from database (Query)
   */
  @Get('exchange-rates')
  @ApiResponse({
    status: 200,
    description: 'Exchange rates retrieved successfully',
  })
  public getExchangeRatesAsync(
    @Query() getExchangeRatesDto: GetExchangeRatesDto,
  ) {
    return this.queryBus.execute(
      new GetExchangeRatesQuery(
        getExchangeRatesDto.rateType,
        getExchangeRatesDto.fromCurrency,
        getExchangeRatesDto.toCurrency,
        getExchangeRatesDto.fromDate,
        getExchangeRatesDto.toDate,
      ),
    );
  }

  /**
   * Sync exchange rates from D365FO (insert if not exist, update if exists)
   */
  @Post('exchange-rates/sync')
  @HttpCode(HttpStatus.OK)
  @ApiResponse({
    status: 200,
    description: 'Sync job created successfully',
  })
  @ApiResponse({
    status: 409,
    description: 'A sync job is already pending or processing',
  })
  public async syncExchangeRatesAsync(@Query() dto: SyncExchangeRatesDto) {
    return this.commandBus.execute(
      new CreateSyncExchangeRatesJobCommand(dto.company, dto.rateType),
    );
  }

  /**
   * Get sync status for all master data sync types
   * Returns a static list of sync types with their current status
   * Frontend should poll this endpoint every 30 seconds if any job is pending or processing
   */
  @Get('sync-status')
  @ApiResponse({
    status: 200,
    description: 'Sync status retrieved successfully',
    type: [SyncStatusDto],
  })
  public async getSyncStatusAsync(): Promise<SyncStatusDto[]> {
    return this.queryBus.execute(new GetSyncStatusQuery());
  }
}
