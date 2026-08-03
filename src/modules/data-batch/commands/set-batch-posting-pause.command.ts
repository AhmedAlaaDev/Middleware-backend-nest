import { Command } from '@nestjs/cqrs';

import { BatchPostingPauseState } from '@/modules/queue/services/batch-posting-control.service';

/**
 * Hold a batch back from being posted to D365FO, or let it continue.
 */
export class SetBatchPostingPauseCommand extends Command<BatchPostingPauseState> {
  constructor(
    public readonly batchId: string,
    public readonly paused: boolean,
    public readonly actor: {
      id: string;
      name: string;
      email: string;
    },
  ) {
    super();
  }
}
