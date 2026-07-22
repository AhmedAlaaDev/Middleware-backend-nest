import ExcelJS from 'exceljs';

async function analyzeInputs() {
  const bankPath = 'e:\\OneDrive - MESCO\\Desktop\\MiddleWare\\D365FOMiddleware_Nestbackend\\ALL banks 31-5-2026 update.xlsx';
  const istPath = 'e:\\OneDrive - MESCO\\Desktop\\MiddleWare\\D365FOMiddleware_Nestbackend\\IST Report from jan to apr 2026.xlsx';

  const istWb = new ExcelJS.Workbook();
  await istWb.xlsx.readFile(istPath);
  const istSheet = istWb.worksheets[0];

  const bankWb = new ExcelJS.Workbook();
  await bankWb.xlsx.readFile(bankPath);
  const bankSheet = bankWb.worksheets[0];

  let totalIstRows = istSheet.rowCount - 1;
  let existingPreserved = 0;
  let blankIstCount = 0;

  const headers: Record<string, number> = {};
  istSheet.getRow(1).eachCell((cell, colNumber) => {
    const val = String(cell.value || '').trim();
    if (val) headers[val] = colNumber;
  });

  const payRefCol = headers['PAYMENTREFERENCE'] || 61;

  istSheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const ref = String(row.getCell(payRefCol).value || '').trim();
    if (ref !== '') {
      existingPreserved++;
    } else {
      blankIstCount++;
    }
  });

  let totalBankRows = bankSheet.rowCount - 1;

  console.log('\n================ INPUT FILES ANALYSIS ================');
  console.log(`Total IST Rows: ${totalIstRows}`);
  console.log(`Input Preserved References: ${existingPreserved}`);
  console.log(`Input Blank IST Rows: ${blankIstCount}`);
  console.log(`Total Bank Rows: ${totalBankRows}`);
}

analyzeInputs().catch(console.error);
