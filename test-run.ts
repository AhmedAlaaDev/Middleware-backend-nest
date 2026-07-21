import { ReconciliationService } from './src/modules/reconciliation/reconciliation.service';
import ExcelJS from 'exceljs';

async function main() {
  const service = new ReconciliationService();

  // Create IST Workbook
  const istWb = new ExcelJS.Workbook();
  const istSheet = istWb.addWorksheet('Sheet1');
  istSheet.addRow([
    'DESCRIPTION', 'TRANSDATE', 'DEBIT', 'CREDIT', 'Client Name', 'Operation No', 'DOCUMENT', 'INVOICE', 'PAYMENTREFERENCE', 'Voucher', 'Main Account', 'JOURNALNAME', 'Customer', 'UniqueId', 'Quotation No', 'MBL', 'Container No', 'HBL', 'Voyage No', 'Vessel Name', 'Locations', 'SafeType'
  ]);
  
  // Row 2: R1 match (PAYMENTREFERENCE = bank Ref exactly)
  istSheet.addRow([
    'IST row 1', '2026-07-20', 1000, 0, 'Client A', 'OP-123', 'DOC-123', 'INV-123', 'PAY-R1', 'V-123', '110101', 'GenJnl', 'CustA', 'uid-1', '', '', '', '', '', '', '', ''
  ]);
  
  // Row 3: R2 match (DOCUMENT = bank Ref exactly)
  istSheet.addRow([
    'IST row 2', '2026-07-20', 2000, 0, 'Client B', 'OP-456', 'DOC-R2', '', '', 'V-456', '110101', 'GenJnl', 'CustB', 'uid-2', '', '', '', '', '', '', '', ''
  ]);

  // Row 4: R4 match (PAYMENTREFERENCE contains bank Ref)
  istSheet.addRow([
    'IST row 3', '2026-07-20', 3000, 0, 'Client C', 'OP-789', '', '', 'REF-PAY-R4-COMPLEX', 'V-789', '110101', 'GenJnl', 'CustC', 'uid-3', '', '', '', '', '', '', '', ''
  ]);

  const istBuffer = await istWb.xlsx.writeBuffer() as unknown as Buffer;

  // Create Bank Workbook
  const bankWb = new ExcelJS.Workbook();
  const bankSheet = bankWb.addWorksheet('Sheet1');
  bankSheet.addRow([
    'Transaction date', 'bank Ref', 'Description', 'Deposit', 'Withdraw', 'Client Name', 'Supplier Beneficiary', 'cash flow', 'Dyn_Map.Dyn code', 'Customer reference', 'Dynamics entery', 'Value date'
  ]);
  
  // Bank Row 2 (matches Row 2 exactly via PAYMENTREFERENCE)
  bankSheet.addRow([
    '2026-07-20', 'PAY-R1', 'Bank description 1', 1000, 0, 'Client A', 'Supplier A', 'Operating', '110101', '', '', '2026-07-20'
  ]);
  
  // Bank Row 3 (matches Row 3 exactly via DOCUMENT)
  bankSheet.addRow([
    '2026-07-20', 'DOC-R2', 'Bank description 2', 2000, 0, 'Client B', 'Supplier B', 'Operating', '110101', '', '', '2026-07-20'
  ]);
  
  // Bank Row 4 (matches Row 4 via substring PAYMENTREFERENCE: "REF-PAY-R4-COMPLEX" matches "PAY-R4-COMPLEX")
  bankSheet.addRow([
    '2026-07-20', 'PAY-R4-COMPLEX', 'Bank description 3', 3000, 0, 'Client C', 'Supplier C', 'Operating', '110101', '', '', '2026-07-20'
  ]);

  const bankBuffer = await bankWb.xlsx.writeBuffer() as unknown as Buffer;

  const result = await service.reconcileWithReport(istBuffer, bankBuffer, {
    toleranceDays: 3,
    amountTolerance: 0.01,
    amountTolerancePercent: 0.05,
    amountToleranceCap: 100,
    confidenceThreshold: 0.75,
    audit: true,
    allowManyToOne: false,
    forceAll: true
  });

  console.log('\n--- RECONCILIATION SUMMARY ---');
  console.log(JSON.stringify(result.report.summary, null, 2));

  // Parse the output workbook
  const outWb = new ExcelJS.Workbook();
  await outWb.xlsx.load(result.workbook as any);
  const outSheet = outWb.worksheets[0];

  console.log('\n--- OUTPUT SHEET ROWS ---');
  outSheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) {
      console.log(`Row 1: [Headers]`);
    } else {
      console.log(`Row ${rowNumber}: DESCRIPTION="${row.getCell(1).value}", PAYMENTREFERENCE="${row.getCell(9).value}", AUDIT_STATUS="${row.getCell(23).value}", AUDIT_MATCH_CASE="${row.getCell(24).value}", AUDIT_CONFIDENCE="${row.getCell(25).value}", AUDIT_REASON="${row.getCell(26).value}"`);
    }
  });
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
