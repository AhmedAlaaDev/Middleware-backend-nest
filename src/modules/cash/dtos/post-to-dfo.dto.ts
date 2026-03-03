import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class PostToDFODto {
  @ApiProperty({
    description: 'Batch ID to post to D365FO',
    example: '507f1f77bcf86cd799439011',
  })
  @IsNotEmpty()
  @IsString()
  batchId: string;
}

