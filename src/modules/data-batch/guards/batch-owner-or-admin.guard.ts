import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';

import {
  BATCH_OWNER_ACTION,
  BatchOwnerAction,
} from '@/modules/data-batch/decorators/batch-owner-action.decorator';
import { DataBatchRepository } from '@/modules/data-batch/repositories/interfaces';
import { UserRole } from '@/modules/user/schemas/user.schema';

@Injectable()
export class BatchOwnerOrAdminGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly batches: DataBatchRepository,
  ) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const action = this.reflector.getAllAndOverride<BatchOwnerAction>(
      BATCH_OWNER_ACTION,
      [context.getHandler(), context.getClass()],
    );
    if (!action) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const batchId =
      (request.params?.batchId as string | undefined) ??
      (request.query?.batchId as string | undefined);
    if (!batchId) {
      throw new NotFoundException('Batch ID is required');
    }
    const batch = await this.batches.findById(batchId);
    if (!batch) {
      throw new NotFoundException(`Batch with ID ${batchId} not found`);
    }
    if (
      (request as any).user?.role === UserRole.ADMIN ||
      batch.createdByUserId === (request as any).user?.id
    ) {
      return true;
    }
    throw new ForbiddenException(
      `Only the batch owner or an administrator can ${action} this batch.`,
    );
  }
}
