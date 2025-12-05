import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsBoolean, IsNumber } from 'class-validator';

export class UpdateSettingDto {
  @ApiPropertyOptional({ description: 'Display name of the setting' })
  @IsOptional()
  @IsString()
  displayName?: string;

  @ApiPropertyOptional({ description: 'Value of the setting' })
  @IsOptional()
  @IsString()
  value?: string;

  @ApiPropertyOptional({ description: 'Group name to categorize the setting' })
  @IsOptional()
  @IsString()
  groupName?: string;

  @ApiPropertyOptional({ description: 'Whether the setting has an action' })
  @IsOptional()
  @IsBoolean()
  hasAction?: boolean;

  @ApiPropertyOptional({ description: 'Order for sorting' })
  @IsOptional()
  @IsNumber()
  order?: number;
}

