import {
  CashOutGroupingLine,
  cashOutInvoiceSplitKey,
  cashOutOffsetlessNetCents,
  normalizeCashOutGroupInvoice,
  resolveBalancedInvoiceSplitKeys,
  simulateCashOutVouchers,
  toCashOutCents,
} from './cash-out-request-grouping';

const line = (
  uniqueId: string,
  invoice: string,
  debit: number,
  credit: number,
  offsetless = true,
): CashOutGroupingLine => ({
  uniqueId,
  invoice,
  offsetless,
  debitCents: toCashOutCents(debit),
  creditCents: toCashOutCents(credit),
});

describe('cash-out request grouping rules', () => {
  describe('integer minor units', () => {
    it.each([
      [0.1 + 0.2, 30],
      [8093.959999999999, 809396],
      [59.489999999999995, 5949],
      [33.2889, 3329],
      [0, 0],
      [undefined, 0],
      ['12.50', 1250],
    ])('converts %p to %p cents', (amount, cents) => {
      expect(toCashOutCents(amount)).toBe(cents);
    });
  });

  describe('invoice placeholders', () => {
    it.each(['', '  ', '0', '00', '000', ' 0000 '])(
      'treats %p as no invoice',
      (invoice) => {
        expect(normalizeCashOutGroupInvoice(invoice)).toBe('');
        expect(cashOutInvoiceSplitKey('U1', invoice)).toBeUndefined();
      },
    );

    it('keeps real invoices, including ones that start with 0', () => {
      expect(cashOutInvoiceSplitKey('U1', '0IA2026060209047876')).toBe(
        'U1::0IA2026060209047876',
      );
    });
  });

  describe('resolveBalancedInvoiceSplitKeys', () => {
    it('allows a split only for an invoice group that balances by itself', () => {
      const keys = resolveBalancedInvoiceSplitKeys([
        line('U1', 'A', 0, 100.5),
        line('U1', 'A', 100.5, 0),
        line('U1', 'B', 0, 40),
        line('U1', 'B', 10, 0),
        line('U1', '', 500, 0),
        line('U1', '', 0, 460),
      ]);

      expect([...keys]).toEqual(['U1::A']);
    });

    it('never splits placeholder or blank invoices', () => {
      const keys = resolveBalancedInvoiceSplitKeys([
        line('U1', '000', 10, 0),
        line('U1', '000', 0, 10),
        line('U1', '', 5, 0),
        line('U1', '', 0, 5),
      ]);

      expect(keys.size).toBe(0);
    });

    it('evaluates the same invoice number independently per UniqueId', () => {
      const keys = resolveBalancedInvoiceSplitKeys([
        line('U1', 'INV', 10, 0),
        line('U1', 'INV', 0, 10),
        line('U2', 'INV', 10, 0),
        line('U2', 'INV', 0, 9),
      ]);

      expect([...keys]).toEqual(['U1::INV']);
    });

    it('ignores lines that carry an offset account (X++ balances only offset-less lines)', () => {
      const keys = resolveBalancedInvoiceSplitKeys([
        line('U1', 'A', 100, 0, false),
        line('U1', 'A', 0, 100, false),
      ]);

      expect(keys.has('U1::A')).toBe(true);
    });

    it('does not accept a one-cent difference when planning splits', () => {
      const keys = resolveBalancedInvoiceSplitKeys([
        line('U1', 'A', 10.01, 0),
        line('U1', 'A', 0, 10),
      ]);

      expect(keys.size).toBe(0);
    });
  });

  describe('cashOutOffsetlessNetCents', () => {
    it('sums only offset-less debit minus credit', () => {
      expect(
        cashOutOffsetlessNetCents([
          line('U', '', 10, 0),
          line('U', '', 0, 4),
          line('U', '', 999, 0, false),
        ]),
      ).toBe(600);
    });

    it('sums repeated identical amounts exactly', () => {
      const lines = [
        ...Array.from({ length: 30 }, () => line('U', '', 0.1, 0)),
        line('U', '', 0, 3),
      ];

      expect(cashOutOffsetlessNetCents(lines)).toBe(0);
    });
  });

  describe('simulateCashOutVouchers (mirror of the X++ voucher rule)', () => {
    it('closes a voucher whenever the running balance returns to zero', () => {
      const result = simulateCashOutVouchers([
        line('U', '', 10, 0),
        line('U', '', 0, 10),
        line('U', '', 5, 0),
        line('U', '', 0, 5),
      ]);

      expect(result).toEqual({ vouchers: 2, openLines: 0, openNetCents: 0 });
    });

    it('keeps one voucher open across the whole request until it balances', () => {
      const lines = [
        ...Array.from({ length: 731 }, () => line('U', '', 1, 0)),
        line('U', '', 0, 731),
      ];

      expect(simulateCashOutVouchers(lines)).toEqual({
        vouchers: 1,
        openLines: 0,
        openNetCents: 0,
      });
    });

    it('reports lines left in an unbalanced voucher at the end', () => {
      const result = simulateCashOutVouchers([
        line('U', '', 10, 0),
        line('U', '', 0, 4),
      ]);

      expect(result).toEqual({
        vouchers: 0,
        openLines: 2,
        openNetCents: 600,
      });
    });

    it('gives offset lines their own voucher and ignores them for balance', () => {
      const result = simulateCashOutVouchers([
        line('U', '', 100, 0, false),
        line('U', '', 50, 0, false),
      ]);

      expect(result).toEqual({ vouchers: 2, openLines: 0, openNetCents: 0 });
    });

    it('uses the same one-cent closing tolerance as X++', () => {
      expect(
        simulateCashOutVouchers([line('U', '', 10.01, 0), line('U', '', 0, 10)])
          .openLines,
      ).toBe(0);
      expect(
        simulateCashOutVouchers([line('U', '', 10.02, 0), line('U', '', 0, 10)])
          .openLines,
      ).toBe(2);
    });
  });
});
