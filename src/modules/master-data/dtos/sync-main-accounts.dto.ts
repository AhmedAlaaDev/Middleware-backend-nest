import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class SyncMainAccountsDto {
  @ApiProperty({
    description: 'Chart of accounts',
    example: 'Chart of Accounts',
    required: true,
  })
  @IsString()
  @IsNotEmpty()
  chartOfAccounts: string;
}
