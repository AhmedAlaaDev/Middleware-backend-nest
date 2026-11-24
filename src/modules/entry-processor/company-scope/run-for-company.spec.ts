import { runExclusiveByKey, runProcessorForCompany } from './run-for-company';

import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';
import { EntryProcessorBase } from '@/modules/entry-processor/entry-processor.base';
import { CompanyConfigurationError } from '@/modules/master-data/company-run-config';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const MAS_LEDGER = {
  legalEntityId: 'mas',
  accountingCurrency: 'EGP',
  reportingCurrency: 'USD',
  exchangeRateType: 'MASRate',
  chartOfAccounts: 'MAS Chart',
};

/**
 * Minimal concrete processor. It records the company it sees after an await,
 * which is where a shared mutable company would be overwritten by a
 * concurrent run for another company.
 */
class CompanyEchoProcessor extends EntryProcessorBase {
  readonly entryProcessorType = EntryProcessorTypes.VendorFreight;
  readonly requiredDimensions = {} as never;

  constructor() {
    super({
      dependencies: {
        queryBus: {
          execute: (query: { filter?: { company?: string } }) =>
            Promise.resolve({
              items: query.filter?.company === 'mas' ? [MAS_LEDGER] : [],
            }),
        },
      } as never,
    });
  }

  readCompany(): string {
    return this.company;
  }

  readRunConfig() {
    return {
      rateType: this.rateType,
      chartOfAccounts: this.chartNumber,
      accountingCurrency: this.accountingCurrency,
    };
  }

  async waitThenReadRunConfig() {
    await delay(10);
    return this.readRunConfig();
  }

  setCustomerCache(value: Map<string, string>) {
    this.customerNameMap = value;
  }

  getCustomerCache() {
    return this.customerNameMap;
  }

  async formatAndEnrichAsync(data: unknown[], company: string): Promise<never> {
    this.company = company;
    await delay(data.length);
    return [this.company] as never;
  }

  async validateAsync(data: unknown[], company: string): Promise<never> {
    this.company = company;
    await delay(5);
    return [this.company, data.length] as never;
  }

  insertIntoDynamicsAsync(): Promise<void> {
    return Promise.resolve();
  }
}

describe('runExclusiveByKey', () => {
  it('runs tasks with the same key one after another', async () => {
    const order: string[] = [];
    const first = runExclusiveByKey('k', async () => {
      order.push('a:start');
      await delay(15);
      order.push('a:end');
    });
    const second = runExclusiveByKey('k', () => {
      order.push('b:start');
      order.push('b:end');
      return Promise.resolve();
    });
    await Promise.all([first, second]);
    expect(order).toEqual(['a:start', 'a:end', 'b:start', 'b:end']);
  });

  it('keeps running later tasks after a failure', async () => {
    await expect(
      runExclusiveByKey('k', () => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');
    await expect(
      runExclusiveByKey('k', () => Promise.resolve('ok')),
    ).resolves.toBe('ok');
  });
});

describe('runProcessorForCompany', () => {
  it('keeps M-P and MAS runs on one processor isolated', async () => {
    const processor = new CompanyEchoProcessor();

    const [mp, mas] = await Promise.all([
      runProcessorForCompany(processor, 'm-p', async () => {
        const enriched = await processor.formatAndEnrichAsync([1, 2, 3], 'm-p');
        const validated = await processor.validateAsync(enriched, 'm-p');
        return { enriched, validated };
      }),
      runProcessorForCompany(processor, 'mas', async () => {
        const enriched = await processor.formatAndEnrichAsync([1], 'mas');
        const validated = await processor.validateAsync(enriched, 'mas');
        return { enriched, validated };
      }),
    ]);

    expect(mp.enriched).toEqual(['m-p']);
    expect(mp.validated).toEqual(['m-p', 1]);
    expect(mas.enriched).toEqual(['mas']);
    expect(mas.validated).toEqual(['mas', 1]);
  });

  it('clears company-scoped caches before a run, so another company never reads them', async () => {
    const processor = new CompanyEchoProcessor();
    processor.setCustomerCache(new Map([['C-1', 'M-P customer']]));

    await runProcessorForCompany(processor, 'mas', () => {
      expect(processor.getCustomerCache()).toBeNull();
      expect(processor.readCompany()).toBe('mas');
      return Promise.resolve();
    });
  });
});

describe('company run configuration isolation', () => {
  it('gives overlapping M-P and MAS runs their own rate type, chart and currency', async () => {
    const processor = new CompanyEchoProcessor();

    const [mp, mas] = await Promise.all([
      runProcessorForCompany(processor, 'm-p', () =>
        processor.waitThenReadRunConfig(),
      ),
      runProcessorForCompany(processor, 'mas', () =>
        processor.waitThenReadRunConfig(),
      ),
    ]);

    expect(mp).toEqual({
      rateType: 'default',
      chartOfAccounts: 'Chart of Accounts',
      accountingCurrency: 'EGP',
    });
    expect(mas).toEqual({
      rateType: 'MASRate',
      chartOfAccounts: 'MAS Chart',
      accountingCurrency: 'EGP',
    });
  });

  it('restores the legacy rate type for the next M-P run after a MAS run', async () => {
    const processor = new CompanyEchoProcessor();
    await runProcessorForCompany(processor, 'mas', () => Promise.resolve());

    const next = await runProcessorForCompany(processor, 'm-p', () =>
      Promise.resolve(processor.readRunConfig()),
    );
    expect(next.rateType).toBe('default');
  });

  it('releases the lock when a MAS run fails its configuration check', async () => {
    const processor = new CompanyEchoProcessor();
    const failing = runProcessorForCompany(processor, 'acme', () =>
      Promise.resolve('never'),
    );
    await expect(failing).rejects.toBeInstanceOf(CompanyConfigurationError);

    await expect(
      runProcessorForCompany(processor, 'm-p', () => Promise.resolve('ok')),
    ).resolves.toBe('ok');
  });
});

describe('EntryProcessorBase company guard', () => {
  it('throws instead of silently using m-p when no run has set a company', () => {
    const processor = new CompanyEchoProcessor();
    expect(() => processor.readCompany()).toThrow(
      'Company is not set for this processor run',
    );
  });
});
