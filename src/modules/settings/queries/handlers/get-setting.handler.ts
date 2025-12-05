import { Logger } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';

import { GetSettingQuery } from '../get-setting.query';
import { ReadSettingDto } from '../../dtos/read-setting.dto';

import { DBService } from '@/modules/db/db.service';

@QueryHandler(GetSettingQuery)
export class GetSettingHandler implements IQueryHandler<GetSettingQuery> {
  private readonly logger = new Logger(GetSettingHandler.name);

  constructor(private readonly db: DBService) {}

  public async execute(query: GetSettingQuery): Promise<ReadSettingDto | null> {
    this.logger.log(
      `Fetching setting with logical name: ${query.logicalName}`,
    );

    const setting = await this.db.appSettingModel
      .findOne({ logicalName: query.logicalName })
      .lean();

    if (!setting) {
      return null;
    }

    return {
      id: setting._id.toString(),
      displayName: setting.displayName,
      logicalName: setting.logicalName,
      value: setting.value,
      groupName: setting.groupName,
      hasAction: setting.hasAction,
      order: setting.order,
      createdAt: setting.created_at,
      updatedAt: setting.updated_at,
    };
  }
}

