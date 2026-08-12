import { BadRequestException } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';

import { SetBatchPostingPauseCommand } from '@/modules/data-batch/commands/set-batch-posting-pause.command';
import {
  BatchPostingControlError,
  BatchPostingControlService,
  BatchPostingPauseState,
} from '@/modules/queue/services/batch-posting-control.service';

@CommandHandler(SetBatchPostingPauseCommand)
export class SetBatchPostingPauseHandler implements ICommandHandler<SetBatchPostingPauseCommand> {
  constructor(private readonly control: BatchPostingControlService) {}

  async execute(
    command: SetBatchPostingPauseCommand,
  ): Promise<BatchPostingPauseState> {
    try {
      return command.paused
        ? await this.control.pause(command.batchId, command.actor)
        : await this.control.resume(command.batchId, command.actor);
    } catch (error) {
      if (error instanceof BatchPostingControlError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }
}
