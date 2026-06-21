import { AsyncLocalStorage } from 'async_hooks';

import { Injectable } from '@nestjs/common';

export interface TraceContext {
  correlationId: string;
  requestId?: string;
  userId?: string;
  userName?: string;
  userEmail?: string;
  userRole?: string;
  batchId?: string;
  jobId?: string;
  queueName?: string;
}

@Injectable()
export class TraceContextService {
  private readonly storage = new AsyncLocalStorage<TraceContext>();

  run<T>(context: TraceContext, callback: () => T): T {
    return this.storage.run(context, callback);
  }

  get(): TraceContext | undefined {
    return this.storage.getStore();
  }

  setAuthenticatedUser(user: {
    id: string;
    firstName?: string;
    lastName?: string;
    email: string;
    role?: string;
  }): void {
    const context = this.storage.getStore();
    if (!context) return;
    context.userId = user.id;
    context.userName =
      [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email;
    context.userEmail = user.email;
    context.userRole = user.role;
  }
}
