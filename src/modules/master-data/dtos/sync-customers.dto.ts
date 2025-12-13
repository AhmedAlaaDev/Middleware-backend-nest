import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class SyncCustomersDto {
  @ApiProperty({
    description: 'Company code',
    example: 'm-p',
    required: true,
  })
  @IsString()
  @IsNotEmpty()
  company: string;
}
