import { Logger } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';

import { GetAllSettingsQuery } from '../get-all-settings.query';
import { ReadSettingDto } from '../../dtos/read-setting.dto';

import { DBService } from '@/modules/db/db.service';

@QueryHandler(GetAllSettingsQuery)
export class GetAllSettingsHandler
  implements IQueryHandler<GetAllSettingsQuery>
{
  private readonly logger = new Logger(GetAllSettingsHandler.name);

  constructor(private readonly db: DBService) {}

  public async execute(query: GetAllSettingsQuery): Promise<ReadSettingDto[]> {
    this.logger.log('Fetching all settings');

    const settings = await this.db.appSettingModel
      .find()
      .sort({ groupName: 1, order: 1 })
      .lean();

    return settings.map((s: any) => ({
      id: s._id.toString(),
      displayName: s.displayName,
      logicalName: s.logicalName,
      value: s.value,
      groupName: s.groupName,
      hasAction: s.hasAction,
      order: s.order,
      createdAt: s.created_at,
      updatedAt: s.updated_at,
    }));
  }
}

