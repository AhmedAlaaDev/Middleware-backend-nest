import { Logger } from '@nestjs/common';
import { ICommandHandler, CommandHandler } from '@nestjs/cqrs';

import { ReadSettingDto } from '../../dtos/read-setting.dto';
import { UpdateSettingCommand } from '../update-setting.command';

import { DBService } from '@/modules/db/db.service';

@CommandHandler(UpdateSettingCommand)
export class UpdateSettingHandler implements ICommandHandler<UpdateSettingCommand> {
  private readonly logger = new Logger(UpdateSettingHandler.name);

  constructor(private readonly db: DBService) {}

  public async execute(command: UpdateSettingCommand): Promise<ReadSettingDto> {
    this.logger.log(
      `Updating setting with logical name: ${command.logicalName}`,
    );

    const setting = await this.db.appSettingModel.findOne({
      logicalName: command.logicalName,
    });

    if (!setting) {
      this.logger.warn(
        `Setting with logical name ${command.logicalName} not found`,
      );
      throw new Error(
        `Setting with logical name ${command.logicalName} not found`,
      );
    }

    // Update only provided fields
    if (command.data.displayName !== undefined) {
      setting.displayName = command.data.displayName;
    }
    if (command.data.value !== undefined) {
      setting.value = command.data.value;
    }
    if (command.data.groupName !== undefined) {
      setting.groupName = command.data.groupName;
    }
    if (command.data.hasAction !== undefined) {
      setting.hasAction = command.data.hasAction;
    }
    if (command.data.order !== undefined) {
      setting.order = command.data.order;
    }

    await setting.save();

    this.logger.log(
      `Setting updated successfully with logical name: ${command.logicalName}`,
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
