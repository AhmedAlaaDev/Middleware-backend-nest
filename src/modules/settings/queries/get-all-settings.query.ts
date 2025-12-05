import { Query } from '@nestjs/cqrs';

import { ReadSettingDto } from '../dtos/read-setting.dto';

export class GetAllSettingsQuery extends Query<ReadSettingDto[]> {
  constructor() {
    super();
  }
}
