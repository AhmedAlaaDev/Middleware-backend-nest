import { ODataQueryBuilderService } from './odata-query-builder.service';
import { VendorInvoiceJournalService } from './vendor-invoice-journal.service';

describe('vendor payment settlement lookup URL regression', () => {
  function harness(get: jest.Mock) {
    const service = new VendorInvoiceJournalService(
      { get } as any,
      new ODataQueryBuilderService(),
      {} as any,
      {} as any,
    );
    return (lines: number[]) =>
      (service as any).fetchSettledInvoicesByJournalLine(
        'm-p',
        'Mesco-000015200',
        lines,
      ) as Promise<Map<number, unknown[]>>;
  }

  it('keeps a 1000-line journal below URL limits and retrieves each line once', async () => {
    const seen: number[] = [];
    const get = jest.fn(async (endpoint: string) => {
      expect(endpoint.length).toBeLessThan(2000);
      const query = new URL(endpoint, 'https://example.com').searchParams;
      const filter = query.get('$filter')!;
      expect(filter).toContain("JournalLineCompany eq 'm-p'");
      expect(filter).toContain("JournalBatchNumber eq 'Mesco-000015200'");
      expect(query.get('cross-company')).toBe('true');
      const lines = [...filter.matchAll(/JournalLineNumber eq (\d+)/g)].map(
        (match) => Number(match[1]),
      );
      seen.push(...lines);
      return {
        value: lines.map((JournalLineNumber) => ({ JournalLineNumber })),
      };
    });
    const lines = Array.from({ length: 1000 }, (_, index) => index + 1);
    const result = await harness(get)([...lines, 1, 2, 0, -1]);
    expect(seen).toEqual(lines);
    expect(result.size).toBe(1000);
    for (const line of lines) {
      expect(result.get(line)).toEqual([{ JournalLineNumber: line }]);
    }
    for (const [, options] of get.mock.calls as unknown as [
      string,
      unknown,
    ][]) {
      expect(options).toEqual({ useCache: false });
    }
  });

  it('finishes pagination before the next group and keeps multiple invoices per line', async () => {
    const first = { JournalLineNumber: 1, InvoiceNumber: 'INV-A' };
    const second = { JournalLineNumber: 1, InvoiceNumber: 'INV-B' };
    const last = { JournalLineNumber: 21, InvoiceNumber: 'INV-C' };
    const get = jest
      .fn()
      .mockResolvedValueOnce({
        value: [first],
        '@odata.nextLink': 'https://example.com/data/next?$skiptoken=abc',
      })
      .mockResolvedValueOnce({ value: [second] })
      .mockResolvedValueOnce({ value: [last] });
    const result = await harness(get)(
      Array.from({ length: 21 }, (_, i) => i + 1),
    );
    expect(get.mock.calls[1][0]).toBe('/data/next?$skiptoken=abc');
    expect(result.get(1)).toEqual([first, second]);
    expect(result.get(21)).toEqual([last]);
  });

  it('propagates later lookup failures instead of returning incomplete existing settlements', async () => {
    const failure = new Error('D365 unavailable');
    const get = jest
      .fn()
      .mockResolvedValueOnce({ value: [{ JournalLineNumber: 1 }] })
      .mockRejectedValueOnce(failure);
    await expect(
      harness(get)(Array.from({ length: 21 }, (_, i) => i + 1)),
    ).rejects.toBe(failure);
  });

  it('does not request an empty lookup', async () => {
    const get = jest.fn();
    expect((await harness(get)([0, -1])).size).toBe(0);
    expect(get).not.toHaveBeenCalled();
  });
});
