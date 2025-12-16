import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class UpdateSettingValueDto {
  @ApiProperty({ description: 'Value of the setting' })
  @IsNotEmpty()
  @IsString()
  value: string;
}
