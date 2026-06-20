import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { SessionService } from '@/modules/auth/services/session.service';
import { OperationalLoggerService } from '@/modules/observability/services/operational-logger.service';
import {
  AccessDecision,
  AccessDecisionAction,
} from '@/modules/user/schemas/access-decision.schema';
import { AccessStatus } from '@/modules/user/schemas/user.schema';
import { UserService } from '@/modules/user/user.service';

@Injectable()
export class AccessReviewService {
  constructor(
    private readonly users: UserService,
    private readonly sessions: SessionService,
    private readonly logs: OperationalLoggerService,
    @InjectModel(AccessDecision.name)
    private readonly decisions: Model<AccessDecision>,
  ) {}

  async list(input: {
    status?: AccessStatus;
    search?: string;
    cursor?: string;
    limit?: number;
  }) {
    const limit = Math.min(Math.max(input.limit ?? 25, 1), 100);
    const users = await this.users.listWorkforce({ ...input, limit });
    return {
      items: users,
      nextCursor: users.length === limit ? users[users.length - 1].id : null,
    };
  }

  async get(userId: string) {
    const [user, decisions] = await Promise.all([
      this.users.findUserById(userId),
      this.decisions.find({ userId }).sort({ createdAt: -1 }).lean().exec(),
    ]);
    if (!user) throw new NotFoundException('User not found');
    return { user, decisions };
  }

  transition(input: {
    userId: string;
    actorUserId: string;
    from: AccessStatus[];
    to: AccessStatus;
    action: AccessDecisionAction;
    reason?: string;
    correlationId?: string;
    ip?: string;
    userAgent?: string;
  }) {
    return this.applyTransition(input);
  }

  private async applyTransition(input: {
    userId: string;
    actorUserId: string;
    from: AccessStatus[];
    to: AccessStatus;
    action: AccessDecisionAction;
    reason?: string;
    correlationId?: string;
    ip?: string;
    userAgent?: string;
  }) {
    const before = await this.users.findUserById(input.userId);
    if (!before?.accessStatus) throw new NotFoundException('User not found');
    if (before.accessStatus === input.to) return before;

    const updated = await this.users.transitionAccess(
      input.userId,
      input.from,
      input.to,
    );
    if (!updated) {
      throw new ConflictException('Access status changed; refresh and retry');
    }

    await this.decisions.create({
      userId: input.userId,
      actorUserId: input.actorUserId,
      previousStatus: before.accessStatus,
      newStatus: input.to,
      action: input.action,
      reason: input.reason,
      correlationId: input.correlationId,
      actorIp: input.ip,
      actorUserAgent: input.userAgent,
    });

    if (
      input.to === AccessStatus.REJECTED ||
      input.to === AccessStatus.REVOKED
    ) {
      await this.sessions.revokeAllForUser(input.userId);
    }
    await this.logs.emit({
      level: 'info',
      message: `Workforce access changed from ${before.accessStatus} to ${input.to}`,
      context: AccessReviewService.name,
      eventType: 'auth.access.decision',
      status: input.to,
      userId: input.userId,
      correlationId: input.correlationId,
      metadata: {
        actorUserId: input.actorUserId,
        action: input.action,
      },
    });
    return updated;
  }
}
