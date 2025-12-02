import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { Logger } from '@nestjs/common';

import { DBService } from '@/modules/db/db.service';
import {
  GetBillingClassificationsQuery,
  BillingClassification,
} from '../get-billing-classifications.query';

@QueryHandler(GetBillingClassificationsQuery)
export class GetBillingClassificationsHandler
  implements IQueryHandler<GetBillingClassificationsQuery>
{
  private readonly logger = new Logger(GetBillingClassificationsHandler.name);

  constructor(private readonly db: DBService) {}

  public async execute(
    query: GetBillingClassificationsQuery,
  ): Promise<BillingClassification[]> {
    this.logger.log(
      `Fetching billing classifications from database${query.company ? ` for company: ${query.company}` : ''}`,
    );

    const filter: any = {};
    if (query.company) {
      filter.dataAreaId = query.company;
    }

    const classifications = await this.db.billingClassificationModel
      .find(filter)
      .lean();

    return classifications.map((c: any) => ({
      id: c._id.toString(),
      dataAreaId: c.dataAreaId,
      billingClassification: c.billingClassification,
      creditNoteNumber: c.creditNoteNumber || undefined,
      useInterestCodeFromPostingProfile:
        c.useInterestCodeFromPostingProfile || undefined,
      invoiceNumber: c.invoiceNumber || undefined,
      interestCode: c.interestCode || undefined,
      description: c.description || undefined,
      collectionLetterSequence: c.collectionLetterSequence || undefined,
      restrictSettlementOfCreditNotes:
        c.restrictSettlementOfCreditNotes || undefined,
      useCollectionLetterSequenceFromPostingProfile:
        c.useCollectionLetterSequenceFromPostingProfile || undefined,
      termsOfPayment: c.termsOfPayment || undefined,
    }));
  }
}

