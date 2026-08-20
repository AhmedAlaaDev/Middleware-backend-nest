import path from 'path';

import ExcelJS from 'exceljs';

async function transform() {
  const dynPath =
    'e:\\OneDrive - MESCO\\Desktop\\MiddleWare\\D365FOMiddleware_Nestbackend\\DynamicsExport_639203027794976482.xlsx';
  const outputPath =
    'e:\\OneDrive - MESCO\\Desktop\\MiddleWare\\D365FOMiddleware_Nestbackend\\Dynamics_Converted_To_IST.xlsx';

  console.log(`Reading Dynamics export file from: ${dynPath}`);
  const dynWb = new ExcelJS.Workbook();
  await dynWb.xlsx.readFile(dynPath);
  const dynSheet = dynWb.worksheets[0];

  const dynHeaders: Record<string, number> = {};
  dynSheet.getRow(1).eachCell((cell, colNumber) => {
    const val = String(cell.value || '').trim();
    if (val) dynHeaders[val] = colNumber;
  });

  // IST Output Headers Order
  const istHeaders = [
    'Name',
    'UniqueId',
    'LINENUMBER',
    'JOURNALNAME',
    'DESCRIPTION',
    'VOUCHER',
    'TRANSDATE',
    'ACCOUNTTYPE',
    'Operation No',
    'Charge Type',
    'Charge Type Name',
    'Cost Centers',
    'Cost Center',
    'Main Account',
    'Account Name',
    'Account Type',
    'DEBIT',
    'CREDIT',
    'CURRENCYCODE',
    'EQV Depit',
    'EQV Credit',
    'Customer',
    'Client Name',
    'Sales Name',
    'Coordinator code',
    'Coordinator Man',
    'Location',
    'Locations',
    'Sales Man',
    'Freight Type',
    'Direction',
    'Quotation No',
    'Shipping Line Name',
    'Shipping Line',
    'Agent',
    'Agent Name',
    'MBL',
    'Container No',
    'Container Type',
    'HBL',
    'Voyage No',
    'Vessel Name',
    'POL',
    'POD',
    'ETA',
    'ETD',
    'ATA',
    'CBMs',
    'Weight',
    'Creation Date',
    'Closing Date',
    'EXCHANGERATE',
    'SALESTAXGROUP',
    'ITEMSALESTAXGROUP',
    'TAXEXEMPTNUMBER',
    'ITEMWITHHOLDINGTAXGROUPCODE',
    'DOCUMENT',
    'DOCUMENTDATE',
    'INVOICE',
    'PAYMENTMETHOD',
    'PAYMENTREFERENCE',
    'SALESTAXCODE',
    'SafeType',
    'Closing Month',
    'Closing Year',
  ];

  const outWb = new ExcelJS.Workbook();
  const outSheet = outWb.addWorksheet('Sheet1');

  // Add header row
  outSheet.addRow(istHeaders);

  let rowCount = 0;

  function getDynValue(row: ExcelJS.Row, headerName: string): any {
    const colIdx = dynHeaders[headerName];
    if (!colIdx) return '';
    const cellVal = row.getCell(colIdx).value;
    if (cellVal === null || cellVal === undefined) return '';
    if (typeof cellVal === 'object' && 'result' in cellVal)
      return cellVal.result;
    return cellVal;
  }

  function formatDate(val: any): string {
    if (!val) return '';
    if (val instanceof Date) {
      return val.toISOString().split('T')[0];
    }
    const str = String(val).trim();
    if (str.includes('T')) return str.split('T')[0];
    return str;
  }

  dynSheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // Skip header
    rowCount++;

    const txAmount =
      Number(getDynValue(row, 'Amount in transaction currency')) || 0;
    const eqvAmount = Number(getDynValue(row, 'Amount')) || 0;

    const debit = txAmount > 0 ? txAmount : 0;
    const credit = txAmount < 0 ? Math.abs(txAmount) : 0;

    const eqvDebit = eqvAmount > 0 ? eqvAmount : 0;
    const eqvCredit = eqvAmount < 0 ? Math.abs(eqvAmount) : 0;

    // Vendor / Customer accounts & names
    const vendorAccount = String(getDynValue(row, 'Vendor account')).trim();
    const customerAccount = String(getDynValue(row, 'Customer account')).trim();
    const customer = vendorAccount || customerAccount;

    const vendorName = String(getDynValue(row, 'Vendor name')).trim();
    const customerName = String(getDynValue(row, 'Customer name')).trim();
    const clientName = vendorName || customerName;

    // ShippingLine rule
    const rawShippingLine = String(getDynValue(row, 'ShippingLine')).trim();
    let shippingLine = '';
    let shippingLineName = '';
    if (
      rawShippingLine.startsWith('Sl-') ||
      rawShippingLine.startsWith('SL-')
    ) {
      shippingLine = rawShippingLine;
    } else {
      shippingLineName = rawShippingLine;
    }

    // Agent rule
    const rawAgent = String(getDynValue(row, 'Agent')).trim();
    let agent = '';
    let agentName = '';
    if (rawAgent.startsWith('Ag-') || rawAgent.startsWith('AG-')) {
      agent = rawAgent;
    } else {
      agentName = rawAgent;
    }

    // Document rule: Document2 primary, Document fallback
    const doc2 = String(getDynValue(row, 'Document2')).trim();
    const doc1 = String(getDynValue(row, 'Document')).trim();
    const document =
      doc2 && doc2 !== 'None' ? doc2 : doc1 !== 'None' ? doc1 : '';

    const outRow: Record<string, any> = {
      UniqueId: rowNumber - 1,
      LINENUMBER: rowNumber - 1,
      JOURNALNAME: String(getDynValue(row, 'Journal number')),
      DESCRIPTION: String(getDynValue(row, 'Description')),
      VOUCHER: String(getDynValue(row, 'Voucher')),
      TRANSDATE: formatDate(getDynValue(row, 'Date')),
      ACCOUNTTYPE: String(getDynValue(row, 'Posting type')),
      'Account Name': String(getDynValue(row, 'Account name')),
      'Account Type': String(getDynValue(row, 'Posting type')),
      DEBIT: debit,
      CREDIT: credit,
      CURRENCYCODE: String(getDynValue(row, 'Currency')),
      'EQV Depit': eqvDebit,
      'EQV Credit': eqvCredit,
      Customer: customer,
      'Client Name': clientName,
      'Operation No': String(getDynValue(row, 'OperationNo')),
      'Quotation No': String(getDynValue(row, 'QuotationNo')),
      'Shipping Line': shippingLine,
      'Shipping Line Name': shippingLineName,
      Agent: agent,
      'Agent Name': agentName,
      MBL: String(getDynValue(row, 'MBL')),
      'Container No': String(getDynValue(row, 'ContainerNo')),
      'Container Type': String(getDynValue(row, 'ContainerType')),
      HBL: String(getDynValue(row, 'HBL')),
      'Voyage No': String(getDynValue(row, 'VoyageNo')),
      'Vessel Name': String(getDynValue(row, 'VesselName')),
      POL: String(getDynValue(row, 'POL')),
      POD: String(getDynValue(row, 'POD')),
      ETA: formatDate(getDynValue(row, 'ETA')),
      ETD: formatDate(getDynValue(row, 'ETD')),
      ATA: formatDate(getDynValue(row, 'ATA')),
      CBMs: getDynValue(row, 'CBMs'),
      Weight: getDynValue(row, 'Weight'),
      'Creation Date': formatDate(getDynValue(row, 'CreationDate')),
      'Closing Date': formatDate(getDynValue(row, 'ClosingDate')),
      DOCUMENT: document,
      PAYMENTREFERENCE: String(getDynValue(row, 'Payment reference')),
    };

    const rowArray = istHeaders.map((h) => outRow[h] ?? '');
    outSheet.addRow(rowArray);
  });

  console.log(
    `Successfully mapped ${rowCount} rows from Dynamics Export to IST shape.`,
  );
  await outWb.xlsx.writeFile(outputPath);
  console.log(`Saved output file to: ${outputPath}`);
}

transform().catch(console.error);
