import { IsNotEmpty, IsString } from 'class-validator';

export class BatchIdDto {
  /**
   * Batch id
   */
  @IsNotEmpty()
  @IsString()
  batchId: string;
}
