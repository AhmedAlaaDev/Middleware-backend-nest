import { Injectable } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';

import { DynDataModel } from '@/modules/entry-processor/interfaces/entry-processor.interface';
import { GetTaxItemGroupHeadingsQuery } from '@/modules/master-data/queries/get-tax-item-group-headings.query';
import { MultiLayerCacheService } from '@/modules/resilience/services/mutli-layer-cache.service';

@Injectable()
export class TaxGroupService {
  constructor(
    private readonly queryBus: QueryBus,
    private readonly multiLayerCacheService: MultiLayerCacheService,
  ) {}

  /**
   * Fetches valid tax item group codes for a company (cached).
   */
  async getValidTaxItemGroupCodes(company: string): Promise<Set<string>> {
    const cacheKey = `tax-item-group-codes:${company}`;

    return this.multiLayerCacheService.get(
      cacheKey,
      async () => {
        const res = await this.queryBus.execute(
          new GetTaxItemGroupHeadingsQuery(
            { dataAreaId: company },
            undefined,
            10000,
          ),
        );
        return new Set(
          res?.items?.map((x) => x.taxItemGroup).filter(Boolean) ?? [],
        );
      },
      { silent: true },
    );
  }

  /**
   * Fetches valid tax item group codes for a company (cached).
   */
  async getTaxItemGroupCodes(company: string): Promise<Set<string>> {
    try {
      const res = await this.queryBus.execute(
        new GetTaxItemGroupHeadingsQuery(
          { dataAreaId: company },
          undefined,
          10000,
        ),
      );

      const taxItemGroup =
        res?.items?.map((x) => x.taxItemGroup?.trim()).filter(Boolean) ?? [];

      return new Set(taxItemGroup);
    } catch {
      return new Set([]);
    }
  }

  /**
   * Validates that the line's SalesTaxItemGroup exists in D365FO for the company.
   * Non-dimension validation; use this in processors that require tax group validation.
   */
  async validateSalesTaxItemGroup(
    line: DynDataModel,
    company: string,
  ): Promise<void> {
    const value = (
      (line as { SalesTaxItemGroup?: string })?.SalesTaxItemGroup ?? ''
    ).trim();

    if (!value) return;

    const validCodes = await this.getValidTaxItemGroupCodes(company);
    if (!validCodes.has(value)) {
      line.AddError(
        'SalesTaxItemGroup',
        `The item sales tax group '${value}' does not exist in D365FO. Please sync Tax Item Group Headings from D365FO or use a valid code.`,
      );
    }
  }

  /**
   * Sync validation using pre-loaded valid codes (e.g. from warmup).
   * Use after warmupProcessorData with taxItemGroupCodes so no per-line async calls are needed.
   */
  validateSalesTaxItemGroupSync(
    line: DynDataModel,
    validCodes: Set<string>,
  ): void {
    const value = (
      (line as { SalesTaxItemGroup?: string })?.SalesTaxItemGroup ?? ''
    ).trim();

    if (!value) return;

    if (!validCodes.has(value)) {
      line.AddError(
        'SalesTaxItemGroup',
        `The item sales tax group '${value}' does not exist in D365FO. Please sync Tax Item Group Headings from D365FO or use a valid code.`,
      );
    }
  }
}
