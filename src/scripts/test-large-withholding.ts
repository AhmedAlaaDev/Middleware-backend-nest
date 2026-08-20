import * as fs from 'fs';

import { CashEntryRawDataModel } from '../modules/cash/models/cash-entry-raw-data.model';
import { BaseCashEntryProcessor } from '../modules/cash/processors/base/base-cash-entry.processor';

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

// Read the JSON dumped from the large Excel file
const rawData = JSON.parse(
  fs.readFileSync(__dirname + '/test_data.json', 'utf8'),
);

// Convert to EntryRawDataModel
const models = rawData.map((d: any) => {
  const model = new CashEntryRawDataModel({} as any, 'Freight');
  model.ACCOUNTTYPE = d.ACCOUNTTYPE;
  model.ACCOUNTDISPLAYVALUE = String(d.ACCOUNTDISPLAYVALUE);
  model.VOUCHER = d.VOUCHER;
  model.INVOICE = String(d.INVOICE);
  model.CREDITAMOUNT = Number(d.CREDITAMOUNT) || 0;
  model.DEBITAMOUNT = Number(d.DEBITAMOUNT) || 0;
  return model;
});

const withholdingBefore = models.filter(
  (m) =>
    m.ACCOUNTTYPE === 'Ledger' && m.ACCOUNTDISPLAYVALUE.startsWith('223304'),
).length;
console.log(
  `\nBefore processing: Found ${withholdingBefore} withholding lines.`,
);

const processor = new TestProcessor();
const result = processor.test(models);

const withholdingAfter = result.lines.filter(
  (m) =>
    m.ACCOUNTTYPE === 'Ledger' && m.ACCOUNTDISPLAYVALUE.startsWith('223304'),
).length;
console.log(
  `After processing: Found ${withholdingAfter} withholding lines remaining.\n`,
);
