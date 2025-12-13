import { ApiProperty } from '@nestjs/swagger';
import { IsOptional } from 'class-validator';

import { SyncJobStatus } from '@/modules/master-data/enums/sync-job-status.enum';

export class SyncJobResponseDto {
  @ApiProperty({
    description: 'Unique identifier of the sync job',
    example: '507f1f77bcf86cd799439011',
  })
  id: string;

  @ApiProperty({
    description: 'Name of the sync job',
    example: 'customers-USMF-1704067200000',
  })
  name: string;

  @ApiProperty({
    description: 'Status of the sync job',
    enum: SyncJobStatus,
    example: SyncJobStatus.PENDING,
  })
  status: SyncJobStatus;

  @ApiProperty({
    description: 'Error message if the sync job failed',
    required: false,
    example: 'Connection timeout',
  })
  @IsOptional()
  errorMessage?: string;

  @ApiProperty({
    description: 'Creation timestamp',
    example: '2024-01-01T00:00:00.000Z',
  })
  createdAt?: Date;

  @ApiProperty({
    description: 'Last update timestamp',
    example: '2024-01-01T00:00:00.000Z',
  })
  updatedAt?: Date;
}
