import { IsNotEmpty, IsString } from 'class-validator';

export class SyncTaxItemGroupHeadingsDto {
  /**
   * Company code
   * @example m-p
   */
  @IsNotEmpty()
  @IsString()
  company: string;
}
