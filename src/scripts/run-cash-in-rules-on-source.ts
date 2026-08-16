/**
 * Local dry-run of cash-in customer-FX + UniqueId/money-type balance rules
 * against an exported source-records Excel.
 */
import * as path from 'path';
import ExcelJS from 'exceljs';

import { CashEntryRawDataModel } from '../modules/cash/models/cash-entry-raw-data.model';
import {
  evaluateCashInCustomerFxGroup,
  isCashInSpecialCustomerFxCase,
} from '../modules/cash/processors/cash-in-customer-fx.rules';

const SOURCE =
  process.argv[2] ||
  String.raw`c:\Users\AhmedAlaa\Downloads\source-records-6a81c42c72d266828415fb9e (1).xlsx`;

function cellValue(value: unknown): unknown {
  if (value && typeof value === 'object' && 'text' in (value as object)) {
    return (value as { text: string }).text;
  }
  if (value && typeof value === 'object' && 'result' in (value as object)) {
    return (value as { result: unknown }).result;
  }
  return value;
}

function fxMultiplier(currency: string, exchangeRate: unknown): number {
  const code = String(currency ?? '')
    .trim()
    .toUpperCase();
  if (!code || code === 'EGP') return 1;
  let rate = Number(exchangeRate) || 0;
  if (rate >= 1000) rate = rate / 100;
  else if (rate > 0 && rate < 0.1) rate = rate * 100;
  else if (rate >= 100) rate = rate / 100;
  return rate > 0 ? rate : 1;
}

function isBalancedByMoneyType(lines: CashEntryRawDataModel[]): {
  balanced: boolean;
  moneyType: string;
  debit: number;
  credit: number;
}[] {
  const byType = new Map<string, CashEntryRawDataModel[]>();
  for (const line of lines) {
    const moneyType = String(line.VoucherType ?? '')
      .trim()
      .toLowerCase() || 'unknown';
    const group = byType.get(moneyType);
    if (group) group.push(line);
    else byType.set(moneyType, [line]);
  }

  return [...byType.entries()].map(([moneyType, group]) => {
    let debit = 0;
    let credit = 0;
    for (const line of group) {
      const fx = fxMultiplier(line.CURRENCYCODE, line.EXCHANGERATE);
      debit += Number(line.DEBITAMOUNT || 0) * fx;
      credit += Number(line.CREDITAMOUNT || 0) * fx;
    }
    return {
      moneyType,
      debit,
      credit,
      balanced: Math.abs(debit - credit) <= 0.05,
    };
  });
}

async function loadRows(filePath: string): Promise<Record<string, unknown>[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.worksheets[0];
  const headers: string[] = [];
  ws.getRow(1).eachCell((cell, col) => {
    headers[col] = String(cellValue(cell.value) ?? '').trim();
  });
  const rows: Record<string, unknown>[] = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const record: Record<string, unknown> = {};
    row.eachCell((cell, col) => {
      const key = headers[col];
      if (!key) return;
      record[key] = cellValue(cell.value);
    });
    rows.push(record);
  });
  return rows;
}

function resolveExchangeRate(
  _transactionDate: string,
  currencyCode: string,
): { exchangeRate: number; reportingRate: number } {
  const currency = String(currencyCode ?? '')
    .trim()
    .toUpperCase();
  if (!currency || currency === 'EGP') {
    return { exchangeRate: 100, reportingRate: 100 };
  }
  if (currency === 'USD') {
    return { exchangeRate: 4765, reportingRate: 100 };
  }
  if (currency === 'EUR') {
    return { exchangeRate: 5580, reportingRate: 100 };
  }
  return { exchangeRate: 100, reportingRate: 100 };
}

async function main(): Promise<void> {
  const filePath = path.resolve(SOURCE);
  console.log(`Running cash-in rules on:\n  ${filePath}\n`);

  const rawRows = await loadRows(filePath);
  const models = rawRows.map(
    (row) => new CashEntryRawDataModel(row as never, 'Freight', true),
  );

  const byUniqueId = new Map<string, CashEntryRawDataModel[]>();
  for (const line of models) {
    const id = String(line.UniqueId ?? '');
    if (!id) continue;
    const group = byUniqueId.get(id);
    if (group) group.push(line);
    else byUniqueId.set(id, [line]);
  }

  const summary = {
    uniqueIds: byUniqueId.size,
    lines: models.length,
    specialCase: 0,
    fxOk: 0,
    fxFailed: 0,
    skippedBalancedSameCurrency: 0,
    unbalancedAfterFx: 0,
  };

  const failures: string[] = [];
  const successes: string[] = [];

  for (const [uniqueId, lines] of [...byUniqueId.entries()].sort((a, b) =>
    a[0].localeCompare(b[0], undefined, { numeric: true }),
  )) {
    const beforeSpecial = isCashInSpecialCustomerFxCase(lines);
    const { result, outputLines } = evaluateCashInCustomerFxGroup({
      uniqueId,
      lines: lines.map((line) => line),
      resolveExchangeRate,
    });

    const enteredSpecial =
      beforeSpecial &&
      (result.isInvalid ||
        result.matchedPairs.length > 0 ||
        result.skippedLedgerLineIds.size > 0);

    // Same-currency balanced groups return emptyResult without entering.
    if (beforeSpecial && !enteredSpecial && !result.isInvalid) {
      summary.skippedBalancedSameCurrency += 1;
    }

    if (enteredSpecial || result.isInvalid) {
      summary.specialCase += 1;
    }

    if (result.isInvalid) {
      summary.fxFailed += 1;
      const reason =
        result.validationErrors[0]?.details?.reason ||
        result.validationErrors[0]?.message ||
        'unknown';
      failures.push(
        `FAIL FX  UniqueId ${uniqueId} (${lines[0]?.VoucherType}) — ${reason}`,
      );
      continue;
    }

    if (result.matchedPairs.length > 0) {
      summary.fxOk += 1;
      const pair = result.matchedPairs[0];
      successes.push(
        `OK   FX  UniqueId ${uniqueId}: cust L${pair.customerLineNumber} <- debit L${pair.debitLineNumber} (${pair.customerLine.CREDITAMOUNT} ${pair.customerLine.CURRENCYCODE}), skipped 421103=${result.skippedLedgerLineIds.size}, residual=${result.residualLines.length}`,
      );
      // Successful FX: do not apply unbalanced check (same as processor).
      continue;
    }

    const balances = isBalancedByMoneyType(outputLines);
    const bad = balances.filter((item) => !item.balanced);
    if (bad.length > 0) {
      summary.unbalancedAfterFx += 1;
      for (const item of bad) {
        failures.push(
          `FAIL BAL UniqueId ${uniqueId} money type ${item.moneyType}: debit=${item.debit.toFixed(2)} credit=${item.credit.toFixed(2)} diff=${(item.debit - item.credit).toFixed(2)}`,
        );
      }
    } else {
      successes.push(
        `OK   BAL UniqueId ${uniqueId} (${lines.length} lines, ${[...new Set(lines.map((l) => l.VoucherType))].join('/')})`,
      );
    }
  }

  console.log('=== SUMMARY ===');
  console.log(JSON.stringify(summary, null, 2));
  console.log('\n=== FAILURES ===');
  if (failures.length === 0) console.log('(none)');
  else console.log(failures.join('\n'));
  console.log('\n=== SUCCESSES (sample / all) ===');
  console.log(successes.join('\n'));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
