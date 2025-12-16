import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumberString } from 'class-validator';

export class UpdateSettingValueDto {
  @ApiProperty({ description: 'Value as number string' })
  @IsNotEmpty()
  @IsNumberString({}, { message: 'Value must be a valid number string' })
  value: string;
}
