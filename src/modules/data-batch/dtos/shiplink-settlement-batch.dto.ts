import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ShiplinkSettlementBatchDto {
  @ApiProperty({
    example: 'Mesco-000016627',
    description:
      'The journal batch number generated and stored in Dynamics 365 Finance.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  journalBatchNumber!: string;
}
