import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

import { AccessStatus } from '@/modules/user/schemas/user.schema';

export class AccessDecisionDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}

export class ReconsiderAccessDto extends AccessDecisionDto {
  @IsIn([AccessStatus.PENDING, AccessStatus.APPROVED])
  targetStatus: AccessStatus.PENDING | AccessStatus.APPROVED;
}
