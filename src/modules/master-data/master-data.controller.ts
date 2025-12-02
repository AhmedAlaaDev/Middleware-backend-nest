import { Controller, Get, Post, Query, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import { CommandBus, QueryBus } from '@nestjs/cqrs';

import { GetAccountMappingsQuery } from '@/modules/master-data/queries/get-account-mappings.query';
import { SyncAccountMappingsCommand, AccountMappingData } from '@/modules/master-data/commands/sync-account-mappings.command';
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
   * Sync account mappings (insert if not exist, update if exists)
   */
  @Post('account-mappings/sync')
  @HttpCode(HttpStatus.OK)
  @ApiResponse({
    status: 200,
    description: 'Account mappings synced successfully',
  })
  public syncAccountMappingsAsync(
    @Body() mappings: AccountMappingData[],
  ) {
    return this.commandBus.execute(new SyncAccountMappingsCommand(mappings));
  }
}
