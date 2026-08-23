import { NestFactory } from '@nestjs/core';
import * as ExcelJS from 'exceljs';

import { AppModule } from './app.module';
import { CustomerPaymentJournalService } from './modules/d365fo/services/customer-payment-journal.service';
import { D365FOCustomerPaymentJournalLineRequest } from './modules/d365fo/types';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const customerPaymentJournalService = app.get(CustomerPaymentJournalService);

  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(
      'src/excel-sources/Cash/Safe Out_01_26_Freight.xlsx',
    );
    const worksheet = workbook.worksheets[0];

    const rows: any[] = [];
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber > 1 && rowNumber <= 4) {
        // rows 2,3,4 (first 3 data rows)
        const rowData: any = {};
        row.eachCell((cell, colNumber) => {
          const header = worksheet.getRow(1).getCell(colNumber).value;
          rowData[String(header)] = cell.value;
        });
        rows.push(rowData);
      }
    });

    console.log(`Parsed ${rows.length} rows from Excel.`);
    // Since mapping is complex, I will just construct 3 dummy lines using the parsed data to hit our modified function.
    const mappedLines: D365FOCustomerPaymentJournalLineRequest[] = rows.map(
      (row, index) => {
        return {
          dataAreaId: 'm-p',
          LineNumber: index + 1,
          cashDirection: 'out',
          customLineApiBody: {
            journalNum: '',
            AccountNum: String(row['ACCOUNTDISPLAYVALUE'] || ''),
            accountTypeStr: String(row['ACCOUNTTYPE'] || 'Petty Cash') as any,
            BANKTRANSACTIONTYPE: String(row['VoucherType'] || 'Cash'),
            CENTRALBANKPURPOSECODE: '',
            CENTRALBANKPURPOSETEXT: '',
            company: 'm-p',
            creditAmount: Number(row['CREDITAMOUNT'] || 0),
            currency: String(row['CURRENCYCODE'] || 'EGP'),
            debitAmount: Number(row['DEBITAMOUNT'] || 0),
            DEFAULTDIMENSIONDISPLAYVALUE: String(
              row['DEFAULTDIMENSIONDISPLAYVALUE'] || '',
            ),
            offsetDEFAULTDIMENSIONDISPLAYVALUE: String(
              row['OFFSETDEFAULTDIMENSIONDISPLAYVALUE'] || '',
            ),
            FinTagStr: String(row['FINTAGDISPLAYVALUE'] || ''),
            ISPREPAYMENT: 'No',
            ITEMWITHHOLDINGTAXGROUP: '',
            MARKEDINVOICE: '',
            MarkedLines: [],
            offsetAccountDisplayValue: String(
              row['OFFSETACCOUNTDISPLAYVALUE'] || '',
            ),
            OffsetAccountTypeStr: String(row['OFFSETACCOUNTTYPE'] || '') as any,
            OffsetCompany: 'm-p',
            OFFSETFINTAGDISPLAYVALUE: String(
              row['OFFSETFINTAGDISPLAYVALUE'] || '',
            ),
            OFFSETTRANSACTIONTEXT: String(row['OFFSETTEXT'] || ''),
            PAYMENTID: '',
            PAYMENTMETHODNAME: '',
            PAYMENTNOTES: '',
            PAYMENTREFERENCE: '',
            PAYMENTSPECIFICATION: '',
            PostingProfile: String(row['POSTINGPROFILE'] || ''),
            TaxGroup: String(row['SALESTAXGROUP'] || ''),
            TAXITEMGROUP: '',
            transDate: '2026-01-01',
            DocumentNum: String(row['DOCUMENT'] || ''),
            DocumentDate: String(row['DOCUMENTDATE'] || '2026-01-01'),
            TRANSACTIONTEXT: String(row['TEXT'] || ''),
            Voucher: '',
          },
        };
      },
    );

    const headerKey = String(rows[0]['JOURNALBATCHNUMBER'] || 'TEST-001');
    console.log(`Calling postCashOutLinesForHeader for ${headerKey}...`);
    const result =
      await customerPaymentJournalService.postCashOutLinesForHeader(
        headerKey,
        mappedLines,
        1,
        'm-p',
      );
    console.log('Successfully posted lines!', result);
  } catch (err) {
    console.error('Test Error:', err);
  } finally {
    await app.close();
  }
}
bootstrap();
