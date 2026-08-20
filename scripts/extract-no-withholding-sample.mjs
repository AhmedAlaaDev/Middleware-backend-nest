import ExcelJS from 'exceljs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Mirrors extract-withholding-sample.mjs but selects the opposite set:
 * UniqueId groups where NONE of the rows carry a withholding signal.
 */
async function extractSample() {
  const sourcePath = path.resolve(__dirname, '../Feb - ist - v-p 6 (1).xlsx');
  const targetPath = path.resolve(
    __dirname,
    '../sample_no_withholding_vp6.xlsx',
  );

  console.log(`Reading: ${sourcePath}`);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(sourcePath);
  const ws = wb.worksheets[0];

  const headers = [];
  const headerRow = ws.getRow(1);
  headerRow.eachCell((cell, colNum) => {
    headers[colNum] = cell.value ? String(cell.value).trim() : '';
  });

  const rowsByUniqueId = new Map();

  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const rowObj = {};
    let hasVal = false;
    for (let c = 1; c < headers.length; c++) {
      const h = headers[c];
      if (!h) continue;
      const v = row.getCell(c).value;
      rowObj[h] = v;
      if (v !== undefined && v !== null && v !== '') hasVal = true;
    }
    if (!hasVal) continue;

    const uniqueId = String(
      rowObj['UniqueId'] || rowObj['SourceId'] || rowObj['Voucher'] || r,
    );
    if (!rowsByUniqueId.has(uniqueId)) {
      rowsByUniqueId.set(uniqueId, []);
    }
    rowsByUniqueId.get(uniqueId).push(rowObj);
  }

  console.log(`Total UniqueId groups: ${rowsByUniqueId.size}`);

  const noWithholdingGroups = [];
  for (const [, group] of rowsByUniqueId.entries()) {
    const hasWithholding = group.some((row) => {
      const acct = String(row['ACCOUNTDISPLAYVALUE'] || '');
      const isWh =
        String(row['ISWITHHOLDINGCALCULATIONENABLED'] || '').toLowerCase() ===
        'yes';
      const whCode = String(row['ITEMWITHHOLDINGTAXGROUPCODE'] || '').trim();
      return acct.includes('223304') || isWh || whCode.length > 0;
    });

    if (!hasWithholding) {
      noWithholdingGroups.push(group);
    }
  }

  console.log(
    `Found ${noWithholdingGroups.length} groups WITHOUT withholding!`,
  );

  const sampleGroups = noWithholdingGroups.slice(0, 10);
  const sampleRows = sampleGroups.flat();

  console.log(
    `Sample has ${sampleGroups.length} groups, total ${sampleRows.length} rows.`,
  );

  const outWb = new ExcelJS.Workbook();
  const outWs = outWb.addWorksheet('Sheet1');

  const headerKeys = headers.filter(Boolean);
  outWs.addRow(headerKeys);

  for (const row of sampleRows) {
    const rowValues = headerKeys.map((k) => row[k] ?? '');
    outWs.addRow(rowValues);
  }

  await outWb.xlsx.writeFile(targetPath);
  console.log(`Successfully saved sample to: ${targetPath}`);

  sampleGroups.forEach((g, idx) => {
    console.log(`\nGroup ${idx + 1} (UniqueId: ${g[0].UniqueId}):`);
    g.forEach((r) => {
      console.log(
        `  - Line ${r.LINENUMBER}: ${r.ACCOUNTTYPE} | ${r.ACCOUNTDISPLAYVALUE} | Debit: ${r.DEBITAMOUNT || 0} | Credit: ${r.CREDITAMOUNT || 0} | Invoice: ${r.INVOICE || r.MARKEDINVOICE || ''} | WH: ${r.ITEMWITHHOLDINGTAXGROUPCODE || ''}`,
      );
    });
  });
}

extractSample().catch((err) => {
  console.error('Error:', err);
});
