import { Logger } from '@nestjs/common';

import { CashEntryRawDataModel } from '../modules/cash/models/cash-entry-raw-data.model';
import { BaseCashEntryProcessor } from '../modules/cash/processors/base-cash-entry.processor';

class TestProcessor extends BaseCashEntryProcessor {
  entryProcessorType: any;
  requiredDimensions: any;
  protected isInbound() {
    return false;
  }
  protected isTrucking() {
    return false;
  }

  constructor() {
    // mock dependencies
    super({} as any, {} as any);
  }

  public test(lines: CashEntryRawDataModel[]) {
    return this.applyWithholdingReductions(lines);
  }
}

const mockData = require('./test_data.json');

const models = mockData.map((d) => {
  const model = new CashEntryRawDataModel({} as any, 'Freight');
  model.ACCOUNTTYPE = d.ACCOUNTTYPE;
  model.ACCOUNTDISPLAYVALUE = d.ACCOUNTDISPLAYVALUE;
  model.VOUCHER = d.VOUCHER;
  model.INVOICE = d.INVOICE;
  model.CREDITAMOUNT = d.CREDITAMOUNT;
  model.DEBITAMOUNT = d.DEBITAMOUNT;
  return model;
});

console.log('--- BEFORE ---');
models.forEach((m) =>
  console.log(
    `${m.ACCOUNTTYPE} | ${m.VOUCHER} | ${m.INVOICE} | Debit: ${m.DEBITAMOUNT} | Credit: ${m.CREDITAMOUNT}`,
  ),
);

const processor = new TestProcessor();
const result = processor.test(models);

console.log('\n--- AFTER ---');
result.lines.forEach((m) =>
  console.log(
    `${m.ACCOUNTTYPE} | ${m.VOUCHER} | ${m.INVOICE} | Debit: ${m.DEBITAMOUNT} | Credit: ${m.CREDITAMOUNT}`,
  ),
);
