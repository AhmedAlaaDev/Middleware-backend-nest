import { Controller, Get, Post, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import { CommandBus, QueryBus } from '@nestjs/cqrs';

import { CustomerService } from '@/modules/d365fo/services/customer.service';
import { SyncFinancialDimensionsCommand } from '@/modules/master-data/commands/sync-financial-dimensions.command';
import { GetFinancialDimensionsQuery } from '@/modules/master-data/queries/get-financial-dimensions.query';

/**
 * Finance - Master Data
 */
@Controller('Finance/MasterData')
export class MasterDataController {
  constructor(
    private readonly customerService: CustomerService,
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  /**
   * Get customer list from D365FO
   */
  @Get('customer-list')
  @ApiResponse({
    status: 200,
    description: 'Customer list retrieved successfully',
  })
  public getCustomerListAsync(
    @Query('company') company: string,
    @Query('skipCount') skipCount: number = 0,
    @Query('maxCount') maxCount: number = 50,
  ): Promise<any> {
    return this.customerService.getCustomerList(company, {
      skipCount,
      maxCount,
      useCache: true,
    });
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
}
