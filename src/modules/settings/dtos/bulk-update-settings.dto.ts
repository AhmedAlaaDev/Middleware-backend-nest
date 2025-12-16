import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, ValidateNested, IsString } from 'class-validator';

import { UpdateSettingDto } from './update-setting.dto';

export class BulkUpdateSettingItemDto extends UpdateSettingDto {
  @ApiProperty({
    description: 'Logical name (unique identifier) of the setting to update',
  })
  @IsString()
  logicalName: string;
}

export class BulkUpdateSettingsDto {
  @ApiProperty({
    description: 'Array of settings to update',
    type: [BulkUpdateSettingItemDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BulkUpdateSettingItemDto)
  settings: BulkUpdateSettingItemDto[];
}
