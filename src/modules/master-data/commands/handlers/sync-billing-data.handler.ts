import { Logger } from '@nestjs/common';
import { ICommandHandler, CommandHandler } from '@nestjs/cqrs';

import { BillingService } from '@/modules/d365fo/services/billing.service';
import {
  D365FOBillingClassification,
  D365FOBillingCode,
} from '@/modules/d365fo/types';
import { SyncBillingDataCommand } from '@/modules/master-data/commands/sync-billing-data.command';
import { ICreateBillingClassification } from '@/modules/master-data/interfaces/billing-classification.interface';
import { ICreateBillingCode } from '@/modules/master-data/interfaces/billing-code.interface';
import { MasterDataService } from '@/modules/master-data/services/master-data.service';

@CommandHandler(SyncBillingDataCommand)
export class SyncBillingDataHandler implements ICommandHandler<SyncBillingDataCommand> {
  private readonly logger = new Logger(SyncBillingDataHandler.name);

  constructor(
    private readonly billingService: BillingService,
    private readonly masterDataService: MasterDataService,
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

    const existingClassifications =
      await this.masterDataService.getBillingClassificationsAsync({
        company: command.company,
      });
    const classificationMap = new Map<string, boolean>();
    existingClassifications.items.forEach((c) =>
      classificationMap.set(c.billingClassification.toLowerCase(), true),
    );

    const existingCodes = await this.masterDataService.getBillingCodesAsync({
      company: command.company,
    });
    const codeMap = new Map<string, boolean>();
    existingCodes.items.forEach((c) =>
      codeMap.set(c.billingCode.toLowerCase(), true),
    );

    const classificationPayload: ICreateBillingClassification[] = [];
    const codePayload: ICreateBillingCode[] = [];

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

      const classificationData = {
        dataAreaId: command.company,
        billingClassification: billingClassification,
        creditNoteNumber: classification.CreditNoteNumber || undefined,
        useInterestCodeFromPostingProfile:
          classification.UseInterestCodeFromPostingProfile || undefined,
        invoiceNumber: classification.InvoiceNumber || undefined,
        interestCode: classification.InterestCode || undefined,
        description: classification.Description || undefined,
        collectionLetterSequence:
          classification.CollectionLetterSequence || undefined,
        restrictSettlementOfCreditNotes:
          classification.RestrictSettlementOfCreditNotes || undefined,
        useCollectionLetterSequenceFromPostingProfile:
          classification.UseCollectionLetterSequenceFromPostingProfile ||
          undefined,
        termsOfPayment: classification.TermsOfPayment || undefined,
      };

      if (classificationMap.has(billingClassification.toLowerCase())) {
        classificationsUpdated++;
      } else {
        classificationsCreated++;
        classificationMap.set(billingClassification.toLowerCase(), true);
      }

      classificationPayload.push(classificationData);

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

        const codeData = {
          dataAreaId: command.company,
          billingCode: billingCode,
          billingClassification: billingClassification,
        };

        if (codeMap.has(billingCode.toLowerCase())) {
          codesUpdated++;
        } else {
          codesCreated++;
          codeMap.set(billingCode.toLowerCase(), true);
        }

        codePayload.push(codeData);
      }
    }

    if (classificationPayload.length > 0) {
      await this.masterDataService.upsertBillingClassificationsAsync(
        command.company,
        classificationPayload,
      );
    }

    if (codePayload.length > 0) {
      await this.masterDataService.upsertBillingCodesAsync(
        command.company,
        codePayload,
      );
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
