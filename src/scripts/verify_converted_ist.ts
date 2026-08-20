import ExcelJS from 'exceljs';

async function verify() {
  const filePath =
    'e:\\OneDrive - MESCO\\Desktop\\MiddleWare\\D365FOMiddleware_Nestbackend\\Dynamics_Converted_To_IST.xlsx';
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);

  const sheet = wb.worksheets[0];
  console.log(`Verified worksheet name: ${sheet.name}`);
  console.log(`Total rows in output: ${sheet.rowCount}`);

  const headerRow = sheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell((cell, colNumber) => {
    headers[colNumber] = String(cell.value || '').trim();
  });

  console.log(`Total headers count: ${headers.filter(Boolean).length}`);
  console.log(`Sample Row 2:`);

  const sampleRow: Record<string, any> = {};
  sheet.getRow(2).eachCell((cell, colNumber) => {
    sampleRow[headers[colNumber]] = cell.value;
  });
  console.log(JSON.stringify(sampleRow, null, 2));
}

verify().catch(console.error);
