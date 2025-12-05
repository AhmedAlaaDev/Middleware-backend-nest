import { Query } from '@nestjs/cqrs';

import { ReadSettingDto } from '../dtos/read-setting.dto';

export class GetSettingQuery extends Query<ReadSettingDto | null> {
  constructor(public readonly logicalName: string) {
    super();
  }
}

