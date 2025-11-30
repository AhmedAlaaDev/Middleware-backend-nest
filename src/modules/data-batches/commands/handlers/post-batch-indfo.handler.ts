import { ICommandHandler, CommandHandler, CommandBus } from '@nestjs/cqrs';
import { Inject, Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PostBatchInDFOCommand } from '../post-batch-indfo.command';
import { DataBatchService } from '../../services/data-batch.service';
import { DataBatchStatus } from '../../schemas/data-batch.schema';
import { OperationResultDto } from '../../../../common/dto/operation-result.dto';

@CommandHandler(PostBatchInDFOCommand)
export class PostBatchInDFOHandler
  implements ICommandHandler<PostBatchInDFOCommand>
{
  constructor(
    private readonly batchService: DataBatchService,
    @InjectQueue('d365fo-posting') private readonly postingQueue: Queue,
  ) {}

  async execute(
    command: PostBatchInDFOCommand,
  ): Promise<OperationResultDto<any>> {
    const batch = await this.batchService.getByIdAsync(command.batchId);

    if (!batch) {
      return OperationResultDto.failure(
        `Batch with ID ${command.batchId} not found`,
        404,
      );
    }

    // Update status to Processing
    await this.batchService.updateStatusAsync(
      command.batchId,
      DataBatchStatus.Processing,
    );

    // Enqueue background job
    await this.postingQueue.add('post-batch-to-d365fo', {
      batchId: command.batchId,
      company: batch.company,
      entryProcessorName: batch.entryProcessorName,
    });

    return OperationResultDto.success(batch);
  }
}

