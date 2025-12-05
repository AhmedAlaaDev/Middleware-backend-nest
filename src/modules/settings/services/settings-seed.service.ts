import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { DBService } from '@/modules/db/db.service';

@Injectable()
export class SettingsSeedService implements OnModuleInit {
  private readonly logger = new Logger(SettingsSeedService.name);

  constructor(private readonly db: DBService) {}

  async onModuleInit() {
    this.logger.log('Starting settings seeding...');
    await this.seedSettings();
  }

  private async seedSettings() {
    const defaultSettings = [
      {
        displayName: 'Last Ledger Batch Number',
        logicalName: 'last.ledger.batch.number',
        value: '0',
        groupName: 'Ledger',
        hasAction: false,
        order: 1,
      },
      {
        displayName: 'Last Ledger Trucking Voucher Number',
        logicalName: 'last.ledger.trucking.voucher.number',
        value: '0',
        groupName: 'Ledger',
        hasAction: false,
        order: 2,
      },
      {
        displayName: 'Last Ledger Vendor Freight Voucher Number',
        logicalName: 'last.ledger.vendor.freight.voucher.number',
        value: '0',
        groupName: 'Ledger',
        hasAction: false,
        order: 3,
      },
      {
        displayName: 'Last Ledger Freight Voucher Number',
        logicalName: 'last.ledger.freight.voucher.number',
        value: '0',
        groupName: 'Ledger',
        hasAction: false,
        order: 4,
      },
      {
        displayName: 'Last Ledger Vendor Trucking Voucher Number',
        logicalName: 'last.ledger.vendor.trucking.voucher.number',
        value: '0',
        groupName: 'Ledger',
        hasAction: false,
        order: 5,
      },
      {
        displayName: 'Last Ledger Voucher Custody Freight',
        logicalName: 'last.ledger.voucher.custody.freight',
        value: '0',
        groupName: 'Ledger',
        hasAction: false,
        order: 6,
      },
      {
        displayName: 'Last Ledger Voucher Custody Trucking',
        logicalName: 'last.ledger.voucher.custody.trucking',
        value: '0',
        groupName: 'Ledger',
        hasAction: false,
        order: 7,
      },
      {
        displayName: 'Last Ledger Voucher Cash Out',
        logicalName: 'last.ledger.voucher.cash.out',
        value: '0',
        groupName: 'Ledger',
        hasAction: false,
        order: 8,
      },
      {
        displayName: 'Last Ledger Voucher Bank Out',
        logicalName: 'last.ledger.voucher.bank.out',
        value: '0',
        groupName: 'Ledger',
        hasAction: false,
        order: 9,
      },
      {
        displayName: 'Last Ledger Voucher Visa Out',
        logicalName: 'last.ledger.voucher.visa.out',
        value: '0',
        groupName: 'Ledger',
        hasAction: false,
        order: 10,
      },
    ];

    let created = 0;
    let skipped = 0;

    for (const settingData of defaultSettings) {
      try {
        // Check if setting already exists
        const existing = await this.db.appSettingModel.findOne({
          logicalName: settingData.logicalName,
        });

        if (existing) {
          this.logger.debug(
            `Setting ${settingData.logicalName} already exists, skipping`,
          );
          skipped++;
          continue;
        }

        // Create the setting directly using the DB service
        await this.db.appSettingModel.create(settingData);
        this.logger.log(`Seeded setting: ${settingData.logicalName}`);
        created++;
      } catch (error) {
        this.logger.error(
          `Failed to seed setting ${settingData.logicalName}: ${error.message}`,
        );
      }
    }

    this.logger.log(
      `Settings seeding completed: ${created} created, ${skipped} skipped`,
    );
  }
}
