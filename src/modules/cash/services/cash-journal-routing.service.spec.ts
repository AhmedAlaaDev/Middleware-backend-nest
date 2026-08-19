import {
  CashJournalRoute,
  CashJournalRoutingError,
  CashJournalRoutingService,
} from './cash-journal-routing.service';

describe('CashJournalRoutingService - acceptance criteria matrix', () => {
  let service: CashJournalRoutingService;

  beforeEach(() => {
    service = new CashJournalRoutingService();
  });

  it.each<{
    safeType: string;
    targetProcessor?: string;
    expected: CashJournalRoute;
  }>([
    {
      safeType: 'Vendor Payment',
      targetProcessor: 'Fleet',
      expected: {
        kind: 'vendor-invoice',
        module: 'AP',
        safeType: 'Vendor Payment',
        targetProcessor: 'Fleet',
        journalName: 'P-Fleet',
        headerApi: 'VendorPaymentJournalHeaders',
        lineDirection: 'out',
      },
    },
    {
      safeType: 'Vendor Payment',
      targetProcessor: 'Freight',
      expected: {
        kind: 'vendor-invoice',
        module: 'AP',
        safeType: 'Vendor Payment',
        targetProcessor: 'Freight',
        journalName: 'P-Freight',
        headerApi: 'VendorPaymentJournalHeaders',
        lineDirection: 'out',
      },
    },
    {
      safeType: 'Custody Settlement',
      targetProcessor: 'Fleet',
      expected: {
        kind: 'ledger',
        module: 'GL',
        safeType: 'Custody Settlement',
        journalName: 'CashOut',
        headerApi: 'LedgerJournalHeaders',
        lineDirection: 'out',
      },
    },
    {
      safeType: 'Custody Issue',
      targetProcessor: 'Freight',
      expected: {
        kind: 'vendor-invoice',
        module: 'AP',
        safeType: 'Custody Issue',
        targetProcessor: 'Freight',
        journalName: 'P-Freight',
        headerApi: 'VendorPaymentJournalHeaders',
        lineDirection: 'out',
      },
    },
    {
      safeType: 'Customer Collection',
      expected: {
        kind: 'customer-payment',
        module: 'AR',
        safeType: 'Customer Collection',
        journalName: 'Cust-Pay',
        headerApi: 'CustomerPaymentJournalHeaders',
        lineDirection: 'in',
      },
    },
    {
      safeType: 'Direct',
      expected: {
        kind: 'ledger',
        module: 'GL',
        safeType: 'Direct',
        journalName: 'CashOut',
        headerApi: 'LedgerJournalHeaders',
        lineDirection: 'out',
      },
    },
    {
      safeType: 'Other',
      expected: {
        kind: 'ledger',
        module: 'GL',
        safeType: 'Other',
        journalName: 'CashOut',
        headerApi: 'LedgerJournalHeaders',
        lineDirection: 'out',
      },
    },
    {
      safeType: 'DownPayment',
      expected: {
        kind: 'customer-payment',
        module: 'AR',
        safeType: 'DownPayment',
        journalName: 'Cust-Pay',
        headerApi: 'CustomerPaymentJournalHeaders',
        lineDirection: 'in',
      },
    },
    {
      safeType: 'CN',
      expected: {
        kind: 'customer-payment',
        module: 'AR',
        safeType: 'CN',
        journalName: 'Cust-Pay',
        headerApi: 'CustomerPaymentJournalHeaders',
        lineDirection: 'in',
      },
    },
  ])(
    'routes $safeType/$targetProcessor to the configured D365 journal',
    ({ safeType, targetProcessor, expected }) => {
      expect(service.resolve({ safeType, targetProcessor })).toEqual(expected);
    },
  );

  it.each([
    [' vendor_payment ', ' fLeEt ', 'Vendor Payment', 'Fleet', 'P-Fleet'],
    ['VENDOR-PAYMENT', ' freight ', 'Vendor Payment', 'Freight', 'P-Freight'],
    [
      ' custody_settlement ',
      ' fLeEt ',
      'Custody Settlement',
      undefined,
      'CashOut',
    ],
    [' custody_issue ', ' freight ', 'Custody Issue', 'Freight', 'P-Freight'],
    [
      ' customer_collection ',
      undefined,
      'Customer Collection',
      undefined,
      'Cust-Pay',
    ],
    [' DOWN-PAYMENT ', undefined, 'DownPayment', undefined, 'Cust-Pay'],
    [' c_n ', undefined, 'CN', undefined, 'Cust-Pay'],
  ])(
    'normalizes Safe Type %p and Target Processor %p',
    (
      safeType,
      targetProcessor,
      expectedSafeType,
      expectedTargetProcessor,
      expectedJournalName,
    ) => {
      const route = service.resolve({ safeType, targetProcessor });

      expect(route.safeType).toBe(expectedSafeType);
      expect(route.targetProcessor).toBe(expectedTargetProcessor);
      expect(route.journalName).toBe(expectedJournalName);
    },
  );

  it.each([
    ['Custody Settlement', 'CashOut'],
    ['Customer Collection', 'Cust-Pay'],
    ['Direct', 'CashOut'],
    ['Other', 'CashOut'],
    ['DownPayment', 'Cust-Pay'],
    ['CN', 'Cust-Pay'],
  ])(
    'ignores Target Processor for the %s Any-processor route',
    (safeType, expectedJournalName) => {
      const withoutProcessor = service.resolve({ safeType });
      const withInvalidProcessor = service.resolve({
        safeType,
        targetProcessor: 'not-a-valid-processor',
      });

      expect(withInvalidProcessor).toEqual(withoutProcessor);
      expect(withInvalidProcessor.journalName).toBe(expectedJournalName);
      expect(withInvalidProcessor).not.toHaveProperty('targetProcessor');
    },
  );

  it.each([undefined, null, '', '   ', 'Unsupported Type'])(
    'rejects unsupported Safe Type %p',
    (safeType) => {
      expect(() => service.resolve({ safeType })).toThrow(
        CashJournalRoutingError,
      );
      expect(() => service.resolve({ safeType })).toThrow(
        /Unsupported Safe Type/,
      );
    },
  );

  it.each(['Vendor Payment', 'Custody Issue'])(
    'rejects invalid Target Processor values for the %s AP route',
    (safeType) => {
      for (const targetProcessor of [
        undefined,
        null,
        '',
        '   ',
        'Any',
        'Air',
        'Fleet/Freight',
      ]) {
        expect(() => service.resolve({ safeType, targetProcessor })).toThrow(
          CashJournalRoutingError,
        );
        expect(() => service.resolve({ safeType, targetProcessor })).toThrow(
          new RegExp(`${safeType} requires a valid Target Processor`),
        );
        expect(() => service.resolve({ safeType, targetProcessor })).toThrow(
          /expected Fleet or Freight/,
        );
      }
    },
  );
});
