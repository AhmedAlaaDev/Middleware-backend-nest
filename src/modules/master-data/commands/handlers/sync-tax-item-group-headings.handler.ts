import { Logger } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';

import { TaxItemGroupHeadingService } from '@/modules/d365fo/services/tax-item-group-heading.service';
import { SyncTaxItemGroupHeadingsCommand } from '@/modules/master-data/commands/sync-tax-item-group-headings.command';
import { ICreateTaxItemGroupHeading } from '@/modules/master-data/interfaces/tax-item-group-heading.interface';
import { MasterDataService } from '@/modules/master-data/services/master-data.service';

@CommandHandler(SyncTaxItemGroupHeadingsCommand)
export class SyncTaxItemGroupHeadingsHandler implements ICommandHandler<SyncTaxItemGroupHeadingsCommand> {
  private readonly logger = new Logger(SyncTaxItemGroupHeadingsHandler.name);

  constructor(
    private readonly taxItemGroupHeadingService: TaxItemGroupHeadingService,
    private readonly masterDataService: MasterDataService,
  ) {}

  public async execute(
    command: SyncTaxItemGroupHeadingsCommand,
  ): Promise<{ created: number; updated: number }> {
    this.logger.log(
      `Syncing TaxItemGroupHeadings from D365FO for company: ${command.company}`,
    );

    let created = 0;
    let updated = 0;

    const all =
      await this.taxItemGroupHeadingService.getAllTaxItemGroupHeadings(
        command.company,
        { useCache: false },
      );

    this.logger.log(`Fetched ${all.length} TaxItemGroupHeadings from D365FO`);

    const existing = await this.masterDataService.getTaxItemGroupHeadingsAsync({
      dataAreaId: command.company,
    });
    const existingSet = new Set(
      existing.items.map((x) => x.taxItemGroup.toLowerCase()),
    );

    const payload: ICreateTaxItemGroupHeading[] = [];
    for (const item of all) {
      const dataAreaId = item.dataAreaId || command.company;
      const taxItemGroup = item.TaxItemGroup || '';
      if (!dataAreaId || !taxItemGroup) {
        this.logger.warn(
          'Skipping TaxItemGroupHeading with missing dataAreaId or TaxItemGroup',
          item,
        );
        continue;
      }
      payload.push({
        dataAreaId,
        taxItemGroup,
        name: item.Name,
      });
      if (existingSet.has(taxItemGroup.toLowerCase())) {
        updated++;
      } else {
        created++;
        existingSet.add(taxItemGroup.toLowerCase());
      }
    }

    if (payload.length > 0) {
      await this.masterDataService.upsertTaxItemGroupHeadingsAsync(
        command.company,
        payload,
      );
    }

    this.logger.log(`Sync completed: ${created} created, ${updated} updated`);
    return { created, updated };
  }
}
