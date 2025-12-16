import { Controller, Get, Put, Post, Param, Body } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import {
  ApiResponse,
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiHeader,
} from '@nestjs/swagger';

import { CreateSettingCommand } from './commands/create-setting.command';
import { UpdateSettingValueCommand } from './commands/update-setting-value.command';
import { UpdateSettingCommand } from './commands/update-setting.command';
import { BulkCreateSettingsDto } from './dtos/bulk-create-settings.dto';
import { BulkUpdateSettingsDto } from './dtos/bulk-update-settings.dto';
import { ReadSettingDto } from './dtos/read-setting.dto';
import { ReadSettingsListDto } from './dtos/read-settings-list.dto';
import { UpdateSettingValueDto } from './dtos/update-setting-value.dto';
import { GetAllSettingsQuery } from './queries/get-all-settings.query';
import { GetSettingQuery } from './queries/get-setting.query';

import { RequireApiKey } from '@/modules/auth/decorators/api-key.decorator';

@ApiBearerAuth()
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

  @Post('bulk')
  @RequireApiKey()
  @ApiHeader({
    name: 'X-API-Key',
    description: 'Admin API key for authentication',
    required: true,
    schema: {
      type: 'string',
      example: 'your-super-secret-api-key-here',
    },
  })
  @ApiOperation({ summary: 'Bulk create settings' })
  @ApiResponse({
    status: 201,
    description: 'Settings created successfully',
    type: [ReadSettingDto],
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Invalid or missing API key',
  })
  public async bulkCreateSettings(
    @Body() dto: BulkCreateSettingsDto,
  ): Promise<ReadSettingDto[]> {
    const results: ReadSettingDto[] = [];
    for (const setting of dto.settings) {
      const result = await this.commandBus.execute(
        new CreateSettingCommand(setting),
      );
      results.push(result);
    }
    return results;
  }

  @Put('bulk')
  @RequireApiKey()
  @ApiHeader({
    name: 'X-API-Key',
    description: 'Admin API key for authentication',
    required: true,
    schema: {
      type: 'string',
      example: 'your-super-secret-api-key-here',
    },
  })
  @ApiOperation({ summary: 'Bulk update settings' })
  @ApiResponse({
    status: 200,
    description: 'Settings updated successfully',
    type: [ReadSettingDto],
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Invalid or missing API key',
  })
  public async bulkUpdateSettings(
    @Body() dto: BulkUpdateSettingsDto,
  ): Promise<ReadSettingDto[]> {
    const results: ReadSettingDto[] = [];
    for (const setting of dto.settings) {
      const { logicalName, ...updateData } = setting;
      const result = await this.commandBus.execute(
        new UpdateSettingCommand(logicalName, updateData),
      );
      results.push(result);
    }
    return results;
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
