import { Logger } from '@nestjs/common';
import { ICommandHandler, CommandHandler } from '@nestjs/cqrs';

import { VendorService } from '@/modules/d365fo/services/vendor.service';
import { SyncVendorsCommand } from '@/modules/master-data/commands/sync-vendors.command';
import { ICreateVendor } from '@/modules/master-data/interfaces/vendor.interface';
import { MasterDataService } from '@/modules/master-data/services/master-data.service';

@CommandHandler(SyncVendorsCommand)
export class SyncVendorsHandler implements ICommandHandler<SyncVendorsCommand> {
  private readonly logger = new Logger(SyncVendorsHandler.name);

  constructor(
    private readonly vendorService: VendorService,
    private readonly masterDataService: MasterDataService,
  ) {}

  public async execute(command: SyncVendorsCommand): Promise<{
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

    const existing = await this.masterDataService.getVendorsAsync({
      company: command.company,
    });
    const existingMap = new Map<string, boolean>();
    existing.items.forEach((v) =>
      existingMap.set(v.vendorAccountNumber.toLowerCase(), true),
    );

    const vendorPayload: ICreateVendor[] = [];
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

      if (existingMap.has(vendorAccountNumber.toLowerCase())) {
        vendorsUpdated++;
      } else {
        vendorsCreated++;
        existingMap.set(vendorAccountNumber.toLowerCase(), true);
      }

      vendorPayload.push(vendorData);
    }

    if (vendorPayload.length > 0) {
      await this.masterDataService.upsertVendorsAsync(
        command.company,
        vendorPayload,
      );
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
