import { IsNotEmpty, IsString } from 'class-validator';

export class SyncLedgersDto {
  /**
   * Company code
   * @example m-p
   */
  @IsNotEmpty()
  @IsString()
  company: string;
}
