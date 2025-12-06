import { Logger } from '@nestjs/common';
import { ICommandHandler, CommandHandler } from '@nestjs/cqrs';

import { SaveAccountMappingsCommand } from '@/modules/master-data/commands/save-account-mappings.command';
import { MasterDataService } from '@/modules/master-data/services/master-data.service';

@CommandHandler(SaveAccountMappingsCommand)
export class SaveAccountMappingsHandler implements ICommandHandler<SaveAccountMappingsCommand> {
  private readonly logger = new Logger(SaveAccountMappingsHandler.name);

  constructor(private readonly masterDataService: MasterDataService) {}

  public async execute(command: SaveAccountMappingsCommand): Promise<{
    mappingsCreated: number;
    mappingsUpdated: number;
  }> {
    this.logger.log(`Saving ${command.mappings.length} account mappings`);

    const { items: existingMappings } =
      await this.masterDataService.getAccountMappingsAsync({});
    const existingMap = new Map<string, boolean>();
    existingMappings.forEach((m) =>
      existingMap.set(`${m.name}|${m.serviceType}`, true),
    );

    let mappingsCreated = 0;
    let mappingsUpdated = 0;

    for (const mappingData of command.mappings) {
      // Validate required fields
      if (
        !mappingData.name ||
        !mappingData.customerAccount ||
        !mappingData.invoiceAccount ||
        mappingData.serviceType === undefined
      ) {
        this.logger.warn(
          'Skipping account mapping with missing required fields',
          mappingData,
        );
        continue;
      }

      const key = `${mappingData.name}|${mappingData.serviceType}`;
      if (existingMap.has(key)) {
        mappingsUpdated++;
      } else {
        mappingsCreated++;
        existingMap.set(key, true);
      }
    }

    await this.masterDataService.upsertAccountMappingsAsync(command.mappings);

    this.logger.log(
      `Save completed: ${mappingsCreated} mappings created, ${mappingsUpdated} mappings updated`,
    );

    return {
      mappingsCreated,
      mappingsUpdated,
    };
  }
}
