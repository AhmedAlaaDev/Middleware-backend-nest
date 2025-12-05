import { Controller, Get, Put, Param, Body } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { ApiResponse, ApiTags, ApiOperation } from '@nestjs/swagger';

import { UpdateSettingValueCommand } from './commands/update-setting-value.command';
import { ReadSettingDto } from './dtos/read-setting.dto';
import { ReadSettingsListDto } from './dtos/read-settings-list.dto';
import { UpdateSettingValueDto } from './dtos/update-setting-value.dto';
import { GetAllSettingsQuery } from './queries/get-all-settings.query';
import { GetSettingQuery } from './queries/get-setting.query';

@ApiTags('Settings')
@Controller('settings')
export class SettingsController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get all settings' })
  @ApiResponse({
    status: 200,
    description: 'Settings retrieved successfully',
    type: ReadSettingsListDto,
  })
  public async getAllSettings(): Promise<ReadSettingsListDto> {
    const settings = await this.queryBus.execute(new GetAllSettingsQuery());
    return { settings };
  }

  @Get(':logicalName')
  @ApiOperation({ summary: 'Get setting by logical name' })
  @ApiResponse({
    status: 200,
    description: 'Setting retrieved successfully',
    type: ReadSettingDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Setting not found',
  })
  public async getSetting(
    @Param('logicalName') logicalName: string,
  ): Promise<ReadSettingDto | null> {
    return this.queryBus.execute(new GetSettingQuery(logicalName));
  }

  @Put(':logicalName')
  @ApiOperation({ summary: 'Update setting value by logical name' })
  @ApiResponse({
    status: 200,
    description: 'Setting value updated successfully',
    type: ReadSettingDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Setting not found',
  })
  public async updateSettingValue(
    @Param('logicalName') logicalName: string,
    @Body() dto: UpdateSettingValueDto,
  ): Promise<ReadSettingDto> {
    return this.commandBus.execute(
      new UpdateSettingValueCommand(logicalName, dto.value),
    );
  }
}
