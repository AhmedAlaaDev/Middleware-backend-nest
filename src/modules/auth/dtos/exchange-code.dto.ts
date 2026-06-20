import { IsString, IsUUID } from 'class-validator';

export class ExchangeCodeDto {
  @IsString()
  @IsUUID()
  code: string;
}
