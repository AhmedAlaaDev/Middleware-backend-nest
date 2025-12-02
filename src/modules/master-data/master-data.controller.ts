import { Controller, Get, Query } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';

import { D365FOClientService } from '@/modules/d365fo/services/d365fo-client.service';
import { MasterDataService } from '@/modules/master-data/master-data.service';

/**
 * Finance - Master Data
 */
@Controller('Finance/MasterData')
export class MasterDataController {
  constructor(
    private readonly masterDataService: MasterDataService,
    private readonly d365foClient: D365FOClientService,
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
    return this.d365foClient.get<any[]>(
      `/data/Customers?cross-company=true&$filter=dataAreaId eq '${company}'&$top=${maxCount}&$skip=${skipCount}`,
      {
        useCache: true,
        cacheTtl: 5 * 60 * 1000, // 5 minutes
      },
    );
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
