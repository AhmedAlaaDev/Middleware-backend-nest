import {
  assertSafeXlsxArchive,
  YardInvoiceArchiveError,
} from './yard-invoice-archive-guard';
import {
  baseRow,
  buildTemplateWorkbook,
  buildZip,
} from './yard-invoice.test-helpers';

describe('assertSafeXlsxArchive', () => {
  it('accepts a normal xlsx package', async () => {
    const xlsx = await buildTemplateWorkbook([baseRow()]);
    expect(() => assertSafeXlsxArchive(xlsx)).not.toThrow();
  });

  it('rejects a buffer that is not a ZIP', () => {
    expect(() =>
      assertSafeXlsxArchive(Buffer.from('plain text file, not a zip at all')),
    ).toThrow(YardInvoiceArchiveError);
  });

  it('rejects a highly compressible payload that expands beyond the ratio guard', async () => {
    const zeros = Buffer.alloc(5 * 1024 * 1024, 0);
    const bomb = await buildZip([
      { name: 'xl/sharedStrings.xml', content: zeros },
    ]);
    expect(bomb.length).toBeLessThan(2 * 1024 * 1024);
    expect(() => assertSafeXlsxArchive(bomb)).toThrow(/compression ratio/);
  });

  it('rejects a package above the file size limit', () => {
    const big = Buffer.alloc(11 * 1024 * 1024, 1);
    big.writeUInt32LE(0x04034b50, 0);
    expect(() => assertSafeXlsxArchive(big)).toThrow(/byte limit/);
  });
});
