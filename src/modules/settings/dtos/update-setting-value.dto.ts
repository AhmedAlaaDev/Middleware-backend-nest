import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class UpdateSettingValueDto {
  @ApiProperty({ description: 'Value of the setting' })
  @IsString()
  value: string;
}

