import ExcelJS from 'exceljs';

async function inspect() {
  const dynPath = 'e:\\OneDrive - MESCO\\Desktop\\MiddleWare\\D365FOMiddleware_Nestbackend\\DynamicsExport_639203027794976482.xlsx';
  const istPath = 'e:\\OneDrive - MESCO\\Desktop\\MiddleWare\\D365FOMiddleware_Nestbackend\\IST Report from jan to apr 2026.xlsx';

  const dynWb = new ExcelJS.Workbook();
  await dynWb.xlsx.readFile(dynPath);
  const dynSheet = dynWb.worksheets[0];

  const istWb = new ExcelJS.Workbook();
  await istWb.xlsx.readFile(istPath);
  const istSheet = istWb.worksheets[0];

  const dynHeaders: string[] = [];
  dynSheet.getRow(1).eachCell((cell, colNumber) => {
    dynHeaders[colNumber] = String(cell.value || '').trim();
  });

  const istHeaders: string[] = [];
  istSheet.getRow(1).eachCell((cell, colNumber) => {
    istHeaders[colNumber] = String(cell.value || '').trim();
  });

  console.log('\n--- DYNAMICS EXPORT HEADERS ---');
  console.log(dynHeaders.filter(Boolean));

  console.log('\n--- IST REPORT HEADERS ---');
  console.log(istHeaders.filter(Boolean));

  // Inspect first 2 sample rows of Dynamics
  console.log('\n--- DYNAMICS SAMPLE ROW 2 ---');
  const dynRow2: Record<string, any> = {};
  dynSheet.getRow(2).eachCell((cell, colNumber) => {
    dynRow2[dynHeaders[colNumber]] = cell.value;
  });
  console.log(dynRow2);
}

inspect().catch(console.error);
