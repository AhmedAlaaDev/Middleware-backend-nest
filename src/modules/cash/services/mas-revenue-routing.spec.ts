import {
  CashJournalRoutingError,
  CashJournalRoutingService,
} from './cash-journal-routing.service';

import { EntryProcessorTypes } from '@/modules/data-batch/enums/data-batch.enum';

describe('MAS Revenue inbound GL route', () => {
  const routing = new CashJournalRoutingService();

  it('resolves to an inbound GL route with the verified journal name', () => {
    expect(
      routing.resolve({
        safeType: 'MAS Revenue',
        masRevenueJournalName: 'GL-VERIFIED',
      }),
    ).toEqual({
      kind: 'ledger',
      module: 'GL',
      safeType: 'MAS Revenue',
      journalName: 'GL-VERIFIED',
      headerApi: 'LedgerJournalHeaders',
      lineDirection: 'in',
    });
  });

  it('refuses to resolve without a verified journal name', () => {
    expect(() => routing.resolve({ safeType: 'MAS Revenue' })).toThrow(
      CashJournalRoutingError,
    );
    expect(() =>
      routing.resolve({ safeType: 'MAS Revenue', masRevenueJournalName: '  ' }),
    ).toThrow(/requires a verified GL JournalName/);
  });

  it('leaves the existing routes unchanged', () => {
    expect(routing.resolve({ safeType: 'Direct' })).toMatchObject({
      kind: 'ledger',
      journalName: 'CashOut',
      headerApi: 'LedgerJournalHeaders',
      lineDirection: 'out',
    });
    expect(routing.resolve({ safeType: 'Other' })).toMatchObject({
      kind: 'ledger',
      journalName: 'CashOut',
      lineDirection: 'out',
    });
    expect(routing.resolve({ safeType: 'Customer Collection' })).toMatchObject({
      kind: 'customer-payment',
      module: 'AR',
      journalName: 'Cust-Pay',
      headerApi: 'CustomerPaymentJournalHeaders',
      lineDirection: 'in',
    });
    expect(
      routing.resolve({
        safeType: 'Vendor Payment',
        targetProcessor: 'Freight',
      }),
    ).toMatchObject({
      kind: 'vendor-invoice',
      journalName: 'P-Freight',
    });
  });

  it('does not change the journal name of existing routes when one is supplied', () => {
    expect(
      routing.resolve({
        safeType: 'Direct',
        masRevenueJournalName: 'GL-VERIFIED',
      }),
    ).toMatchObject({ journalName: 'CashOut' });
  });
});

describe('persisted processor enum values', () => {
  it('keeps the existing values and assigns the new processor the next free value', () => {
    expect(EntryProcessorTypes.CashInShiplink).toBe(31);
    expect(EntryProcessorTypes.CashInYard).toBe(32);
    expect(EntryProcessorTypes.CashInMasRevenue).toBe(33);
    expect(EntryProcessorTypes.CashInFreight).toBe(21);
    expect(EntryProcessorTypes.CashInTrucking).toBe(27);
  });
});
