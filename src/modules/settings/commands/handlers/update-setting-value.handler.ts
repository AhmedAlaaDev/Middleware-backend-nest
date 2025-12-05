import { Logger } from '@nestjs/common';
import { ICommandHandler, CommandHandler } from '@nestjs/cqrs';

import { ReadSettingDto } from '../../dtos/read-setting.dto';
import { UpdateSettingValueCommand } from '../update-setting-value.command';

import { DBService } from '@/modules/db/db.service';

@CommandHandler(UpdateSettingValueCommand)
export class UpdateSettingValueHandler implements ICommandHandler<UpdateSettingValueCommand> {
  private readonly logger = new Logger(UpdateSettingValueHandler.name);

  constructor(private readonly db: DBService) {}

  public async execute(
    command: UpdateSettingValueCommand,
  ): Promise<ReadSettingDto> {
    this.logger.log(
      `Updating setting value with logical name: ${command.logicalName}`,
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

    setting.value = command.value;
    await setting.save();

    this.logger.log(
      `Setting value updated successfully with logical name: ${command.logicalName}`,
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
