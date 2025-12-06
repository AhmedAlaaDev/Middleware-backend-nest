import { Logger } from '@nestjs/common';
import { ICommandHandler, CommandHandler } from '@nestjs/cqrs';

import { CustomerService } from '@/modules/d365fo/services/customer.service';
import { SyncCustomersCommand } from '@/modules/master-data/commands/sync-customers.command';
import { ICreateCustomer } from '@/modules/master-data/interfaces/customer.interface';
import { MasterDataService } from '@/modules/master-data/services/master-data.service';

@CommandHandler(SyncCustomersCommand)
export class SyncCustomersHandler implements ICommandHandler<SyncCustomersCommand> {
  private readonly logger = new Logger(SyncCustomersHandler.name);

  constructor(
    private readonly customerService: CustomerService,
    private readonly masterDataService: MasterDataService,
  ) {}

  public async execute(command: SyncCustomersCommand): Promise<{
    customersCreated: number;
    customersUpdated: number;
  }> {
    this.logger.log(
      `Syncing customers from D365FO for company: ${command.company}`,
    );

    let customersCreated = 0;
    let customersUpdated = 0;

    // Fetch all customers from D365FO using automatic pagination
    const allCustomers = await this.customerService.getAllCustomers(
      command.company,
      {
        useCache: false, // Don't use cache for sync operations
      },
    );

    this.logger.log(`Fetched ${allCustomers.length} customers from D365FO`);

    const existing = await this.masterDataService.getCustomersAsync({
      company: command.company,
    });
    const existingMap = new Map<string, boolean>();
    existing.items.forEach((c) =>
      existingMap.set(c.customerAccount.toLowerCase(), true),
    );

    const customerPayload: ICreateCustomer[] = [];
    for (const customer of allCustomers) {
      const company = customer.dataAreaId || '';
      const customerAccount = customer.CustomerAccount || '';

      if (!company || !customerAccount) {
        this.logger.warn(
          'Skipping customer with missing company or customerAccount',
          customer,
        );
        continue;
      }

      const customerData = {
        company: company,
        customerAccount: customerAccount,
        name: customer.Name,
        organizationPhoneticName: customer.OrganizationPhoneticName,
        nameAlias: customer.NameAlias,
        customerGroupId: customer.CustomerGroupId,
        salesCurrencyCode: customer.SalesCurrencyCode,
        invoiceAccount: customer.InvoiceAccount,
        partyNumber: customer.PartyNumber,
        organizationNumber: customer.OrganizationNumber,
        defaultDimensionDisplayValue: customer.DefaultDimensionDisplayValue,
      };

      if (existingMap.has(customerAccount.toLowerCase())) {
        customersUpdated++;
      } else {
        customersCreated++;
        existingMap.set(customerAccount.toLowerCase(), true);
      }

      customerPayload.push(customerData);
    }

    if (customerPayload.length > 0) {
      await this.masterDataService.upsertCustomersAsync(
        command.company,
        customerPayload,
      );
    }

    this.logger.log(
      `Sync completed: ${customersCreated} customers created, ${customersUpdated} customers updated`,
    );

    return {
      customersCreated,
      customersUpdated,
    };
  }
}
