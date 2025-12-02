import { Controller, Get, Query } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';

import { CustomerService } from '@/modules/d365fo/services/customer.service';
import { MasterDataService } from '@/modules/master-data/master-data.service';

/**
 * Finance - Master Data
 */
@Controller('Finance/MasterData')
export class MasterDataController {
  constructor(
    private readonly masterDataService: MasterDataService,
    private readonly customerService: CustomerService,
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
    @Query('company') company: string = 'p-m',
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
   * Get financial dimensions from master data
   */
  @Get('financial-dimensions')
  @ApiResponse({
    status: 200,
    description: 'Financial dimensions retrieved successfully',
  })
  public getFinancialDimensionsAsync() {
    return this.masterDataService.getFinancialDimensions();
  }
}
