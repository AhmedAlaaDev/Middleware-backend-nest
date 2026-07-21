const ExcelJS = require('exceljs');
const fs = require('fs');

async function sliceExcel() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile('src/excel-sources/Cash/Safe Out_01_26_Freight.xlsx');
  const worksheet = workbook.worksheets[0];
  
  const newWorkbook = new ExcelJS.Workbook();
  const newWorksheet = newWorkbook.addWorksheet('Sheet1');
  
  let i = 1;
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber <= 4) { // header + 3 data rows
      newWorksheet.addRow(row.values);
    }
  });
  
  await newWorkbook.xlsx.writeFile('src/excel-sources/Cash/Test_Slice.xlsx');
  console.log('Saved Test_Slice.xlsx');
}

sliceExcel().catch(console.error);
