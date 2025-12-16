import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, ValidateNested } from 'class-validator';

import { CreateSettingDto } from './create-setting.dto';

export class BulkCreateSettingsDto {
  @ApiProperty({
    description: 'Array of settings to create',
    type: [CreateSettingDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateSettingDto)
  settings: CreateSettingDto[];
}
