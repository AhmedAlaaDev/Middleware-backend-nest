import ExcelJS from 'exceljs';

async function validateParity() {
  const dynPath =
    'e:\\OneDrive - MESCO\\Desktop\\MiddleWare\\D365FOMiddleware_Nestbackend\\DynamicsExport_639203027794976482.xlsx';
  const istConvertedPath =
    'e:\\OneDrive - MESCO\\Desktop\\MiddleWare\\D365FOMiddleware_Nestbackend\\Dynamics_Converted_To_IST.xlsx';

  console.log('Loading workbooks for data loss validation...');
  const dynWb = new ExcelJS.Workbook();
  await dynWb.xlsx.readFile(dynPath);
  const dynSheet = dynWb.worksheets[0];

  const istWb = new ExcelJS.Workbook();
  await istWb.xlsx.readFile(istConvertedPath);
  const istSheet = istWb.worksheets[0];

  const dynRows = dynSheet.rowCount - 1;
  const istRows = istSheet.rowCount - 1;

  console.log(
    `\n================ DATA INTEGRITY & PARITY TEST RESULTS ================`,
  );
  console.log(`1. Row Count Check:`);
  console.log(`   - Dynamics Export Rows: ${dynRows}`);
  console.log(`   - Converted IST Rows:   ${istRows}`);
  console.log(
    `   - Status: ${dynRows === istRows ? 'PASSED (0 rows lost) ✅' : 'FAILED ❌'}`,
  );

  // Calculate Financial Totals
  let dynTotalTxAmount = 0;
  let dynTotalEgpAmount = 0;

  const dynHeaders: Record<string, number> = {};
  dynSheet.getRow(1).eachCell((cell, colNumber) => {
    const val = String(cell.value || '').trim();
    if (val) dynHeaders[val] = colNumber;
  });

  dynSheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const tx =
      Number(
        row.getCell(dynHeaders['Amount in transaction currency'] || 10).value,
      ) || 0;
    const egp = Number(row.getCell(dynHeaders['Amount'] || 11).value) || 0;
    dynTotalTxAmount += tx;
    dynTotalEgpAmount += egp;
  });

  const istHeaders: Record<string, number> = {};
  istSheet.getRow(1).eachCell((cell, colNumber) => {
    const val = String(cell.value || '').trim();
    if (val) istHeaders[val] = colNumber;
  });

  let istTotalDebit = 0;
  let istTotalCredit = 0;
  let istTotalEqvDebit = 0;
  let istTotalEqvCredit = 0;

  istSheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const d = Number(row.getCell(istHeaders['DEBIT']).value) || 0;
    const c = Number(row.getCell(istHeaders['CREDIT']).value) || 0;
    const ed = Number(row.getCell(istHeaders['EQV Depit']).value) || 0;
    const ec = Number(row.getCell(istHeaders['EQV Credit']).value) || 0;

    istTotalDebit += d;
    istTotalCredit += c;
    istTotalEqvDebit += ed;
    istTotalEqvCredit += ec;
  });

  const istNetTxAmount = istTotalDebit - istTotalCredit;
  const istNetEqvAmount = istTotalEqvDebit - istTotalEqvCredit;

  console.log(`\n2. Financial Sum Reconciliation Check:`);
  console.log(`   - Dynamics Net Tx Amount:  ${dynTotalTxAmount.toFixed(2)}`);
  console.log(`   - Converted Net Tx Amount: ${istNetTxAmount.toFixed(2)}`);
  console.log(
    `   - Difference: ${Math.abs(dynTotalTxAmount - istNetTxAmount).toFixed(4)}`,
  );
  console.log(
    `   - Status: ${Math.abs(dynTotalTxAmount - istNetTxAmount) < 0.01 ? 'PASSED (100% Exact Financial Parity) ✅' : 'FAILED ❌'}`,
  );

  console.log(`\n3. EGP Equivalent Amount Reconciliation Check:`);
  console.log(`   - Dynamics Net EGP Amount:  ${dynTotalEgpAmount.toFixed(2)}`);
  console.log(`   - Converted Net EGP Amount: ${istNetEqvAmount.toFixed(2)}`);
  console.log(
    `   - Difference: ${Math.abs(dynTotalEgpAmount - istNetEqvAmount).toFixed(4)}`,
  );
  console.log(
    `   - Status: ${Math.abs(dynTotalEgpAmount - istNetEqvAmount) < 0.01 ? 'PASSED (100% Exact EGP Parity) ✅' : 'FAILED ❌'}`,
  );

  // Spot-check random sample row (Row 100)
  console.log(`\n4. Spot-Check Sample Verification (Row 100):`);
  const dynRow100: Record<string, any> = {};
  dynSheet.getRow(100).eachCell((cell, colNumber) => {
    dynRow100[dynSheet.getRow(1).getCell(colNumber).value as string] =
      cell.value;
  });

  const istRow100: Record<string, any> = {};
  istSheet.getRow(100).eachCell((cell, colNumber) => {
    istRow100[istSheet.getRow(1).getCell(colNumber).value as string] =
      cell.value;
  });

  console.log(
    `   - Dynamics Voucher: ${dynRow100['Voucher']} -> Converted VOUCHER: ${istRow100['VOUCHER']}`,
  );
  console.log(
    `   - Dynamics Journal: ${dynRow100['Journal number']} -> Converted JOURNALNAME: ${istRow100['JOURNALNAME']}`,
  );
  console.log(
    `   - Dynamics Tx Amount: ${dynRow100['Amount in transaction currency']} -> DEBIT: ${istRow100['DEBIT']}, CREDIT: ${istRow100['CREDIT']}`,
  );
  console.log(
    `   - Dynamics Payment reference: ${dynRow100['Payment reference']} -> PAYMENTREFERENCE: ${istRow100['PAYMENTREFERENCE']}`,
  );
  console.log(
    `   - Dynamics Document2/Document: ${dynRow100['Document2'] || dynRow100['Document']} -> DOCUMENT: ${istRow100['DOCUMENT']}`,
  );
}

validateParity().catch(console.error);
