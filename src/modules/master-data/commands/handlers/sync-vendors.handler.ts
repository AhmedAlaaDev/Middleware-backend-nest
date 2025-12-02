import { ICommandHandler, CommandHandler } from '@nestjs/cqrs';
import { Logger } from '@nestjs/common';

import { D365FOVendor } from '@/modules/d365fo/types';
import { VendorService } from '@/modules/d365fo/services/vendor.service';
import { DBService } from '@/modules/db/db.service';
import { SyncVendorsCommand } from '../sync-vendors.command';

@CommandHandler(SyncVendorsCommand)
export class SyncVendorsHandler
  implements ICommandHandler<SyncVendorsCommand>
{
  private readonly logger = new Logger(SyncVendorsHandler.name);

  constructor(
    private readonly vendorService: VendorService,
    private readonly db: DBService,
  ) {}

  public async execute(
    command: SyncVendorsCommand,
  ): Promise<{
    vendorsCreated: number;
    vendorsUpdated: number;
  }> {
    this.logger.log(
      `Syncing vendors from D365FO for company: ${command.company}`,
    );

    let vendorsCreated = 0;
    let vendorsUpdated = 0;

    // Fetch all vendors from D365FO using automatic pagination
    const allVendors = await this.vendorService.getAllVendors(command.company, {
      useCache: false, // Don't use cache for sync operations
    });

    this.logger.log(`Fetched ${allVendors.length} vendors from D365FO`);

    // Process each vendor
    for (const vendor of allVendors) {
      const company = vendor.dataAreaId || '';
      const vendorAccountNumber = vendor.VendorAccountNumber || '';

      if (!company || !vendorAccountNumber) {
        this.logger.warn(
          'Skipping vendor with missing company or vendorAccountNumber',
          vendor,
        );
        continue;
      }

      // Check if vendor exists in database - upsert logic
      const existingVendor = await this.db.vendorModel.findOne({
        company: company,
        vendorAccountNumber: vendorAccountNumber,
      });

      const vendorData = {
        company: company,
        vendorAccountNumber: vendorAccountNumber,
        vendorOrganizationName: vendor.VendorOrganizationName,
        vendorSearchName: vendor.VendorSearchName,
        vendorGroupId: vendor.VendorGroupId,
        currencyCode: vendor.CurrencyCode,
        defaultPaymentTermsName: vendor.DefaultPaymentTermsName,
        salesTaxGroupCode: vendor.SalesTaxGroupCode,
        onHoldStatus: vendor.OnHoldStatus,
      };

      if (!existingVendor) {
        // Create new vendor
        await this.db.vendorModel.create(vendorData);
        vendorsCreated++;
        this.logger.debug(
          `Created vendor: ${company}/${vendorAccountNumber}`,
        );
      } else {
        // Update existing vendor if data changed
        let hasChanges = false;
        if (existingVendor.vendorOrganizationName !== vendorData.vendorOrganizationName) {
          existingVendor.vendorOrganizationName = vendorData.vendorOrganizationName;
          hasChanges = true;
        }
        if (existingVendor.vendorSearchName !== vendorData.vendorSearchName) {
          existingVendor.vendorSearchName = vendorData.vendorSearchName;
          hasChanges = true;
        }
        if (existingVendor.vendorGroupId !== vendorData.vendorGroupId) {
          existingVendor.vendorGroupId = vendorData.vendorGroupId;
          hasChanges = true;
        }
        if (existingVendor.currencyCode !== vendorData.currencyCode) {
          existingVendor.currencyCode = vendorData.currencyCode;
          hasChanges = true;
        }
        if (existingVendor.defaultPaymentTermsName !== vendorData.defaultPaymentTermsName) {
          existingVendor.defaultPaymentTermsName = vendorData.defaultPaymentTermsName;
          hasChanges = true;
        }
        if (existingVendor.salesTaxGroupCode !== vendorData.salesTaxGroupCode) {
          existingVendor.salesTaxGroupCode = vendorData.salesTaxGroupCode;
          hasChanges = true;
        }
        if (existingVendor.onHoldStatus !== vendorData.onHoldStatus) {
          existingVendor.onHoldStatus = vendorData.onHoldStatus;
          hasChanges = true;
        }

        if (hasChanges) {
          await existingVendor.save();
          vendorsUpdated++;
          this.logger.debug(
            `Updated vendor: ${company}/${vendorAccountNumber}`,
          );
        }
      }
    }

    this.logger.log(
      `Sync completed: ${vendorsCreated} vendors created, ${vendorsUpdated} vendors updated`,
    );

    return {
      vendorsCreated,
      vendorsUpdated,
    };
  }
}

