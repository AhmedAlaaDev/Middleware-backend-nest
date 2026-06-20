import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';

import { Auth } from '@/modules/auth/decorators/auth.decorator';
import { Roles } from '@/modules/auth/decorators/roles.decorator';
import { AccessReviewService } from '@/modules/user/access-review.service';
import {
  AccessDecisionDto,
  ReconsiderAccessDto,
} from '@/modules/user/dtos/access-decision.dto';
import { AccessDecisionAction } from '@/modules/user/schemas/access-decision.schema';
import { AccessStatus, UserRole } from '@/modules/user/schemas/user.schema';

@Controller('admin/access-requests')
@Roles(UserRole.ADMIN)
export class AdminAccessController {
  constructor(private readonly access: AccessReviewService) {}

  @Get()
  list(
    @Query('status') status?: AccessStatus,
    @Query('search') search?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.access.list({
      status,
      search,
      cursor,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get(':userId')
  get(@Param('userId') userId: string) {
    return this.access.get(userId);
  }

  @Post(':userId/approve')
  approve(
    @Param('userId') userId: string,
    @Auth('id') actorUserId: string,
    @Body() dto: AccessDecisionDto,
    @Req() req: Req,
  ) {
    return this.decide(userId, actorUserId, dto, req, {
      from: [AccessStatus.PENDING],
      to: AccessStatus.APPROVED,
      action: AccessDecisionAction.APPROVE,
    });
  }

  @Post(':userId/reject')
  reject(
    @Param('userId') userId: string,
    @Auth('id') actorUserId: string,
    @Body() dto: AccessDecisionDto,
    @Req() req: Req,
  ) {
    return this.decide(userId, actorUserId, dto, req, {
      from: [AccessStatus.PENDING],
      to: AccessStatus.REJECTED,
      action: AccessDecisionAction.REJECT,
    });
  }

  @Post(':userId/revoke')
  revoke(
    @Param('userId') userId: string,
    @Auth('id') actorUserId: string,
    @Body() dto: AccessDecisionDto,
    @Req() req: Req,
  ) {
    return this.decide(userId, actorUserId, dto, req, {
      from: [AccessStatus.APPROVED],
      to: AccessStatus.REVOKED,
      action: AccessDecisionAction.REVOKE,
    });
  }

  @Post(':userId/reconsider')
  reconsider(
    @Param('userId') userId: string,
    @Auth('id') actorUserId: string,
    @Body() dto: ReconsiderAccessDto,
    @Req() req: Req,
  ) {
    const to = dto.targetStatus;
    return this.decide(userId, actorUserId, dto, req, {
      from: [AccessStatus.REJECTED, AccessStatus.REVOKED],
      to,
      action:
        to === AccessStatus.APPROVED
          ? AccessDecisionAction.RECONSIDER_APPROVE
          : AccessDecisionAction.RECONSIDER_PENDING,
    });
  }

  private decide(
    userId: string,
    actorUserId: string,
    dto: AccessDecisionDto,
    req: Req,
    transition: {
      from: AccessStatus[];
      to: AccessStatus;
      action: AccessDecisionAction;
    },
  ) {
    return this.access.transition({
      userId,
      actorUserId,
      ...transition,
      reason: dto.reason,
      correlationId: req.headers['x-correlation-id'] as string | undefined,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
