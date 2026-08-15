import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';

import { DeleteDfoJournalCommand } from '@/modules/data-batch/commands/delete-dfo-journal.command';
import { CustomerPaymentJournalService } from '@/modules/d365fo/services/customer-payment-journal.service';
import { OperationalLoggerService } from '@/modules/observability/services/operational-logger.service';

@Injectable()
@CommandHandler(DeleteDfoJournalCommand)
export class DeleteDfoJournalHandler implements ICommandHandler<DeleteDfoJournalCommand> {
  constructor(
    private readonly customerPaymentJournalService: CustomerPaymentJournalService,
    private readonly logs: OperationalLoggerService,
  ) {}

  async execute(command: DeleteDfoJournalCommand): Promise<{
    deleted: boolean;
    entityType?: string;
    company: string;
    journalBatchNumber: string;
  }> {
    const journalBatchNumber = command.journalBatchNumber.trim();
    const company = command.company.trim();
    if (!journalBatchNumber) {
      throw new BadRequestException('Journal batch number is required');
    }
    if (!company) {
      throw new BadRequestException('Company (dataAreaId) is required');
    }

    let result: {
      deleted: boolean;
      entityType?: string;
      company: string;
      journalBatchNumber: string;
    };
    try {
      result =
        await this.customerPaymentJournalService.deleteFinanceJournalByNumber(
          company,
          journalBatchNumber,
        );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error ?? 'Unknown');
      throw new BadRequestException(
        `Could not delete D365FO journal ${journalBatchNumber} in ${company}: ${message}`,
      );
    }

    if (!result.deleted) {
      throw new NotFoundException(
        `No D365FO journal header ${journalBatchNumber} found in company ${company}`,
      );
    }

    await this.logs.emit({
      level: 'info',
      message: `Deleted D365FO journal ${journalBatchNumber} (${result.entityType}) in ${company}`,
      context: DeleteDfoJournalHandler.name,
      eventType: 'd365fo.journal.deleted',
      status: 'completed',
      userId: command.actor.id,
      metadata: {
        actorName: command.actor.name,
        actorEmail: command.actor.email,
        company: result.company,
        journalBatchNumber: result.journalBatchNumber,
        entityType: result.entityType,
      },
    });

    return result;
  }
}
