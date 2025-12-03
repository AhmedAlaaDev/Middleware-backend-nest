import { Logger } from '@nestjs/common';
import { ICommandHandler, CommandHandler } from '@nestjs/cqrs';

import { SyncBillingDataCommand } from '../sync-billing-data.command';

import { BillingService } from '@/modules/d365fo/services/billing.service';
import {
  D365FOBillingClassification,
  D365FOBillingCode,
} from '@/modules/d365fo/types';
import { DBService } from '@/modules/db/db.service';

@CommandHandler(SyncBillingDataCommand)
export class SyncBillingDataHandler implements ICommandHandler<SyncBillingDataCommand> {
  private readonly logger = new Logger(SyncBillingDataHandler.name);

  constructor(
    private readonly billingService: BillingService,
    private readonly db: DBService,
  ) {}

  public async execute(command: SyncBillingDataCommand): Promise<{
    classificationsCreated: number;
    classificationsUpdated: number;
    codesCreated: number;
    codesUpdated: number;
  }> {
    this.logger.log(
      `Syncing billing data from D365FO${command.company ? ` for company: ${command.company}` : ''}`,
    );

    let classificationsCreated = 0;
    let classificationsUpdated = 0;
    let codesCreated = 0;
    let codesUpdated = 0;

    if (!command.company) {
      this.logger.warn('Company is required for billing data sync');
      return {
        classificationsCreated: 0,
        classificationsUpdated: 0,
        codesCreated: 0,
        codesUpdated: 0,
      };
    }

    // Fetch all billing classifications from D365FO using pagination
    const allClassifications: D365FOBillingClassification[] = [];
    let skipCount = 0;
    const pageSize = 5000;
    let hasMore = true;

    while (hasMore) {
      const classifications =
        await this.billingService.getBillingClassificationList(
          command.company,
          {
            useCache: false, // Don't use cache for sync operations
            maxCount: pageSize,
            skipCount: skipCount,
          },
        );

      if (classifications.length === 0) {
        hasMore = false;
      } else {
        allClassifications.push(...classifications);
        skipCount += pageSize;
        // If we got less than pageSize, we've reached the end
        if (classifications.length < pageSize) {
          hasMore = false;
        }
      }
    }

    this.logger.log(
      `Fetched ${allClassifications.length} billing classifications from D365FO`,
    );

    // Process each billing classification
    for (const classification of allClassifications) {
      const billingClassification = classification.BillingClassification;

      if (!billingClassification) {
        this.logger.warn(
          'Skipping billing classification with no BillingClassification',
          classification,
        );
        continue;
      }

      // Upsert billing classification
      const existingClassification =
        await this.db.billingClassificationModel.findOne({
          dataAreaId: command.company,
          billingClassification: billingClassification,
        });

      const classificationData = {
        dataAreaId: command.company,
        billingClassification: billingClassification,
        creditNoteNumber: classification.CreditNoteNumber,
        useInterestCodeFromPostingProfile:
          classification.UseInterestCodeFromPostingProfile,
        invoiceNumber: classification.InvoiceNumber,
        interestCode: classification.InterestCode,
        description: classification.Description,
        collectionLetterSequence: classification.CollectionLetterSequence,
        restrictSettlementOfCreditNotes:
          classification.RestrictSettlementOfCreditNotes,
        useCollectionLetterSequenceFromPostingProfile:
          classification.UseCollectionLetterSequenceFromPostingProfile,
        termsOfPayment: classification.TermsOfPayment,
      };

      if (!existingClassification) {
        await this.db.billingClassificationModel.create(classificationData);
        classificationsCreated++;
        this.logger.debug(
          `Created billing classification: ${billingClassification}`,
        );
      } else {
        // Update existing classification
        Object.assign(existingClassification, classificationData);
        await existingClassification.save();
        classificationsUpdated++;
        this.logger.debug(
          `Updated billing classification: ${billingClassification}`,
        );
      }

      // Fetch all billing codes for this classification using pagination
      const allCodes: D365FOBillingCode[] = [];
      let codeSkipCount = 0;
      const codePageSize = 5000;
      let hasMoreCodes = true;

      while (hasMoreCodes) {
        const codes = await this.billingService.getBillingCodeList(
          command.company,
          billingClassification,
          {
            useCache: false,
            maxCount: codePageSize,
            skipCount: codeSkipCount,
          },
        );

        if (codes.length === 0) {
          hasMoreCodes = false;
        } else {
          allCodes.push(...codes);
          codeSkipCount += codePageSize;
          // If we got less than pageSize, we've reached the end
          if (codes.length < codePageSize) {
            hasMoreCodes = false;
          }
        }
      }

      this.logger.debug(
        `Fetched ${allCodes.length} billing codes for classification: ${billingClassification}`,
      );

      // Upsert billing codes
      for (const code of allCodes) {
        const billingCode = code.BillingCode;

        if (!billingCode) {
          this.logger.warn(
            `Skipping billing code with no BillingCode for classification: ${billingClassification}`,
            code,
          );
          continue;
        }

        const existingCode = await this.db.billingCodeModel.findOne({
          dataAreaId: command.company,
          billingCode: billingCode,
        });

        const codeData = {
          dataAreaId: command.company,
          billingCode: billingCode,
          billingClassification: billingClassification,
        };

        if (!existingCode) {
          await this.db.billingCodeModel.create(codeData);
          codesCreated++;
          this.logger.debug(
            `Created billing code: ${billingCode} for classification: ${billingClassification}`,
          );
        } else {
          // Update existing code
          Object.assign(existingCode, codeData);
          await existingCode.save();
          codesUpdated++;
          this.logger.debug(
            `Updated billing code: ${billingCode} for classification: ${billingClassification}`,
          );
        }
      }
    }

    this.logger.log(
      `Sync completed: ${classificationsCreated} classifications created, ${classificationsUpdated} classifications updated, ${codesCreated} codes created, ${codesUpdated} codes updated`,
    );

    return {
      classificationsCreated,
      classificationsUpdated,
      codesCreated,
      codesUpdated,
    };
  }
}
