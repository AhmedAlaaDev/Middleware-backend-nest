#!/usr/bin/env node
/**
 * Analyze batch error Excel files to identify patterns and root causes
 * Usage: node analyze-batch-errors.mjs <path-to-batch-errors.xlsx>
 */

import ExcelJS from 'exceljs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function analyzeBatchErrors(filePath) {
  console.log(`\n🔍 Analyzing batch errors: ${filePath}\n`);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.worksheets[0];

  if (ws.rowCount < 2) {
    console.log('✅ No errors in this batch!\n');
    return { errorCount: 0, errorsByType: {} };
  }

  const errors = [];
  
  for (let rowNum = 2; rowNum <= ws.rowCount; rowNum++) {
    const row = ws.getRow(rowNum);
    const sourceId = row.getCell(1).value;
    const enhancedId = row.getCell(2).value;
    const errorMessage = row.getCell(3).value;
    const dimensionModel = row.getCell(4).value;

    if (errorMessage) {
      errors.push({
        sourceId: String(sourceId),
        enhancedId: String(enhancedId),
        errorMessage: String(errorMessage),
        dimensionModel: dimensionModel ? JSON.parse(String(dimensionModel)) : null,
      });
    }
  }

  console.log(`📊 Total errors: ${errors.length}\n`);

  // Categorize errors
  const errorsByType = {};
  const errorPatterns = [
    { name: 'CustomerDebitMatch', pattern: /CustomerDebitMatch/ },
    { name: 'UnbalancedInvoice', pattern: /UnbalancedInvoice/ },
    { name: 'PaymentMethod', pattern: /Method of payment|PAYMENTMETHOD/ },
    { name: 'ValidationError', pattern: /validateField failed/ },
    { name: 'CurrencyMismatch', pattern: /currency|Currency/ },
    { name: 'DimensionError', pattern: /dimension|Dimension/ },
    { name: 'AccountNotFound', pattern: /not found in the related table/ },
  ];

  errors.forEach(error => {
    let categorized = false;
    for (const { name, pattern } of errorPatterns) {
      if (pattern.test(error.errorMessage)) {
        if (!errorsByType[name]) {
          errorsByType[name] = [];
        }
        errorsByType[name].push(error);
        categorized = true;
      }
    }
    if (!categorized) {
      if (!errorsByType['Other']) {
        errorsByType['Other'] = [];
      }
      errorsByType['Other'].push(error);
    }
  });

  // Display summary
  console.log('📋 Error Summary by Type:\n');
  Object.entries(errorsByType).forEach(([type, typeErrors]) => {
    console.log(`  ${type}: ${typeErrors.length} occurrence(s)`);
  });
  console.log('');

  // Detail analysis for each error type
  for (const [type, typeErrors] of Object.entries(errorsByType)) {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`🔴 ${type} (${typeErrors.length} errors)`);
    console.log('='.repeat(70));

    if (type === 'CustomerDebitMatch') {
      analyzeCustomerDebitMatchErrors(typeErrors);
    } else if (type === 'UnbalancedInvoice') {
      analyzeUnbalancedInvoiceErrors(typeErrors);
    } else if (type === 'PaymentMethod') {
      analyzePaymentMethodErrors(typeErrors);
    } else {
      // Show first 3 errors of this type
      typeErrors.slice(0, 3).forEach((error, idx) => {
        console.log(`\nError ${idx + 1}:`);
        console.log(`  Source ID: ${error.sourceId}`);
        console.log(`  Message: ${error.errorMessage.substring(0, 300)}`);
      });
      if (typeErrors.length > 3) {
        console.log(`\n  ... and ${typeErrors.length - 3} more similar errors`);
      }
    }
  }

  return { errorCount: errors.length, errorsByType };
}

function analyzeCustomerDebitMatchErrors(errors) {
  console.log('\n📌 Root Cause:');
  console.log('   Multiple debit lines (Petty Cash, Bank) can match a customer credit line.');
  console.log('   The system cannot automatically determine which pairing is correct.\n');

  // Extract details from first error
  const firstError = errors[0];
  const detailsMatch = firstError.errorMessage.match(/\{.*\}/);
  if (detailsMatch) {
    try {
      const details = JSON.parse(detailsMatch[0]);
      
      console.log('Example (Source ID ' + firstError.sourceId + '):');
      console.log('  Voucher:', details.voucher);
      console.log('  Reason:', details.reason);
      console.log('');
      console.log('  Customer line:');
      console.log(`    - Line ${details.customerLineNumber}: ${details.customerAccount} ${details.customerCurrency} ${details.candidateCustomerLines?.[0]?.creditAmount} (credit)`);
      console.log('');
      console.log('  Candidate debit lines:');
      details.candidateDebitLines?.forEach(debit => {
        console.log(`    - Line ${debit.lineNumber}: ${debit.accountType} ${debit.currency} ${debit.debitAmount} (debit)`);
      });

      console.log('\n💡 Resolution Options:');
      console.log('   1. Split the transaction into separate vouchers (one customer per debit)');
      console.log('   2. Add invoice numbers to help the system match correctly');
      console.log('   3. Ensure each customer credit has only ONE matching debit in the same currency');
      console.log('   4. Use consistent currency for customer and debit lines in the same group\n');

      // Check for currency mismatches
      const customerCurrency = details.candidateCustomerLines?.[0]?.currency;
      const debitCurrencies = details.candidateDebitLines?.map(d => d.currency) || [];
      const uniqueDebitCurrencies = [...new Set(debitCurrencies)];
      
      if (uniqueDebitCurrencies.length > 1) {
        console.log('⚠️  Multiple currencies detected in debit lines:', uniqueDebitCurrencies.join(', '));
        console.log('   This increases matching ambiguity. Consider:');
        console.log('   - Using the same currency for all lines in a voucher');
        console.log('   - Or splitting into separate vouchers by currency\n');
      }

      if (customerCurrency && !debitCurrencies.includes(customerCurrency)) {
        console.log('⚠️  Customer currency (' + customerCurrency + ') does not match any debit currency');
        console.log('   FX conversion creates ambiguity when multiple debits exist\n');
      }

    } catch (e) {
      console.log('  (Unable to parse error details)');
    }
  }

  // Show unique source IDs affected
  const uniqueSourceIds = [...new Set(errors.map(e => e.sourceId))];
  console.log(`\n📝 Affected Source IDs: ${uniqueSourceIds.join(', ')}`);
}

function analyzeUnbalancedInvoiceErrors(errors) {
  console.log('\n📌 Root Cause:');
  console.log('   The transaction does not balance after currency conversions.');
  console.log('   Total debits ≠ total credits when converted to a common currency.\n');

  console.log('💡 Resolution:');
  console.log('   1. Verify exchange rates are correct');
  console.log('   2. Check if amounts were entered correctly');
  console.log('   3. Ensure the source Excel has balanced debits and credits\n');

  const uniqueSourceIds = [...new Set(errors.map(e => e.sourceId))];
  console.log(`📝 Affected Source IDs: ${uniqueSourceIds.join(', ')}`);
}

function analyzePaymentMethodErrors(errors) {
  console.log('\n📌 Root Cause:');
  console.log('   Payment method field contains invalid data (dates, unknown codes).\n');

  const firstError = errors[0];
  console.log('Example:');
  console.log('  Source ID:', firstError.sourceId);
  console.log('  Error:', firstError.errorMessage.substring(0, 300));

  console.log('\n💡 Resolution:');
  console.log('   1. Check Excel PAYMENTMETHOD column for dates or incorrect values');
  console.log('   2. Ensure payment methods match D365 master data (e.g., "51", "RCash")');
  console.log('   3. Run: node scripts/diagnose-excel-columns.mjs <excel-file>\n');
}

// Main execution
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: node analyze-batch-errors.mjs <path-to-batch-errors.xlsx>');
  process.exit(1);
}

const filePath = resolve(args[0]);
analyzeBatchErrors(filePath)
  .then(({ errorCount }) => {
    console.log('\n' + '='.repeat(70));
    console.log(`\n✅ Analysis complete. ${errorCount} error(s) found.\n`);
    process.exit(errorCount > 0 ? 1 : 0);
  })
  .catch((error) => {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  });
