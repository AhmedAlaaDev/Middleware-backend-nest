import { Controller, Get, Query, UseInterceptors, ClassSerializerInterceptor } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { MasterDataService } from '../services/master-data.service';
import { D365FODataService } from '../../d365fo/services/d365fo-data.service';

@Controller('Finance/MasterData')
@ApiTags('Finance - Master Data')
@UseInterceptors(ClassSerializerInterceptor)
export class MasterDataController {
  constructor(
    private readonly masterDataService: MasterDataService,
    private readonly d365FODataService: D365FODataService,
  ) {}

  @Get('customer-list')
  @ApiOperation({ summary: 'Get customer list from D365FO' })
  @ApiResponse({ status: 200, description: 'Customer list retrieved successfully' })
  async getCustomerListAsync(
    @Query('company') company: string = 'p-m',
    @Query('skipCount') skipCount: number = 0,
    @Query('maxCount') maxCount: number = 50,
  ): Promise<any> {
    return this.d365FODataService.getDataAsync<any[]>(
      `/data/Customers?cross-company=true&$filter=dataAreaId eq '${company}'&$top=${maxCount}&$skip=${skipCount}`,
    );
  }

  @Get('financial-dimensions')
  @ApiOperation({ summary: 'Get financial dimensions from master data' })
  @ApiResponse({ status: 200, description: 'Financial dimensions retrieved successfully' })
  async getFinancialDimensionsAsync() {
    return this.masterDataService.getFinancialDimensions();
  }
}

