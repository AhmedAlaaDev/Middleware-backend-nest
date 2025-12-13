import { ApiProperty } from '@nestjs/swagger';

import { SyncJobStatus } from '@/modules/master-data/enums/sync-job-status.enum';

export class SyncStatusDto {
  @ApiProperty({
    description: 'Sync type identifier',
    example: 'customers',
  })
  syncType: string;

  @ApiProperty({
    description: 'Display label for the sync type',
    example: 'Customers',
  })
  label: string;

  @ApiProperty({
    description: 'Current status of the sync job',
    enum: SyncJobStatus,
    example: SyncJobStatus.PENDING,
  })
  status: SyncJobStatus;

  @ApiProperty({
    description: 'Error message if the last job failed',
    required: false,
    example: 'Connection timeout',
  })
  errorMessage?: string;
}
