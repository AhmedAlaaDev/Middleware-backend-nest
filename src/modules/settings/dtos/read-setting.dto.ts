import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ReadSettingDto {
  @ApiProperty({ description: 'Unique identifier of the setting' })
  id: string;

  @ApiProperty({ description: 'Display name of the setting' })
  displayName: string;

  @ApiProperty({ description: 'Logical name (unique identifier) of the setting' })
  logicalName: string;

  @ApiPropertyOptional({ description: 'Value of the setting' })
  value?: string;

  @ApiPropertyOptional({ description: 'Group name to categorize the setting' })
  groupName?: string;

  @ApiProperty({ description: 'Whether the setting has an action', default: false })
  hasAction: boolean;

  @ApiProperty({ description: 'Order for sorting', default: 0 })
  order: number;

  @ApiProperty({ description: 'Creation date' })
  createdAt: Date;

  @ApiProperty({ description: 'Last update date' })
  updatedAt: Date;
}

