import { Command } from '@nestjs/cqrs';

import { ReadSettingDto } from '../dtos/read-setting.dto';

export interface UpdateSettingData {
  displayName?: string;
  value?: string;
  groupName?: string;
  hasAction?: boolean;
  order?: number;
}

export class UpdateSettingCommand extends Command<ReadSettingDto> {
  constructor(
    public readonly logicalName: string,
    public readonly data: UpdateSettingData,
  ) {
    super();
  }
}
