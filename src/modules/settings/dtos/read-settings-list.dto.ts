import { ApiProperty } from '@nestjs/swagger';

import { ReadSettingDto } from './read-setting.dto';

export class ReadSettingsListDto {
  @ApiProperty({ type: [ReadSettingDto], description: 'List of settings' })
  settings: ReadSettingDto[];
}
