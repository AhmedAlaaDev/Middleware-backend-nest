import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsBoolean, IsNumber } from 'class-validator';

export class CreateSettingDto {
  @ApiProperty({ description: 'Display name of the setting' })
  @IsString()
  displayName: string;

  @ApiProperty({ description: 'Logical name (unique identifier) of the setting' })
  @IsString()
  logicalName: string;

  @ApiPropertyOptional({ description: 'Value of the setting' })
  @IsOptional()
  @IsString()
  value?: string;

  @ApiPropertyOptional({ description: 'Group name to categorize the setting' })
  @IsOptional()
  @IsString()
  groupName?: string;

  @ApiPropertyOptional({ description: 'Whether the setting has an action', default: false })
  @IsOptional()
  @IsBoolean()
  hasAction?: boolean;

  @ApiPropertyOptional({ description: 'Order for sorting', default: 0 })
  @IsOptional()
  @IsNumber()
  order?: number;
}

