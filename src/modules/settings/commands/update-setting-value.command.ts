import { Command } from '@nestjs/cqrs';

import { ReadSettingDto } from '../dtos/read-setting.dto';

export class UpdateSettingValueCommand extends Command<ReadSettingDto> {
  constructor(
    public readonly logicalName: string,
    public readonly value: string,
  ) {
    super();
  }
}
