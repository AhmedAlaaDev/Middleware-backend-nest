import { Logger } from '@nestjs/common';
import { ICommandHandler, CommandHandler } from '@nestjs/cqrs';

import { PaymentTermsService } from '@/modules/d365fo/services/payment-terms.service';
import { SyncPaymentTermsCommand } from '@/modules/master-data/commands/sync-payment-terms.command';
import { ICreatePaymentTerm } from '@/modules/master-data/interfaces/payment-term.interface';
import { MasterDataService } from '@/modules/master-data/services/master-data.service';

@CommandHandler(SyncPaymentTermsCommand)
export class SyncPaymentTermsHandler
  implements ICommandHandler<SyncPaymentTermsCommand>
{
  private readonly logger = new Logger(SyncPaymentTermsHandler.name);

  constructor(
    private readonly paymentTermsService: PaymentTermsService,
    private readonly masterDataService: MasterDataService,
  ) {}

  public async execute(command: SyncPaymentTermsCommand): Promise<{
    paymentTermsCreated: number;
    paymentTermsUpdated: number;
  }> {
    this.logger.log(
      `Syncing payment terms from D365FO for company: ${command.company}`,
    );

    let paymentTermsCreated = 0;
    let paymentTermsUpdated = 0;

    // Fetch all payment terms from D365FO using automatic pagination
    const allPaymentTerms =
      await this.paymentTermsService.getAllPaymentTerms(command.company, {
        useCache: false, // Don't use cache for sync operations
      });

    this.logger.log(
      `Fetched ${allPaymentTerms.length} payment terms from D365FO`,
    );

    const existing = await this.masterDataService.getPaymentTermsAsync({
      company: command.company,
    });
    const existingMap = new Map<string, boolean>();
    existing.items.forEach((pt) =>
      existingMap.set(pt.name.toLowerCase(), true),
    );

    const paymentTermPayload: ICreatePaymentTerm[] = [];
    for (const paymentTerm of allPaymentTerms) {
      const company = paymentTerm.dataAreaId || '';
      const name = paymentTerm.Name || '';

      if (!company || !name) {
        this.logger.warn(
          'Skipping payment term with missing company or name',
          paymentTerm,
        );
        continue;
      }

      const paymentTermData: ICreatePaymentTerm = {
        company: company,
        name: name,
        description: paymentTerm.Description,
        numberOfMonths: paymentTerm.NumberOfMonths,
        cutoffDayOfMonth: paymentTerm.CutoffDayOfMonth,
        creditCardCreditCheckType: paymentTerm.CreditCardCreditCheckType,
        paymentScheduleName: paymentTerm.PaymentScheduleName,
        isDefaultPaymentTerm: paymentTerm.IsDefaultPaymentTerm,
        creditCardPaymentType: paymentTerm.CreditCardPaymentType,
        isCashPayment: paymentTerm.IsCashPayment,
        numberOfDays: paymentTerm.NumberOfDays,
        customerDueDateUpdatePolicy: paymentTerm.CustomerDueDateUpdatePolicy,
        paymentDayName: paymentTerm.PaymentDayName,
        vendorDueDateUpdatePolicy: paymentTerm.VendorDueDateUpdatePolicy,
        postOffsettingAR: paymentTerm.PostOffsettingAR,
        paymentMethodType: paymentTerm.PaymentMethodType,
        cashPaymentMainAccountIdDisplayValue:
          paymentTerm.CashPaymentMainAccountIdDisplayValue,
        isCertifiedCompanyCheck: paymentTerm.IsCertifiedCompanyCheck,
        additionalMonthsForCutoffDate: paymentTerm.AdditionalMonthsForCutoffDate,
      };

      if (existingMap.has(name.toLowerCase())) {
        paymentTermsUpdated++;
      } else {
        paymentTermsCreated++;
        existingMap.set(name.toLowerCase(), true);
      }

      paymentTermPayload.push(paymentTermData);
    }

    if (paymentTermPayload.length > 0) {
      await this.masterDataService.upsertPaymentTermsAsync(
        command.company,
        paymentTermPayload,
      );
    }

    this.logger.log(
      `Sync completed: ${paymentTermsCreated} payment terms created, ${paymentTermsUpdated} payment terms updated`,
    );

    return {
      paymentTermsCreated,
      paymentTermsUpdated,
    };
  }
}
