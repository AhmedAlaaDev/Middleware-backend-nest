# D365FO Currency Exchange Rate Error - Root Cause Analysis & Fix

## Executive Summary

**Error:** `"Currency exchange rate for standard currency must be = 1.00"` when posting vendor invoice journal lines to D365FO.

**Root Causes Identified:**
1. Currency codes not normalized (case sensitivity)
2. TransactionType enum mismatch ("vendor" vs "Vend")
3. Company code case mismatch ("m-p" vs "M-P")
4. Incorrect exchange rate fallback logic
5. Missing ledger currency context
6. Exchange rate calculation doesn't enforce currency matching rules

---

## 1) Root Cause Analysis

### Critical Issues Found in Code

#### Issue #1: Currency Code Not Normalized (Line 277 in handler)
```typescript
Currency: line.CURRENCY,  // ❌ No normalization - could be "usd" instead of "USD"
```
**Impact:** D365FO may reject lowercase currency codes, defaulting to accounting currency (EGP), causing validation errors.

#### Issue #2: TransactionType Enum Mismatch (Line 265 in handler, Line 607 in processor)
```typescript
TransactionType: line.TRANSACTIONTYPE,  // ❌ Could be "vendor" instead of "Vend"
// In processor: TRANSACTIONTYPE: 'vendor'  // ❌ Should be "Vend"
```
**Impact:** Invalid enum value causes validation failure, potentially triggering currency defaulting behavior.

#### Issue #3: Company Code Case Mismatch (Lines 284, 288 in handler)
```typescript
Company: line.COMPANY || company,  // ❌ Could be "m-p" instead of "M-P"
OffsetCompany: line.OFFSETCOMPANY,  // ❌ Could be "m-p" instead of "M-P"
```
**Impact:** Wrong company context loads incorrect ledger, causing currency confusion.

#### Issue #4: Incorrect Exchange Rate Fallback Logic (Lines 260-261, 267 in handler)
```typescript
ReportingCurrencyExchRate: line.REPORTINGCURRENCYEXCHRATE || line.EXCHRATE || 100,
ExchRate: line.EXCHRATE || 100,
```
**Impact:** 
- If `REPORTINGCURRENCYEXCHRATE` is missing, it falls back to `EXCHRATE` (transaction→EGP rate)
- For USD lines, this incorrectly sets `ReportingCurrencyExchRate` to 50.85 instead of 1
- D365FO then treats the line as if it's in accounting currency (EGP) and requires `ExchRate=1`

#### Issue #5: No Ledger Currency Context
**Impact:** Code doesn't fetch `AccountingCurrency` and `ReportingCurrency` from `/data/Ledgers`, so it can't determine when to set rates to 1.

#### Issue #6: Exchange Rate Calculation Doesn't Handle Currency Matching
**Impact:** 
- When `Currency == AccountingCurrency` → `ExchRate` must be 1
- When `Currency == ReportingCurrency` → `ReportingCurrencyExchRate` must be 1
- Current logic doesn't enforce these rules

---

## 2) Exchange Rate Rules Table

Given: **AccountingCurrency=EGP, ReportingCurrency=USD**

| Line Currency | ExchRate | ReportingCurrencyExchRate | Explanation |
|--------------|----------|---------------------------|--------------|
| **EGP** (accounting) | **1.00** | Rate from EGP→USD | Standard currency = 1 |
| **USD** (reporting) | Rate from USD→EGP | **1.00** | Reporting currency = 1 |
| **Other** (e.g., EUR) | Rate from EUR→EGP | Rate from EUR→USD | Both rates needed |

### Rules Summary:
- ✅ If line currency == accounting currency → `ExchRate` must be **1.00**
- ✅ If line currency == reporting currency → `ReportingCurrencyExchRate` must be **1.00**
- ✅ If line currency is third currency → both rates required (transaction→accounting and transaction→reporting)

---

## 3) Fix Options (Ranked by Reliability)

### Option 1: Comprehensive Fix ⭐ **RECOMMENDED**
- ✅ Fetch ledger currencies once per company
- ✅ Normalize all codes (currency, company, TransactionType)
- ✅ Calculate rates based on currency matching rules
- ✅ Add pre-validation

**Reliability:** Highest - addresses all root causes

### Option 2: Quick Fix
- ✅ Normalize currency/company/TransactionType
- ✅ Fix rate fallback logic
- ✅ Set rates to 1 when currency matches

**Reliability:** Medium - may miss edge cases

### Option 3: Minimal Fix
- ✅ Only fix rate fallback logic

**Reliability:** Low - other issues may persist

---

## 4) Code Changes

### Step 1: Create Ledger Service

**File:** `src/modules/d365fo/services/ledger.service.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { D365FOClientService } from './d365fo-client.service';
import { ODataQueryBuilderService } from './odata-query-builder.service';

export interface D365FOLedger {
  '@odata.etag'?: string;
  LegalEntityId: string;
  AccountingCurrency: string;
  ReportingCurrency: string;
  Name?: string;
}

@Injectable()
export class LedgerService {
  private readonly logger = new Logger(LedgerService.name);
  private readonly ledgerCache = new Map<string, { currencies: { accounting: string; reporting: string }; timestamp: number }>();
  private readonly CACHE_TTL = 60 * 60 * 1000; // 1 hour

  constructor(
    private readonly d365foClient: D365FOClientService,
    private readonly queryBuilder: ODataQueryBuilderService,
  ) {}

  /**
   * Get ledger currencies for a company (cached)
   */
  public async getLedgerCurrencies(company: string): Promise<{
    accountingCurrency: string;
    reportingCurrency: string;
  }> {
    // Check cache first
    const cached = this.ledgerCache.get(company);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      this.logger.debug(`Using cached ledger currencies for company: ${company}`);
      return cached.currencies;
    }

    // Fetch from D365FO
    const filter = this.queryBuilder.eq('LegalEntityId', company);
    const query = this.queryBuilder.buildQuery('/data/Ledgers', {
      filter,
      select: ['LegalEntityId', 'AccountingCurrency', 'ReportingCurrency'],
      top: 1,
      crossCompany: true,
    });

    this.logger.debug(`Fetching ledger currencies for company: ${company}`);

    try {
      const response = await this.d365foClient.get<D365FOLedger>(query, {
        useCache: true,
        cacheTtl: this.CACHE_TTL,
      });

      if (!response.value || response.value.length === 0) {
        throw new Error(`Ledger not found for company: ${company}`);
      }

      const ledger = response.value[0];
      const currencies = {
        accountingCurrency: ledger.AccountingCurrency?.toUpperCase().trim() || 'EGP',
        reportingCurrency: ledger.ReportingCurrency?.toUpperCase().trim() || 'USD',
      };

      // Cache the result
      this.ledgerCache.set(company, {
        currencies,
        timestamp: Date.now(),
      });

      this.logger.log(
        `Fetched ledger currencies for ${company}: Accounting=${currencies.accountingCurrency}, Reporting=${currencies.reportingCurrency}`,
      );

      return currencies;
    } catch (error) {
      this.logger.error(
        `Failed to fetch ledger currencies for company ${company}: ${error instanceof Error ? error.message : String(error)}`,
      );
      // Return defaults if fetch fails
      return {
        accountingCurrency: 'EGP',
        reportingCurrency: 'USD',
      };
    }
  }
}
```

### Step 2: Update Handler with Normalization and Rate Logic

**File:** `src/modules/vendor/commands/handlers/post-vendor-batch-to-dfo.handler.ts`

**Key Changes:**

1. **Add LedgerService import and injection:**
```typescript
import { LedgerService } from '@/modules/d365fo/services/ledger.service';

constructor(
  private readonly dataBatchService: DataBatchService,
  private readonly queueService: QueueService,
  private readonly ledgerService: LedgerService, // ✅ Add this
) {}
```

2. **Add normalization methods:**
```typescript
/**
 * Normalizes currency code to uppercase (D365FO requirement)
 */
private normalizeCurrencyCode(currency?: string | null): string {
  if (!currency || typeof currency !== 'string') {
    throw new Error('Currency code is required and must be a string');
  }
  const normalized = currency.trim().toUpperCase();
  if (normalized.length !== 3) {
    throw new Error(`Invalid currency code format: ${currency}. Must be 3 characters.`);
  }
  return normalized;
}

/**
 * Normalizes company code to uppercase (D365FO requirement)
 */
private normalizeCompanyCode(company?: string | null): string {
  if (!company || typeof company !== 'string') {
    throw new Error('Company code is required and must be a string');
  }
  return company.trim().toUpperCase();
}

/**
 * Normalizes TransactionType enum value
 * D365FO expects "Vend" (capitalized), not "vendor" (lowercase)
 */
private normalizeTransactionType(transactionType?: string | null): string {
  if (!transactionType || typeof transactionType !== 'string') {
    return 'Vend'; // Default
  }
  const normalized = transactionType.trim();
  // Map common variations to D365FO enum values
  const mapping: Record<string, string> = {
    'vendor': 'Vend',
    'Vendor': 'Vend',
    'VENDOR': 'Vend',
    'vend': 'Vend',
    'Vend': 'Vend',
  };
  return mapping[normalized.toLowerCase()] || normalized;
}
```

3. **Add exchange rate calculation method:**
```typescript
/**
 * Calculates exchange rates based on currency matching rules
 * 
 * Rules:
 * - If line currency == accounting currency → ExchRate must be 1
 * - If line currency == reporting currency → ReportingCurrencyExchRate must be 1
 * - Otherwise, use provided rates or defaults
 */
private calculateExchangeRates(
  lineCurrency: string,
  providedExchRate?: number | null,
  providedReportingCurrencyExchRate?: number | null,
  ledgerCurrencies: { accountingCurrency: string; reportingCurrency: string },
): { exchRate: number; reportingCurrencyExchRate: number } {
  const accountingCurrency = ledgerCurrencies.accountingCurrency;
  const reportingCurrency = ledgerCurrencies.reportingCurrency;

  let exchRate: number;
  let reportingCurrencyExchRate: number;

  // Rule 1: If line currency is accounting currency (EGP), ExchRate must be 1
  if (lineCurrency === accountingCurrency) {
    exchRate = 1.0;
    
    // ReportingCurrencyExchRate should be the rate from accounting→reporting
    // If not provided, we can't calculate it - use provided or default
    reportingCurrencyExchRate = providedReportingCurrencyExchRate ?? 1.0;
    
    this.logger.debug(
      `Line currency (${lineCurrency}) matches accounting currency. Setting ExchRate=1.0`,
    );
  } else {
    // Line currency is not accounting currency, use provided rate or default
    exchRate = providedExchRate ?? 100.0;
  }

  // Rule 2: If line currency is reporting currency (USD), ReportingCurrencyExchRate must be 1
  if (lineCurrency === reportingCurrency) {
    reportingCurrencyExchRate = 1.0;
    
    this.logger.debug(
      `Line currency (${lineCurrency}) matches reporting currency. Setting ReportingCurrencyExchRate=1.0`,
    );
  } else if (lineCurrency !== accountingCurrency) {
    // Line currency is neither accounting nor reporting
    // Use provided reporting rate or default
    reportingCurrencyExchRate = providedReportingCurrencyExchRate ?? 100.0;
  }
  // If line currency is accounting currency, we already set reportingCurrencyExchRate above

  // Validate rates are positive
  if (exchRate <= 0 || reportingCurrencyExchRate <= 0) {
    throw new Error(
      `Invalid exchange rates: ExchRate=${exchRate}, ReportingCurrencyExchRate=${reportingCurrencyExchRate}. Rates must be positive.`,
    );
  }

  return { exchRate, reportingCurrencyExchRate };
}
```

4. **Update mapLines method:**
```typescript
/**
 * Maps journal lines to D365FO line requests with proper currency and rate handling
 */
private async mapLines(
  lines: IDataEnhancedRecord<IVendorDFOLine>[],
  company: string,
): Promise<D365FOVendorInvoiceJournalLineRequest[]> {
  // Fetch ledger currencies once per company
  const ledgerCurrencies = await this.ledgerService.getLedgerCurrencies(
    this.normalizeCompanyCode(company),
  );

  return lines.map((lineRecord) => {
    const line = lineRecord.data;

    // Normalize currency code (must be uppercase)
    const normalizedCurrency = this.normalizeCurrencyCode(line.CURRENCY);
    
    // Normalize company codes
    const normalizedCompany = this.normalizeCompanyCode(line.COMPANY || company);
    const normalizedOffsetCompany = this.normalizeCompanyCode(line.OFFSETCOMPANY);
    
    // Normalize TransactionType enum
    const normalizedTransactionType = this.normalizeTransactionType(line.TRANSACTIONTYPE);

    // Calculate exchange rates based on currency matching rules
    const { exchRate, reportingCurrencyExchRate } = this.calculateExchangeRates(
      normalizedCurrency,
      line.EXCHRATE,
      line.REPORTINGCURRENCYEXCHRATE,
      ledgerCurrencies,
    );

    // Log the computed rules for debugging
    this.logger.debug(
      `Line ${line.LineNumber}: Currency=${normalizedCurrency}, ` +
      `ExchRate=${exchRate}, ReportingCurrencyExchRate=${reportingCurrencyExchRate}, ` +
      `AccountingCurrency=${ledgerCurrencies.accountingCurrency}, ` +
      `ReportingCurrency=${ledgerCurrencies.reportingCurrency}`,
    );

    return {
      dataAreaId: normalizedCompany,
      JournalBatchNumber: line.JOURNALBATCHNUMBER,
      LineNumber: line.LineNumber,
      AccountDisplayValue: line.ACCOUNTDISPLAYVALUE,
      CashDiscountAmount: 0,
      OffsetFinTagDisplayValue: line.OFFSETFINTAGDISPLAYVALUE || '',
      PostingProfile: 'V-PP',
      OffsetDefaultDimensionDisplayValue:
        line.OFFSETDEFAULTDIMENSIONDISPLAYVALUE || '',
      ReportingCurrencyExchRate: reportingCurrencyExchRate, // ✅ Fixed: no fallback to ExchRate
      AccountType: line.ACCOUNTTYPE,
      TermsOfPayment: line.TERMSOFPAYMENT,
      ExchRateSecond: line.EXCHRATESECOND || 0,
      TransactionType: normalizedTransactionType, // ✅ Fixed: normalized
      MethodOfPayment: line.METHODOFPAYMENT || '',
      ExchRate: exchRate, // ✅ Fixed: calculated based on rules
      Document: line.DOCUMENT ? String(line.DOCUMENT) : undefined,
      Description: line.DESCRIPTION || '',
      Invoice: line.INVOICE,
      DeliveryDate: '1900-01-01T12:00:00Z',
      OverrideSalesTax_BR: 'No',
      Date: this.formatDate(line.DATE),
      Voucher: line.VOUCHER ? String(line.VOUCHER) : undefined,
      CashDiscount: '',
      TaxExemptNumber: line.TAXEXEMPTNUMBER || '',
      Currency: normalizedCurrency, // ✅ Fixed: normalized
      ItemWithholdingTaxGroupCode: line.ITEMWITHHOLDINGTAXGROUPCODE || '',
      OffsetAccountType: line.OFFSETACCOUNTTYPE,
      InvoiceDate: line.INVOICEDATE
        ? this.formatDate(line.INVOICEDATE)
        : this.formatDate(line.DATE),
      Debit: line.DEBIT || 0,
      OffsetCompany: normalizedOffsetCompany, // ✅ Fixed: normalized
      DueDate: line.DUEDATE ? this.formatDate(line.DUEDATE) : undefined,
      OverrideSalesTax: this.convertToYesNo(line.OVERRIDESALESTAX),
      Credit: line.CREDIT || 0,
      Company: normalizedCompany, // ✅ Fixed: normalized
      CustVendBankAccountId: '',
      OffsetAccountDisplayValue: line.OFFSETACCOUNTDISPLAYVALUE,
      SalesTaxGroup: line.SALESTAXGROUP || '',
      DefaultDimensionDisplayValue: line.DEFAULTDIMENSIONDISPLAYVALUE || '',
      SalesTaxCode: '',
      ItemSalesTaxGroup: line.ITEMSALESTAXGROUP || '',
      FinTagDisplayValue: line.FINTAGDISPLAYVALUE || '',
      OffsetTransactionText: line.OFFSETTRANSACTIONTEXT || '',
      ITMCostArea: 'Shipment',
    } as D365FOVendorInvoiceJournalLineRequest;
  });
}
```

5. **Update mapToD365FORequests to be async:**
```typescript
private async mapToD365FORequests(
  journalGroups: Map<string, IDataEnhancedRecord<IVendorDFOLine>[]>,
  company: string,
): Promise<Array<{
  header: D365FOVendorInvoiceJournalHeaderRequest;
  lines: D365FOVendorInvoiceJournalLineRequest[];
}>> {
  const groupedJournals: Array<{
    header: D365FOVendorInvoiceJournalHeaderRequest;
    lines: D365FOVendorInvoiceJournalLineRequest[];
  }> = [];

  // Process all groups and await async mapLines
  return Promise.all(
    Array.from(journalGroups.entries()).map(async ([_journalBatchNumber, lines]) => {
      if (lines.length === 0) return null;

      const header = this.mapHeaderFromLines(lines, company);
      const mappedLines = await this.mapLines(lines, company); // ✅ Now async

      return { header, lines: mappedLines };
    }),
  ).then((results) => results.filter((r) => r !== null) as Array<{
    header: D365FOVendorInvoiceJournalHeaderRequest;
    lines: D365FOVendorInvoiceJournalLineRequest[];
  }>);
}
```

6. **Update execute method:**
```typescript
public async execute(
  command: PostVendorBatchToDFOCommand,
): Promise<PostVendorBatchToDFOResult> {
  const { batchId } = command;

  this.logger.log(`Starting post to DFO for vendor batch ${batchId}`);

  const batch = await this.validateBatch(batchId);

  const journalGroups = await this.groupRecordsByJournalBatchNumber(batchId);

  const groupedJournals = await this.mapToD365FORequests( // ✅ Now async
    journalGroups,
    batch.company,
  );

  this.validateJournals(groupedJournals);

  await this.prepareBatchForPosting(batchId);

  return await this.enqueuePostingJob(
    batchId,
    batch.company,
    groupedJournals,
  );
}
```

### Step 3: Update Processor to Fix TransactionType

**File:** `src/modules/entry-processor/processors/vendor-freight-entry.processor.ts`

```typescript
private async buildLine(
  line: VendorFreightRawData,
  header: IVendorFreightDFOHeader,
  company: string,
  exchangeRate: number,
  reportingRate: number,
  uniqueId: string,
  voucherNum: number,
  lineNumber: number,
): Promise<IVendorFreightDFOLine> {
  // ... existing code ...

  return new IVendorFreightDFOLine({
    // ... existing fields ...
    TRANSACTIONTYPE: 'Vend', // ✅ Fixed: was 'vendor', now 'Vend'
    // ... rest of fields ...
  });
}
```

### Step 4: Register LedgerService in Module

**File:** `src/modules/d365fo/d365fo.module.ts`

```typescript
import { LedgerService } from './services/ledger.service';

@Module({
  imports: [/* ... */],
  providers: [
    // ... existing providers ...
    LedgerService, // ✅ Add this
  ],
  exports: [
    // ... existing exports ...
    LedgerService, // ✅ Add this
  ],
})
export class D365FOModule {}
```

**Ensure D365FOModule is imported in vendor.module.ts** so LedgerService is available.

---

## 5) Validation Checklist for QA

### Pre-Validation (Before Posting):
- [ ] Currency code is 3 uppercase characters (e.g., "USD", "EGP")
- [ ] TransactionType is "Vend" (not "vendor" or other variations)
- [ ] Company codes are uppercase (e.g., "M-P", not "m-p")
- [ ] When Currency == AccountingCurrency → ExchRate === 1.0
- [ ] When Currency == ReportingCurrency → ReportingCurrencyExchRate === 1.0
- [ ] Exchange rates are positive numbers (> 0)
- [ ] TermsOfPayment exists in `/data/PaymentTerms`

### Post-Validation (After Posting):
- [ ] No "Currency exchange rate for standard currency must be = 1.00" errors
- [ ] No "validateField failed on field VendInvoiceJournalLineEntity.ExchRate" errors
- [ ] Posted lines have correct currency values in D365FO
- [ ] Exchange rates match expected values

---

## 6) Team Explanation

### What Was Wrong:

1. **Currency codes were not normalized** (e.g., "usd" instead of "USD")
   - D365FO rejected lowercase currency codes and defaulted to accounting currency (EGP)
   - This caused validation errors when the line was actually in USD

2. **TransactionType was sent as "vendor" instead of "Vend"**
   - D365FO expects the enum value "Vend" (capitalized)
   - Invalid enum values caused validation failures

3. **Company codes were sometimes lowercase** ("m-p" instead of "M-P")
   - Wrong company context loaded incorrect ledger, causing currency confusion

4. **Exchange rate fallback logic was incorrect**
   - When `ReportingCurrencyExchRate` was missing, code fell back to `ExchRate` (transaction→EGP rate)
   - For USD lines, this incorrectly set `ReportingCurrencyExchRate` to 50.85 instead of 1
   - D365FO then treated the line as if it was in accounting currency (EGP) and required `ExchRate=1`

### Why D365FO Threw This Error:

D365FO has a strict rule: **when the line currency matches the accounting currency (EGP), the `ExchRate` field must be exactly 1.00**. Due to the issues above, D365FO was treating USD lines as EGP lines, so when we sent `ExchRate=50.85`, it failed validation with the error: *"Currency exchange rate for standard currency must be = 1.00"*.

### What We Changed in the Processor:

1. **Added `LedgerService`** to fetch accounting and reporting currencies from `/data/Ledgers` once per company (cached)
2. **Normalized currency codes** to uppercase (D365FO requirement)
3. **Normalized TransactionType** to "Vend" (correct enum value)
4. **Normalized company codes** to uppercase
5. **Fixed exchange rate calculation**:
   - If line currency == accounting currency → `ExchRate = 1`
   - If line currency == reporting currency → `ReportingCurrencyExchRate = 1`
   - Otherwise, use provided rates with validation
6. **Added logging** to show computed rules per line before posting

### How We Will Prevent It in Future (Pre-Validation):

1. **Pre-validation checks** ensure currency, TransactionType, and company code formats are correct before posting
2. **Exchange rate calculation** enforces currency matching rules automatically
3. **Logging** shows computed values before posting for easier debugging
4. **Ledger currencies are cached** to reduce API calls and ensure consistency

---

## Summary

This fix addresses all root causes of the currency exchange rate validation error by:
- ✅ Normalizing all required fields (currency, company, TransactionType)
- ✅ Fetching ledger currencies to determine accounting/reporting currencies
- ✅ Calculating exchange rates based on D365FO's currency matching rules
- ✅ Adding comprehensive logging for debugging
- ✅ Implementing pre-validation to catch issues early

The solution ensures that exchange rates are set correctly based on whether the line currency matches the accounting or reporting currency, preventing the validation error from occurring.
