import ExcelJS from 'exceljs';

async function analyze() {
  const filePath = 'e:\\OneDrive - MESCO\\Desktop\\MiddleWare\\D365FOMiddleware_Nestbackend\\IST_Report_After_Matching_Version3.xlsx';
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);

  const istSheet = wb.getWorksheet('Sheet1') || wb.worksheets[0];
  const bankSheet = wb.getWorksheet('Unmatched Bank Transactions');

  const headers: Record<string, number> = {};
  istSheet.getRow(1).eachCell((cell, colNumber) => {
    const val = String(cell.value || '').trim();
    if (val) headers[val] = colNumber;
  });

  console.log('Detected column indices:', headers);

  let totalIstRows = 0;
  let filledReferences = 0;
  let preservedCount = 0;
  let needsReviewCount = 0;
  let exactMatchCount = 0;
  let remainingBlanks = 0;
  let forcedBankMatches = 0;

  istSheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    totalIstRows++;

    const payRef = String(row.getCell(headers['PAYMENTREFERENCE'] || 61).value || '').trim();
    const matchStatus = String(row.getCell(headers['MATCH_STATUS'] || 67).value || '').trim();
    const matchCase = String(row.getCell(headers['MATCH_CASE'] || 68).value || '').trim();

    if (payRef !== '') {
      filledReferences++;
    } else {
      remainingBlanks++;
    }

    if (matchStatus === 'Preserved' || matchCase.includes('PRESERVE')) {
      preservedCount++;
    } else if (matchStatus === 'Needs Review') {
      needsReviewCount++;
    } else if (matchStatus === 'Matched' || matchStatus === 'Exact Match') {
      exactMatchCount++;
    }

    if (matchCase.includes('FORCED')) {
      forcedBankMatches++;
    }
  });

  const unmatchedBankRows = bankSheet ? bankSheet.rowCount - 1 : 0;

  console.log('\n================ OFFICIAL VERSION 3 METRICS ================');
  console.log(`Total IST Rows: ${totalIstRows}`);
  console.log(`References Filled: ${filledReferences}`);
  console.log(`Existing Preserved: ${preservedCount}`);
  console.log(`Needs Review: ${needsReviewCount}`);
  console.log(`Unmatched IST Rows (Remaining Blanks): ${remainingBlanks}`);
  console.log(`Forced Bank Matches: ${forcedBankMatches}`);
  console.log(`Unmatched Bank Rows: ${unmatchedBankRows}`);
}

analyze().catch(console.error);
