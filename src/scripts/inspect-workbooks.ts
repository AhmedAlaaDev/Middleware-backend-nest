import { readFile } from 'fs/promises';

import { ExcelJsAdapter } from '@/modules/excel/adapters/exceljs.adapter';

async function main() {
  const adapter = new ExcelJsAdapter();
  const buffer = await readFile('Casout withholding.xlsx');
  const rows = await adapter.read(buffer);
  console.log('rows:', rows.length);
  const count = (v: string) => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const k = String(r[v]).trim() || '(blank)';
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).join(', ');
  };
  console.log('SafeTransaction:', count('SafeTransaction'));
  console.log('JOURNALNAME:', count('JOURNALNAME'));
  console.log('SafeType:', count('SafeType'));
  console.log('AccountType:', count('ACCOUNTTYPE'));
  console.log('UniqueId:', count('UniqueId'));
  console.log('VoucherType:', count('VoucherType'));
  console.log('');
  rows.forEach((r, i) => {
    console.log(
      `#${i} ${JSON.stringify({
        ACCOUNTDISPLAYVALUE: r.ACCOUNTDISPLAYVALUE,
        OFFSETACCOUNTDISPLAYVALUE: r.OFFSETACCOUNTDISPLAYVALUE,
        AccountType: r.ACCOUNTTYPE,
        DOCUMENT: r.DOCUMENT,
        INVOICE: r.INVOICE,
        UniqueId: r.UniqueId,
        VOUCHER: r.VOUCHER,
        DESCRIPTION: r.DESCRIPTION,
        TRANSACTIONTEXT: r.TRANSACTIONTEXT,
        FINTAG: r.FINTAGDISPLAYVALUE
          ? String(r.FINTAGDISPLAYVALUE).split('|')[0]
          : '',
        DebitAmount: r.DebitAmount,
        CreditAmount: r.CreditAmount,
        ITEMWITHHOLDINGTAXGROUP: r.ITEMWITHHOLDINGTAXGROUP,
        TAXGROUP: r.TAXGROUP,
      })}`,
    );
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
