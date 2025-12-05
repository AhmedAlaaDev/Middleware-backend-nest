import { Logger } from '@nestjs/common';
import { ICommandHandler, CommandHandler } from '@nestjs/cqrs';

import { CreateSettingCommand } from '../create-setting.command';
import { ReadSettingDto } from '../../dtos/read-setting.dto';

import { DBService } from '@/modules/db/db.service';

@CommandHandler(CreateSettingCommand)
export class CreateSettingHandler
  implements ICommandHandler<CreateSettingCommand>
{
  private readonly logger = new Logger(CreateSettingHandler.name);

  constructor(private readonly db: DBService) {}

  public async execute(
    command: CreateSettingCommand,
  ): Promise<ReadSettingDto> {
    this.logger.log(`Creating setting with logical name: ${command.data.logicalName}`);

    // Check if setting already exists
    const existing = await this.db.appSettingModel.findOne({
      logicalName: command.data.logicalName,
    });

    if (existing) {
      this.logger.warn(
        `Setting with logical name ${command.data.logicalName} already exists`,
      );
      throw new Error(
        `Setting with logical name ${command.data.logicalName} already exists`,
      );
    }

    const setting = await this.db.appSettingModel.create({
      displayName: command.data.displayName,
      logicalName: command.data.logicalName,
      value: command.data.value,
      groupName: command.data.groupName,
      hasAction: command.data.hasAction ?? false,
      order: command.data.order ?? 0,
    });

    this.logger.log(
      `Setting created successfully with logical name: ${command.data.logicalName}`,
    );

    const settingDoc = setting.toObject() as any;
    return {
      id: setting._id.toString(),
      displayName: setting.displayName,
      logicalName: setting.logicalName,
      value: setting.value,
      groupName: setting.groupName,
      hasAction: setting.hasAction,
      order: setting.order,
      createdAt: settingDoc.created_at,
      updatedAt: settingDoc.updated_at,
    };
  }
}

