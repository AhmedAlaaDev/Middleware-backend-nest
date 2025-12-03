import { ICommandHandler, CommandHandler } from '@nestjs/cqrs';
import { Logger } from '@nestjs/common';

import { D365FOCustomer } from '@/modules/d365fo/types';
import { CustomerService } from '@/modules/d365fo/services/customer.service';
import { DBService } from '@/modules/db/db.service';
import { SyncCustomersCommand } from '../sync-customers.command';

@CommandHandler(SyncCustomersCommand)
export class SyncCustomersHandler
  implements ICommandHandler<SyncCustomersCommand>
{
  private readonly logger = new Logger(SyncCustomersHandler.name);

  constructor(
    private readonly customerService: CustomerService,
    private readonly db: DBService,
  ) {}

  public async execute(
    command: SyncCustomersCommand,
  ): Promise<{
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

    // Process each customer
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

      // Check if customer exists in database - upsert logic
      const existingCustomer = await this.db.customerModel.findOne({
        company: company,
        customerAccount: customerAccount,
      });

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

      if (!existingCustomer) {
        // Create new customer
        await this.db.customerModel.create(customerData);
        customersCreated++;
        this.logger.debug(
          `Created customer: ${company}/${customerAccount}`,
        );
      } else {
        // Update existing customer if data changed
        let hasChanges = false;
        if (existingCustomer.name !== customerData.name) {
          existingCustomer.name = customerData.name;
          hasChanges = true;
        }
        if (
          existingCustomer.organizationPhoneticName !==
          customerData.organizationPhoneticName
        ) {
          existingCustomer.organizationPhoneticName =
            customerData.organizationPhoneticName;
          hasChanges = true;
        }
        if (existingCustomer.nameAlias !== customerData.nameAlias) {
          existingCustomer.nameAlias = customerData.nameAlias;
          hasChanges = true;
        }
        if (
          existingCustomer.customerGroupId !== customerData.customerGroupId
        ) {
          existingCustomer.customerGroupId = customerData.customerGroupId;
          hasChanges = true;
        }
        if (
          existingCustomer.salesCurrencyCode !==
          customerData.salesCurrencyCode
        ) {
          existingCustomer.salesCurrencyCode = customerData.salesCurrencyCode;
          hasChanges = true;
        }
        if (existingCustomer.invoiceAccount !== customerData.invoiceAccount) {
          existingCustomer.invoiceAccount = customerData.invoiceAccount;
          hasChanges = true;
        }
        if (existingCustomer.partyNumber !== customerData.partyNumber) {
          existingCustomer.partyNumber = customerData.partyNumber;
          hasChanges = true;
        }
        if (
          existingCustomer.organizationNumber !== customerData.organizationNumber
        ) {
          existingCustomer.organizationNumber = customerData.organizationNumber;
          hasChanges = true;
        }
        if (
          existingCustomer.defaultDimensionDisplayValue !==
          customerData.defaultDimensionDisplayValue
        ) {
          existingCustomer.defaultDimensionDisplayValue =
            customerData.defaultDimensionDisplayValue;
          hasChanges = true;
        }

        if (hasChanges) {
          await existingCustomer.save();
          customersUpdated++;
          this.logger.debug(
            `Updated customer: ${company}/${customerAccount}`,
          );
        }
      }
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

