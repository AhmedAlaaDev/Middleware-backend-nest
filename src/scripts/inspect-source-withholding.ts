import { readdir, readFile } from 'fs/promises';

import { Workbook } from 'exceljs';

import { ExcelJsAdapter } from '@/modules/excel/adapters/exceljs.adapter';

const YELLOW_FILLS = new Set([
  'ffffff00',
  'ffff00',
  '00ffff00',
  'ffffcc00',
  'fffee100',
]);

async function main() {
  const files = await readdir('.');
  const sourceName = files.find(
    (f) => f.startsWith('_') && f.endsWith('.xlsx'),
  );
  if (!sourceName) {
    console.error('No _*.xlsx source file found');
    process.exit(1);
  }
  console.log('SOURCE FILE:', sourceName);

  const adapter = new ExcelJsAdapter();
  const buffer = await readFile(sourceName);
  const workbook = new Workbook();
  await workbook.xlsx.load(buffer as any);

  for (const ws of workbook.worksheets) {
    console.log(
      `SHEET: "${ws.name}" rows=${ws.rowCount} cols=${ws.columnCount}`,
    );
  }
  const ws = workbook.worksheets[0];
  if (!ws) return;

  const headerRow = ws.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, col) => {
    headers[col - 1] = String(cell.value ?? '').trim();
  });
  console.log('HEADERS:', JSON.stringify(headers));

  const yellowRows: any[] = [];
  const yellowCountByCol = new Map<string, number>();
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    let hasYellow = false;
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const fill = cell.fill as any;
      const fgColor =
        fill?.type === 'pattern'
          ? (fill.fgColor?.argb ?? fill.fgColor?.rgb ?? '')
          : '';
      if (YELLOW_FILLS.has(String(fgColor).toLowerCase())) {
        hasYellow = true;
        const header = headers[colNumber - 1] || `col${colNumber}`;
        yellowCountByCol.set(header, (yellowCountByCol.get(header) ?? 0) + 1);
      }
    });
    if (hasYellow) {
      const record: any = { __row: rowNumber };
      headers.forEach((h, i) => {
        record[h] = row.getCell(i + 1).value;
      });
      yellowRows.push(record);
    }
  });

  console.log('YELLOW ROW COUNT:', yellowRows.length);
  console.log(
    'YELLOW BY COL:',
    JSON.stringify([...yellowCountByCol.entries()]),
  );
  console.log('');
  for (const r of yellowRows) {
    console.log(
      `#${r.__row} ${JSON.stringify({
        UniqueId: r.UniqueId,
        LINENUMBER: r.LINENUMBER,
        VOUCHER: r.VOUCHER,
        ACCOUNTTYPE: r.ACCOUNTTYPE,
        ACCOUNTDISPLAYVALUE: r.ACCOUNTDISPLAYVALUE,
        OFFSETACCOUNTDISPLAYVALUE: r.OFFSETACCOUNTDISPLAYVALUE,
        DOCUMENT: r.DOCUMENT,
        INVOICE: r.INVOICE,
        DebitAmount: r.DebitAmount,
        CreditAmount: r.CreditAmount,
        DESCRIPTION: r.DESCRIPTION,
        FINTAG: r.FINTAGDISPLAYVALUE
          ? String(r.FINTAGDISPLAYVALUE).split('|')[0]
          : '',
      })}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
