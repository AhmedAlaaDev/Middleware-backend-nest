import {
  CUSTODY_SETTLEMENT_SKIP_KIND,
  createCustodySettlementSkipRow,
  formatCustodySettlementSkipBatchSummary,
  formatCustodySettlementSkipWarning,
  isAlreadyMarkedUnmarkedUploadSkip,
  isCustodySettlementSkipError,
  toCustodySettlementSkipBatchError,
  toCustodySettlementSkipExcelRow,
} from './custody-settlement-skip-report';

describe('custody-settlement-skip-report', () => {
  it('maps a skip row to Excel columns with source UniqueId and Excel line numbers', () => {
    const row = createCustodySettlementSkipRow({
      uniqueId: '475761',
      excelLineNumbers: [839, 841, 0, 839],
      journalBatchNumber: 'Mesco-000015553',
      d365LineNumbers: [2, 4],
      vendorAccount: 'Sl-000036',
      invoiceNumber: '5815372458',
      documentNumber: '16760',
      amount: 298.86,
      phase: 'settle',
      error: new Error('remainder 298.84'),
    });

    expect(toCustodySettlementSkipExcelRow(row)).toEqual({
      UniqueId: '475761',
      'Excel LINENUMBER': '839, 841',
      JournalBatchNumber: 'Mesco-000015553',
      'D365 LineNumber': '2, 4',
      VendorAccount: 'Sl-000036',
      InvoiceNumber: '5815372458',
      DocumentNumber: '16760',
      Amount: '298.86',
      Phase: 'Settlement',
      Error: 'remainder 298.84',
    });
    expect(formatCustodySettlementSkipWarning(row)).toBe(
      'Settlement skipped: UniqueId 475761 2 Excel lines (839–841): remainder 298.84',
    );
  });

  it('keeps already-marked UniqueIds as settlement skips after unmarked upload', () => {
    const row = createCustodySettlementSkipRow({
      uniqueId: '466596',
      excelLineNumbers: [900],
      journalBatchNumber: 'Mesco-000015604',
      d365LineNumbers: [1],
      vendorAccount: 'Sl-000020',
      invoiceNumber: 'INV-MARKED',
      documentNumber: 'DOC-MARKED',
      amount: 100,
      phase: 'settle',
      error:
        'Line uploaded without settlement: This transaction has been marked for settlement by Vendor Payment Freight Mesco-000015604 in company m-p.',
    });

    expect(toCustodySettlementSkipExcelRow(row).Phase).toBe('Settlement');
    expect(toCustodySettlementSkipExcelRow(row).Error).toContain(
      'has been marked for settlement by Vendor Payment Freight',
    );
    expect(formatCustodySettlementSkipWarning(row)).toContain(
      'Settlement skipped: UniqueId 466596 Excel line 900',
    );
    expect(isAlreadyMarkedUnmarkedUploadSkip(row)).toBe(true);
  });

  it('summarizes skip rows for the batch UI without listing every Excel line', () => {
    const rows = [
      createCustodySettlementSkipRow({
        uniqueId: '488810',
        excelLineNumbers: [4267, 4452],
        phase: 'post',
        error: 'already marked',
      }),
      createCustodySettlementSkipRow({
        uniqueId: '475761',
        excelLineNumbers: [841],
        phase: 'settle',
        error: 'remainder',
      }),
    ];

    expect(formatCustodySettlementSkipBatchSummary(rows)).toBe(
      'Skipped lines: 2 skipped UniqueId issue(s) across 2 UniqueId(s) and 3 Excel line(s) (1 upload, 1 settlement). Open View Errors or download the error Excel for UniqueId, Excel LINENUMBER, and reason.',
    );
  });

  it('stores skip identity on a batch error so the Excel download can remap to the source file', () => {
    const row = createCustodySettlementSkipRow({
      uniqueId: '475761',
      excelLineNumbers: [841],
      journalBatchNumber: 'JN-1',
      d365LineNumbers: [4],
      phase: 'post',
      error: 'D365 rejected UniqueId',
    });
    const stored = toCustodySettlementSkipBatchError('batch-1', 'run-1', row);

    expect(stored.sourceRecordIds).toEqual(['475761']);
    expect(stored.enhancedData).toEqual(
      expect.objectContaining({
        kind: CUSTODY_SETTLEMENT_SKIP_KIND,
        uniqueId: '475761',
        excelLineNumbers: [841],
        phase: 'post',
      }),
    );
    expect(isCustodySettlementSkipError(stored.enhancedData)).toBe(true);
  });
});
