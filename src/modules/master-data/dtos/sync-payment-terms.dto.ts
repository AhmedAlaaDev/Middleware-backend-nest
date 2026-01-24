import { IsNotEmpty, IsString } from 'class-validator';

export class SyncPaymentTermsDto {
  /**
   * Company code
   * @example m-p
   */
  @IsNotEmpty()
  @IsString()
  company: string;
}
