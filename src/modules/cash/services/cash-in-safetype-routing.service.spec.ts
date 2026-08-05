import { CashEntryRawDataModel } from '@/modules/cash/models/cash-entry-raw-data.model';
import { CashInSafeTypeRoutingService } from '@/modules/cash/services/cash-in-safetype-routing.service';
import { CashJournalRoutingService } from '@/modules/cash/services/cash-journal-routing.service';

describe('CashInSafeTypeRoutingService', () => {
  const service = new CashInSafeTypeRoutingService(
    new CashJournalRoutingService(),
  );

  const toModels = (lines: Array<Record<string, unknown>>) =>
    lines.map(
      (line) => new CashEntryRawDataModel(line as any, 'Freight', true),
    );

  it('routes Custody Settlement to Cash-Out Freight by default', () => {
    const lines = toModels([
      {
        UniqueId: 466700,
        LINENUMBER: 1,
        VOUCHER: 'CS-1',
        SafeType: 'Custody Settlement',
        ACCOUNTTYPE: 'Vend',
        ACCOUNTDISPLAYVALUE: 'V1',
        DEBITAMOUNT: 100,
        CREDITAMOUNT: 0,
        CURRENCYCODE: 'EGP',
        VoucherType: 'Cash',
      },
      {
        UniqueId: 466700,
        LINENUMBER: 2,
        VOUCHER: 'CS-1',
        SafeType: 'Custody Settlement',
        ACCOUNTTYPE: 'Bank',
        ACCOUNTDISPLAYVALUE: 'B1',
        DEBITAMOUNT: 0,
        CREDITAMOUNT: 100,
        CURRENCYCODE: 'EGP',
        VoucherType: 'Cash',
      },
    ]);

    const split = service.splitCashInGroups(lines, {
      defaultTargetProcessor: 'Freight',
    });

    expect(split.cashInLines).toHaveLength(0);
    expect(split.cashOutFreightLines).toHaveLength(2);
    expect(split.cashOutFleetLines).toHaveLength(0);
    expect(split.routedCashOutUniqueIds).toEqual(['466700']);
  });

  it.each([
    'custody settlement',
    'CUSTODY SETTLEMENT',
    ' Custody Settlement ',
    'custody_settlement',
  ])('recognizes SafeType %j as Custody Settlement', (safeType) => {
    expect(service.isCustodySettlementSafeType(safeType)).toBe(true);
  });

  it('routes Custody Settlement with TargetProcessor Fleet to Cash-Out Fleet', () => {
    const lines = toModels([
      {
        UniqueId: 1,
        LINENUMBER: 1,
        SafeType: 'Custody Settlement',
        TargetProcessor: 'Fleet',
        ACCOUNTTYPE: 'Vend',
        DEBITAMOUNT: 10,
        CREDITAMOUNT: 0,
        CURRENCYCODE: 'EGP',
        VoucherType: 'Cash',
      },
    ]);

    const split = service.splitCashInGroups(lines, {
      defaultTargetProcessor: 'Freight',
    });

    expect(split.cashOutFleetLines).toHaveLength(1);
    expect(split.cashOutFreightLines).toHaveLength(0);
  });

  it('keeps Customer Collection in Cash-In', () => {
    const lines = toModels([
      {
        UniqueId: 466669,
        LINENUMBER: 1,
        SafeType: 'Customer Collection',
        ACCOUNTTYPE: 'Cust',
        DEBITAMOUNT: 0,
        CREDITAMOUNT: 100,
        CURRENCYCODE: 'USD',
        VoucherType: 'Cash',
      },
    ]);

    const split = service.splitCashInGroups(lines, {
      defaultTargetProcessor: 'Freight',
    });

    expect(split.cashInLines).toHaveLength(1);
    expect(split.cashOutFreightLines).toHaveLength(0);
    expect(split.cashOutFleetLines).toHaveLength(0);
  });

  it('supports mixed files with independent UniqueId routing', () => {
    const lines = toModels([
      {
        UniqueId: 466669,
        LINENUMBER: 1,
        SafeType: 'Customer Collection',
        ACCOUNTTYPE: 'Cust',
        DEBITAMOUNT: 0,
        CREDITAMOUNT: 100,
        CURRENCYCODE: 'USD',
        VoucherType: 'Cash',
      },
      {
        UniqueId: 466700,
        LINENUMBER: 2,
        SafeType: 'Custody Settlement',
        TargetProcessor: 'Freight',
        ACCOUNTTYPE: 'Vend',
        DEBITAMOUNT: 50,
        CREDITAMOUNT: 0,
        CURRENCYCODE: 'EGP',
        VoucherType: 'Cash',
      },
      {
        UniqueId: 466701,
        LINENUMBER: 3,
        SafeType: 'Custody Settlement',
        TargetProcessor: 'Fleet',
        ACCOUNTTYPE: 'Vend',
        DEBITAMOUNT: 60,
        CREDITAMOUNT: 0,
        CURRENCYCODE: 'EGP',
        VoucherType: 'Cash',
      },
    ]);

    const split = service.splitCashInGroups(lines, {
      defaultTargetProcessor: 'Freight',
    });

    expect(split.cashInLines.map((line) => line.UniqueId)).toEqual([466669]);
    expect(split.cashOutFreightLines.map((line) => line.UniqueId)).toEqual([
      466700,
    ]);
    expect(split.cashOutFleetLines.map((line) => line.UniqueId)).toEqual([
      466701,
    ]);
    expect(split.routedCashOutUniqueIds).toEqual(['466700', '466701']);
  });

  it('fails when SafeType values conflict within one UniqueId', () => {
    const lines = toModels([
      {
        UniqueId: 466702,
        LINENUMBER: 1,
        SafeType: 'Custody Settlement',
        ACCOUNTTYPE: 'Vend',
        DEBITAMOUNT: 10,
        CREDITAMOUNT: 0,
        CURRENCYCODE: 'EGP',
        VoucherType: 'Cash',
      },
      {
        UniqueId: 466702,
        LINENUMBER: 2,
        SafeType: 'Customer Collection',
        ACCOUNTTYPE: 'Cust',
        DEBITAMOUNT: 0,
        CREDITAMOUNT: 10,
        CURRENCYCODE: 'EGP',
        VoucherType: 'Cash',
      },
    ]);

    const split = service.splitCashInGroups(lines, {
      defaultTargetProcessor: 'Freight',
    });

    expect(split.failures).toHaveLength(1);
    expect(split.failures[0].message).toContain('Conflicting Safe Type');
    expect(split.cashInLines).toHaveLength(0);
    expect(split.cashOutFreightLines).toHaveLength(0);
    expect(split.cashOutFleetLines).toHaveLength(0);
  });

  it('fails when TargetProcessor values conflict within one Custody Settlement UniqueId', () => {
    const lines = toModels([
      {
        UniqueId: 10,
        LINENUMBER: 1,
        SafeType: 'Custody Settlement',
        TargetProcessor: 'Freight',
        ACCOUNTTYPE: 'Vend',
        DEBITAMOUNT: 10,
        CREDITAMOUNT: 0,
        CURRENCYCODE: 'EGP',
        VoucherType: 'Cash',
      },
      {
        UniqueId: 10,
        LINENUMBER: 2,
        SafeType: 'Custody Settlement',
        TargetProcessor: 'Fleet',
        ACCOUNTTYPE: 'Bank',
        DEBITAMOUNT: 0,
        CREDITAMOUNT: 10,
        CURRENCYCODE: 'EGP',
        VoucherType: 'Cash',
      },
    ]);

    const split = service.splitCashInGroups(lines, {
      defaultTargetProcessor: 'Freight',
    });

    expect(split.failures).toHaveLength(1);
    expect(split.failures[0].message).toContain('Conflicting Target Processor');
  });

  it('resolves P-Freight / P-Fleet journal routes for Custody Settlement', () => {
    const routing = new CashJournalRoutingService();
    expect(
      routing.resolve({
        safeType: 'Custody Settlement',
        targetProcessor: 'Freight',
      }),
    ).toMatchObject({
      module: 'AP',
      journalName: 'P-Freight',
      headerApi: 'VendorPaymentJournalHeaders',
    });
    expect(
      routing.resolve({
        safeType: 'Custody Settlement',
        targetProcessor: 'Fleet',
      }),
    ).toMatchObject({
      module: 'AP',
      journalName: 'P-Fleet',
      headerApi: 'VendorPaymentJournalHeaders',
    });
  });

  it('does not treat blank SafeType as Custody Settlement for Cash-In', () => {
    const lines = toModels([
      {
        UniqueId: 11,
        LINENUMBER: 1,
        SafeType: '',
        ACCOUNTTYPE: 'Cust',
        DEBITAMOUNT: 0,
        CREDITAMOUNT: 10,
        CURRENCYCODE: 'EGP',
        VoucherType: 'Cash',
      },
    ]);

    const split = service.splitCashInGroups(lines, {
      defaultTargetProcessor: 'Freight',
    });

    expect(split.cashInLines).toHaveLength(1);
    expect(split.cashOutFreightLines).toHaveLength(0);
  });
});
