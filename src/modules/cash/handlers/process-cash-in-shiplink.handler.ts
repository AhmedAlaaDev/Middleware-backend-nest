import { BadRequestException, Injectable } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';

import { resolveLegacyCompanyCode } from '@/common/company/company-code';
import { ProcessCashInShiplinkCommand } from '@/modules/cash/commands';
import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import { IDataBatch } from '@/modules/data-batch/interfaces/data-batch.interface';
import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';
import { runProcessorForCompany } from '@/modules/entry-processor/company-scope/run-for-company';
import { ENTRY_PROCESSOR_NAMES } from '@/modules/entry-processor/constants';
import { EntryProcessorFactory } from '@/modules/entry-processor/entry-processor.factory';
import { EntryRawDataModel } from '@/modules/entry-processor/models';
import { ExcelService } from '@/modules/excel/excel.service';

@CommandHandler(ProcessCashInShiplinkCommand)
@Injectable()
export class ProcessCashInShiplinkHandler
  implements ICommandHandler<ProcessCashInShiplinkCommand>
{
  constructor(
    private readonly excelService: ExcelService,
    private readonly processorFactory: EntryProcessorFactory,
    private readonly dataBatchService: DataBatchService,
  ) {}

  public async execute({
    companyId,
    fileBuffer,
  }: ProcessCashInShiplinkCommand): Promise<IDataBatch> {
    const company = resolveLegacyCompanyCode(companyId);

    const rawData =
      await this.excelService.excelToJson<EntryRawDataModel>(fileBuffer);

    if (!rawData || rawData.length === 0) {
      throw new BadRequestException('Empty file');
    }

    const processor = this.processorFactory.getProcessorByName(
      EntryProcessorTypes.CashInShiplink,
    );

    const { validated } = await runProcessorForCompany(
      processor,
      company,
      async () => {
        const enriched = await processor.formatAndEnrichAsync(rawData, company);
        const validated = await processor.validateAsync(enriched, company);
        return { validated };
      },
    );

    return this.dataBatchService.createAsync(
      EntryProcessorTypes.CashInShiplink,
      ENTRY_PROCESSOR_NAMES.CASH_IN_SHIPLINK,
      company,
      `Cash-In Shiplink ${Date.now()}`,
      rawData,
      validated,
      undefined,
      'last.ledger.voucher.cash.in.shiplink',
    );
  }
}
