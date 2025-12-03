import { ICommandHandler, CommandHandler } from '@nestjs/cqrs';
import { Logger } from '@nestjs/common';

import { DBService } from '@/modules/db/db.service';
import { SaveAccountMappingsCommand } from '../save-account-mappings.command';

@CommandHandler(SaveAccountMappingsCommand)
export class SaveAccountMappingsHandler
  implements ICommandHandler<SaveAccountMappingsCommand>
{
  private readonly logger = new Logger(SaveAccountMappingsHandler.name);

  constructor(private readonly db: DBService) {}

  public async execute(
    command: SaveAccountMappingsCommand,
  ): Promise<{
    mappingsCreated: number;
    mappingsUpdated: number;
  }> {
    this.logger.log(
      `Saving ${command.mappings.length} account mappings`,
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

      // Check if mapping exists - use name and serviceType as unique identifier
      const existingMapping =
        await this.db.accountCustomerInvoiceMappingModel.findOne({
          name: mappingData.name,
          serviceType: mappingData.serviceType,
        });

      if (!existingMapping) {
        // Create new mapping
        await this.db.accountCustomerInvoiceMappingModel.create({
          name: mappingData.name,
          customerAccount: mappingData.customerAccount,
          invoiceAccount: mappingData.invoiceAccount,
          serviceType: mappingData.serviceType,
        });
        mappingsCreated++;
        this.logger.debug(
          `Created account mapping: ${mappingData.customerAccount} -> ${mappingData.invoiceAccount} (serviceType: ${mappingData.serviceType})`,
        );
      } else {
        // Update existing mapping if any fields changed
        let hasChanges = false;
        if (existingMapping.customerAccount !== mappingData.customerAccount) {
          existingMapping.customerAccount = mappingData.customerAccount;
          hasChanges = true;
        }
        if (existingMapping.invoiceAccount !== mappingData.invoiceAccount) {
          existingMapping.invoiceAccount = mappingData.invoiceAccount;
          hasChanges = true;
        }

        if (hasChanges) {
          await existingMapping.save();
          mappingsUpdated++;
          this.logger.debug(
            `Updated account mapping: ${mappingData.name} (serviceType: ${mappingData.serviceType}) - customerAccount: ${mappingData.customerAccount}, invoiceAccount: ${mappingData.invoiceAccount}`,
          );
        }
      }
    }

    this.logger.log(
      `Save completed: ${mappingsCreated} mappings created, ${mappingsUpdated} mappings updated`,
    );

    return {
      mappingsCreated,
      mappingsUpdated,
    };
  }
}

