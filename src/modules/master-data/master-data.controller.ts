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
  CreateSyncLedgersJobCommand,
  CreateSyncMainAccountsJobCommand,
  CreateSyncPaymentTermsJobCommand,
  CreateSyncTaxItemGroupHeadingsJobCommand,
  CreateSyncVendorsJobCommand,
  SaveAccountMappingsCommand,
} from '@/modules/master-data/commands';
import {
  GetAccountMappingsDto,
  GetBillingClassificationsDto,
  GetBillingCodesDto,
  GetCustomersDto,
  GetExchangeRatesDto,
  GetFinancialDimensionDto,
  GetFinancialDimensionWithValuesDto,
  GetLedgersDto,
  GetMainAccountsDto,
  GetPaymentTermsDto,
  GetTaxItemGroupHeadingsDto,
  GetVendorsDto,
  SaveAccountMappingDto,
  SyncBillingDataDto,
  SyncCustomersDto,
  SyncExchangeRatesDto,
  SyncFinancialDimensionsDto,
  SyncLedgersDto,
  SyncMainAccountsDto,
  SyncPaymentTermsDto,
  SyncTaxItemGroupHeadingsDto,
  SyncStatusDto,
  SyncVendorsDto,
} from '@/modules/master-data/dtos';
import {
  IAccountCustomerInvoiceMapping,
  ICreateAccountCustomerInvoiceMapping,
  IBillingClassification,
  IBillingCode,
  ICustomer,
  IFinancialDimension,
  IFinancialDimensionValue,
  IExchangeRate,
  ILedger,
  IMainAccount,
  IPaymentTerm,
  ITaxItemGroupHeading,
  IVendor,
} from '@/modules/master-data/interfaces';
import {
  GetAccountMappingsQuery,
  GetBillingClassificationsQuery,
  GetBillingCodesQuery,
  GetCustomersQuery,
  GetExchangeRatesQuery,
  GetFinancialDimensionValueQuery,
  GetFinancialDimensionsQuery,
  GetLedgersQuery,
  GetMainAccountsQuery,
  GetPaymentTermsQuery,
  GetTaxItemGroupHeadingsQuery,
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
  @ApiPaginatedResponse(ICustomer)
  public getCustomersAsync(
    @Query() query: GetCustomersDto,
  ): Promise<IPaginatedRes<ICustomer>> {
    return this.queryBus.execute(
      new GetCustomersQuery(
        { company: query.company, searchTerm: query.searchTerm },
        query.skipCount,
        query.maxCount,
      ),
    );
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
   * Get a single financial dimension with its values (Query)
   * Optional filtering by value (case-insensitive partial match)
   */
  @Get('financial-dimensions/values')
  @ApiResponse({
    status: 200,
    description: 'Financial dimension with values retrieved successfully',
  })
  public getFinancialDimensionWithValuesAsync(
    @Query() query: GetFinancialDimensionWithValuesDto,
  ): Promise<IFinancialDimensionValue[]> {
    return this.queryBus.execute(
      new GetFinancialDimensionValueQuery(query.financialKey, {
        value: query.value,
      }),
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
  @ApiPaginatedResponse(IBillingClassification)
  public getBillingClassificationsAsync(
    @Query() query: GetBillingClassificationsDto,
  ): Promise<IPaginatedRes<IBillingClassification>> {
    return this.queryBus.execute(
      new GetBillingClassificationsQuery(
        { company: query.company },
        query.skipCount,
        query.maxCount,
      ),
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
  @ApiPaginatedResponse(IBillingCode)
  public getBillingCodesAsync(
    @Query() query: GetBillingCodesDto,
  ): Promise<IPaginatedRes<IBillingCode>> {
    return this.queryBus.execute(
      new GetBillingCodesQuery(
        {
          company: query.company,
          billingClassification: query.billingClassification,
        },
        query.skipCount,
        query.maxCount,
      ),
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
  @ApiPaginatedResponse(IMainAccount)
  public getMainAccountsAsync(
    @Query() query: GetMainAccountsDto,
  ): Promise<IPaginatedRes<IMainAccount>> {
    return this.queryBus.execute(
      new GetMainAccountsQuery(
        {
          chartNumber: query.chartOfAccounts,
          accountName: query.accountName,
        },
        query.skipCount,
        query.maxCount,
      ),
    );
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
  @ApiPaginatedResponse(IAccountCustomerInvoiceMapping)
  public getAccountMappingsAsync(
    @Query() query: GetAccountMappingsDto,
  ): Promise<IPaginatedRes<IAccountCustomerInvoiceMapping>> {
    return this.queryBus.execute(
      new GetAccountMappingsQuery(
        { serviceType: query.serviceType },
        query.skipCount,
        query.maxCount,
      ),
    );
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
  @ApiPaginatedResponse(IVendor)
  public async getVendorsAsync(
    @Query() query: GetVendorsDto,
  ): Promise<IPaginatedRes<IVendor>> {
    return this.queryBus.execute(
      new GetVendorsQuery(
        { company: query.company },
        query.skipCount,
        query.maxCount,
      ),
    );
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
  @ApiPaginatedResponse(IExchangeRate)
  public getExchangeRatesAsync(
    @Query() getExchangeRatesDto: GetExchangeRatesDto,
  ): Promise<IPaginatedRes<IExchangeRate>> {
    return this.queryBus.execute(
      new GetExchangeRatesQuery(
        {
          rateTypeName: getExchangeRatesDto.rateType,
          fromCurrency: getExchangeRatesDto.fromCurrency,
          toCurrency: getExchangeRatesDto.toCurrency,
          fromDate: getExchangeRatesDto.fromDate
            ? new Date(getExchangeRatesDto.fromDate)
            : undefined,
          toDate: getExchangeRatesDto.toDate
            ? new Date(getExchangeRatesDto.toDate)
            : undefined,
        },
        getExchangeRatesDto.skipCount,
        getExchangeRatesDto.maxCount,
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
   * Get payment terms from database (Query)
   */
  @Get('payment-terms')
  @ApiResponse({
    status: 200,
    description: 'Payment terms retrieved successfully',
  })
  @ApiPaginatedResponse(IPaymentTerm)
  public getPaymentTermsAsync(
    @Query() query: GetPaymentTermsDto,
  ): Promise<IPaginatedRes<IPaymentTerm>> {
    return this.queryBus.execute(
      new GetPaymentTermsQuery(
        { company: query.company, name: query.name },
        query.skipCount,
        query.maxCount,
      ),
    );
  }

  /**
   * Sync payment terms from D365FO (insert if not exist, update if exists)
   */
  @Post('payment-terms/sync')
  @HttpCode(HttpStatus.OK)
  @ApiResponse({
    status: 200,
    description: 'Sync job created successfully',
  })
  @ApiResponse({
    status: 409,
    description: 'A sync job is already pending or processing',
  })
  public async syncPaymentTermsAsync(@Query() dto: SyncPaymentTermsDto) {
    return this.commandBus.execute(
      new CreateSyncPaymentTermsJobCommand(dto.company),
    );
  }

  /**
   * Get tax item group headings (Item sales tax groups) from database (synced from D365FO)
   */
  @Get('tax-item-group-headings')
  @ApiResponse({
    status: 200,
    description: 'Tax item group headings retrieved successfully',
  })
  @ApiPaginatedResponse(ITaxItemGroupHeading)
  public getTaxItemGroupHeadingsAsync(
    @Query() query: GetTaxItemGroupHeadingsDto,
  ): Promise<IPaginatedRes<ITaxItemGroupHeading>> {
    return this.queryBus.execute(
      new GetTaxItemGroupHeadingsQuery(
        {
          dataAreaId: query.dataAreaId,
          taxItemGroup: query.taxItemGroup,
        },
        query.skipCount,
        query.maxCount,
      ),
    );
  }

  /**
   * Sync tax item group headings from D365FO (Item sales tax groups)
   */
  @Post('tax-item-group-headings/sync')
  @HttpCode(HttpStatus.OK)
  @ApiResponse({
    status: 200,
    description: 'Sync job created successfully',
  })
  @ApiResponse({
    status: 409,
    description: 'A sync job is already pending or processing',
  })
  public async syncTaxItemGroupHeadingsAsync(
    @Query() dto: SyncTaxItemGroupHeadingsDto,
  ) {
    return this.commandBus.execute(
      new CreateSyncTaxItemGroupHeadingsJobCommand(dto.company),
    );
  }

  /**
   * Get ledgers from database (Query)
   */
  @Get('ledgers')
  @ApiResponse({
    status: 200,
    description: 'Ledgers retrieved successfully',
  })
  @ApiPaginatedResponse(ILedger)
  public getLedgersAsync(
    @Query() query: GetLedgersDto,
  ): Promise<IPaginatedRes<ILedger>> {
    return this.queryBus.execute(
      new GetLedgersQuery(
        { company: query.company },
        query.skipCount,
        query.maxCount,
      ),
    );
  }

  /**
   * Sync ledgers from D365FO (insert if not exist, update if exists)
   */
  @Post('ledgers/sync')
  @HttpCode(HttpStatus.OK)
  @ApiResponse({
    status: 200,
    description: 'Sync job created successfully',
  })
  @ApiResponse({
    status: 409,
    description: 'A sync job is already pending or processing',
  })
  public async syncLedgersAsync(@Query() dto: SyncLedgersDto) {
    return this.commandBus.execute(
      new CreateSyncLedgersJobCommand(dto.company),
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
