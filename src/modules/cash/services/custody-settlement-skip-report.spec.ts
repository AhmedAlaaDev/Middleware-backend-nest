import {
  CUSTODY_SETTLEMENT_SKIP_KIND,
  createCustodySettlementSkipRow,
  formatCustodySettlementSkipWarning,
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
      'Settlement skipped: UniqueId 475761 Excel line 839, 841: remainder 298.84',
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
