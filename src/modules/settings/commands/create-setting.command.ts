import { Command } from '@nestjs/cqrs';

import { ReadSettingDto } from '../dtos/read-setting.dto';

export interface CreateSettingData {
  displayName: string;
  logicalName: string;
  value?: string;
  groupName?: string;
  hasAction?: boolean;
  order?: number;
}

export class CreateSettingCommand extends Command<ReadSettingDto> {
  constructor(public readonly data: CreateSettingData) {
    super();
  }
}

