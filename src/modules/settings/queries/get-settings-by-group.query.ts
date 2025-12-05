import { Query } from '@nestjs/cqrs';

import { ReadSettingDto } from '../dtos/read-setting.dto';

export class GetSettingsByGroupQuery extends Query<ReadSettingDto[]> {
  constructor(public readonly groupName: string) {
    super();
  }
}

