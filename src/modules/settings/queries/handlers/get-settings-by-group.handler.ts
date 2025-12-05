import { Logger } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';

import { ReadSettingDto } from '../../dtos/read-setting.dto';
import { GetSettingsByGroupQuery } from '../get-settings-by-group.query';

import { DBService } from '@/modules/db/db.service';

@QueryHandler(GetSettingsByGroupQuery)
export class GetSettingsByGroupHandler implements IQueryHandler<GetSettingsByGroupQuery> {
  private readonly logger = new Logger(GetSettingsByGroupHandler.name);

  constructor(private readonly db: DBService) {}

  public async execute(
    query: GetSettingsByGroupQuery,
  ): Promise<ReadSettingDto[]> {
    this.logger.log(`Fetching settings for group: ${query.groupName}`);

    const settings = await this.db.appSettingModel
      .find({ groupName: query.groupName })
      .sort({ order: 1 })
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
