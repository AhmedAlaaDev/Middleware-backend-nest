import { AsyncLocalStorage } from 'async_hooks';

import { Injectable } from '@nestjs/common';

export interface TraceContext {
  correlationId: string;
  requestId?: string;
  userId?: string;
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
}
