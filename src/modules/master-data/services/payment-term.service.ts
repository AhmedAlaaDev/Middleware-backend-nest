import { Injectable } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';

import { GetPaymentTermsQuery } from '@/modules/master-data/queries/get-payment-terms.query';

@Injectable()
export class PaymentTermService {
  constructor(private readonly queryBus: QueryBus) {}

  /**
   * Fetches payment term names for a company.
   * Keys are lowercase Name/Description; values are the D365FO Name to post.
   */
  async getPaymentTermNames(company: string): Promise<Map<string, string>> {
    try {
      const res = await this.queryBus.execute(
        new GetPaymentTermsQuery({ company }, undefined, 10000),
      );

      const names = new Map<string, string>();
      for (const item of res?.items ?? []) {
        const name = item.name?.trim();
        if (!name) continue;

        names.set(name.toLowerCase(), name);
        const description = item.description?.trim();
        if (description) {
          names.set(description.toLowerCase(), name);
        }
      }

      return names;
    } catch {
      return new Map();
    }
  }
}
