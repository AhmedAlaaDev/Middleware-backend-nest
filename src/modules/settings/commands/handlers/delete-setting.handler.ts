import { Logger } from '@nestjs/common';
import { ICommandHandler, CommandHandler } from '@nestjs/cqrs';

import { DeleteSettingCommand } from '../delete-setting.command';

import { DBService } from '@/modules/db/db.service';

@CommandHandler(DeleteSettingCommand)
export class DeleteSettingHandler
  implements ICommandHandler<DeleteSettingCommand>
{
  private readonly logger = new Logger(DeleteSettingHandler.name);

  constructor(private readonly db: DBService) {}

  public async execute(
    command: DeleteSettingCommand,
  ): Promise<{ success: boolean }> {
    this.logger.log(`Deleting setting with logical name: ${command.logicalName}`);

    const result = await this.db.appSettingModel.deleteOne({
      logicalName: command.logicalName,
    });

    if (result.deletedCount === 0) {
      this.logger.warn(
        `Setting with logical name ${command.logicalName} not found`,
      );
      throw new Error(
        `Setting with logical name ${command.logicalName} not found`,
      );
    }

    this.logger.log(
      `Setting deleted successfully with logical name: ${command.logicalName}`,
    );

    return { success: true };
  }
}

