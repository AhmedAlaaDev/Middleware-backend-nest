# LedgerJournalLines POST Payload Template

## Entity: LedgerJournalLines

### 1) REQUIRED FIELDS (POST)

- **dataAreaId**: Edm.String (Nullable=false) [Part of composite key - company identifier]
- **JournalBatchNumber**: Edm.String (Nullable=false, IsRequired="true") [Part of composite key - must match existing journal header]
- **CurrencyCode**: Edm.String (IsRequired="true") [Transaction currency code, e.g., "EGP"]
- **TransDate**: Edm.DateTimeOffset (Nullable=false) [Transaction date in ISO 8601 format]
- **AccountDisplayValue**: Edm.String [Main account dimension display value - required for posting]
- **AccountType**: Microsoft.Dynamics.DataEntities.LedgerJournalACType [Account type enum - typically "Ledger", "Vend", "Cust", etc.]
- **DebitAmount** OR **CreditAmount**: Edm.Decimal (Nullable=false) [At least one must be provided and non-zero. Use DebitAmount for debits, CreditAmount for credits. Do NOT send both unless one is zero]

**Note on LineNumber**: This field is part of the composite key but has `AllowEditOnCreate="false"`, indicating it's server-generated. **DO NOT SEND** this field in POST requests - the system will auto-generate sequential line numbers.

### 2) OPTIONAL WRITABLE FIELDS (POST)

**Core Transaction Fields:**
- **Text**: Edm.String [Line description/notes]
- **Voucher**: Edm.String [Voucher number/identifier]
- **Document**: Edm.String [Document number]
- **DocumentDate**: Edm.DateTimeOffset (Nullable=false) [Document date - defaults to TransDate if not provided]
- **DueDate**: Edm.DateTimeOffset (Nullable=false) [Due date for payment terms]
- **Invoice**: Edm.String [Invoice number]
- **PaymentMethod**: Edm.String [Payment method code]
- **PaymentReference**: Edm.String [Payment reference]
- **PostingProfile**: Edm.String [Posting profile for account validation]

**Account & Dimension Fields:**
- **Company**: Edm.String [Company identifier - defaults to dataAreaId if not specified]
- **OffsetAccountType**: Microsoft.Dynamics.DataEntities.LedgerJournalACType [Offset account type]
- **OffsetAccountDisplayValue**: Edm.String [Offset account dimension display value]
- **OffsetCompany**: Edm.String [Offset account company]
- **OffsetText**: Edm.String [Offset account description]
- **DefaultDimensionDisplayValue**: Edm.String [Financial dimensions for main account (e.g., "Department=ADMIN;CostCenter=CC001")]
- **OffsetDefaultDimensionDisplayValue**: Edm.String [Financial dimensions for offset account]
- **FinTagDisplayValue**: Edm.String [Financial tag for main account]
- **OffsetFinTagDisplayValue**: Edm.String [Financial tag for offset account]

**Tax Fields:**
- **SalesTaxGroup**: Edm.String [Sales tax group code]
- **ItemSalesTaxGroup**: Edm.String [Item sales tax group code]
- **SalesTaxCode**: Edm.String [Sales tax code]
- **TaxExemptNumber**: Edm.String [Tax exemption number]
- **OverrideSalesTax**: Microsoft.Dynamics.DataEntities.NoYes [Override sales tax calculation]

**Exchange Rate Fields:**
- **ExchRate**: Edm.Decimal (Nullable=false) [Exchange rate - defaults to system rate if not provided]
- **ExchRateSecond**: Edm.Decimal (Nullable=false) [Secondary exchange rate]
- **ReportingCurrencyExchRate**: Edm.Decimal (Nullable=false) [Reporting currency exchange rate - typically computed]
- **ReportingCurrencyExchRateSecondary**: Edm.Decimal (Nullable=false) [Secondary reporting currency exchange rate - typically computed]

**Cash Discount Fields:**
- **CashDiscount**: Edm.String [Cash discount code]
- **CashDiscountAmount**: Edm.Decimal (Nullable=false) [Cash discount amount]
- **CashDiscountDate**: Edm.DateTimeOffset (Nullable=false) [Cash discount date]

**Other Optional Fields:**
- **ReverseEntry**: Microsoft.Dynamics.DataEntities.NoYes [Indicates if this is a reversal entry]
- **ReverseDate**: Edm.DateTimeOffset (Nullable=false) [Reversal date if ReverseEntry is set]
- **IsWithholdingCalculationEnabled**: Microsoft.Dynamics.DataEntities.NoYes [Enable withholding tax calculation]
- **ItemWithholdingTaxGroupCode**: Edm.String [Item withholding tax group - read-only, do not send]
- **Quantity**: Edm.Decimal (Nullable=false) [Quantity - typically 0 for ledger entries]
- **PaymentId**: Edm.String [Payment identifier]

**Country-Specific Fields (LTM - Latin America):**
Many fields are marked with `CountryRegionCodes` annotations for specific countries. Only include these if your system is configured for those regions:
- **ShiftID**, **WithholdingSetID**, **LTMDocumentDate**, **LedgerJournalType**, **CAICAEDueDate**, **LedgerJournalTransId**, and many others marked with country codes like "AR,BO,CL,CO,CR,DO,EC,GT,NI,PA,PE,PY,UY,VE"

**China-Specific Fields:**
- **ChineseVoucherType**: Edm.String (CountryRegionCodes="CN")
- **ChineseVoucher**: Edm.String (CountryRegionCodes="CN")

**Spain-Specific Fields:**
- **DiscountPercentage**: Edm.Decimal (Nullable=false, CountryRegionCodes="ES")

### 3) DO NOT SEND (READONLY/COMPUTED/SYSTEM)

**Key Fields (Server-Generated):**
- **LineNumber**: Edm.Decimal (Nullable=false) [AllowEditOnCreate="false" - server auto-generates sequential line numbers]

**Read-Only Fields:**
- **ItemWithholdingTaxGroupCode**: Edm.String [AllowEdit="false" - system-managed]
- **JournalNum**: Edm.String [AllowEdit="false" - read-only, country-specific]
- **LineNum**: Edm.Decimal (Nullable=false) [AllowEdit="false" - read-only, country-specific]

**Computed/System Fields:**
- **ReportingCurrencyExchRate**: Edm.Decimal (Nullable=false) [Typically computed by system]
- **ReportingCurrencyExchRateSecondary**: Edm.Decimal (Nullable=false) [Typically computed by system]
- **AmountMST**: Edm.Decimal (Nullable=false) [Computed amount in company currency]
- **AmountCUR**: Edm.Decimal (Nullable=false) [Computed amount in transaction currency]
- **LedgerJournalTransId**: Edm.Int64 (Nullable=false) [System-generated transaction ID]
- **CPDTRXHistoryID**: Edm.Int64 (Nullable=false) [System-generated ID]
- **CPDTRXOpenID**: Edm.Int64 (Nullable=false) [System-generated ID]

**Navigation Properties (DO NOT SEND):**
- **LedgerJournalLineCurrency**
- **LedgerJournalLineCompany**
- **LedgerJournalLineSalesTaxGroup**
- **LedgerJournalLineOffsetCompany**
- **LedgerJournalLineItemSalesTaxGroup**
- **LedgerJournalLineDefaultDimension**
- **LegalEntity**
- **LedgerJournalLineOffsetDefaultDimension**
- **LedgerJournalHeader**
- **LedgerJournalLineOffsetLedgerDimensionCombination**
- **LedgerJournalLineLedgerDimensionCombination**
- **VoucherType**
- **PaymentTerm**
- **AddressCountryRegion**
- **BankAccount**
- **WithholdingSet**
- **LTMDocumentClassification**
- **LTMTaxPayerType**
- **LTMBankGroup**
- **LTMSalesPoint**
- **AddressState**
- **LTMFiscalRegister**

### 4) Minimal POST Payload Template (JSON)

```json
{
  "dataAreaId": "m-p",
  "JournalBatchNumber": "GEN-001",
  "CurrencyCode": "EGP",
  "TransDate": "2025-01-26T00:00:00Z",
  "AccountType": "Ledger",
  "AccountDisplayValue": "110100",
  "DebitAmount": 1000.00
}
```

**Alternative with CreditAmount:**

```json
{
  "dataAreaId": "m-p",
  "JournalBatchNumber": "GEN-001",
  "CurrencyCode": "EGP",
  "TransDate": "2025-01-26T00:00:00Z",
  "AccountType": "Ledger",
  "AccountDisplayValue": "210100",
  "CreditAmount": 1000.00
}
```

**Note**: Do NOT include `LineNumber` - it will be auto-generated by the server.

### 5) Recommended POST Payload Template (JSON)

```json
{
  "dataAreaId": "m-p",
  "JournalBatchNumber": "GEN-001",
  "CurrencyCode": "EGP",
  "TransDate": "2025-01-26T00:00:00Z",
  "DocumentDate": "2025-01-26T00:00:00Z",
  "AccountType": "Ledger",
  "AccountDisplayValue": "110100",
  "DefaultDimensionDisplayValue": "Department=ADMIN;CostCenter=CC001",
  "Text": "Monthly closing entry - Cash account",
  "DebitAmount": 1000.00,
  "OffsetAccountType": "Ledger",
  "OffsetAccountDisplayValue": "210100",
  "OffsetDefaultDimensionDisplayValue": "Department=ADMIN;CostCenter=CC001",
  "OffsetText": "Offset account entry",
  "Voucher": "VOUCH-001",
  "Document": "DOC-2025-001",
  "PostingProfile": "GEN"
}
```

**With Additional Optional Fields:**

```json
{
  "dataAreaId": "m-p",
  "JournalBatchNumber": "GEN-001",
  "CurrencyCode": "EGP",
  "TransDate": "2025-01-26T00:00:00Z",
  "DocumentDate": "2025-01-26T00:00:00Z",
  "DueDate": "2025-02-26T00:00:00Z",
  "AccountType": "Ledger",
  "AccountDisplayValue": "110100",
  "DefaultDimensionDisplayValue": "Department=ADMIN;CostCenter=CC001",
  "Text": "Monthly closing entry - Cash account",
  "DebitAmount": 1000.00,
  "OffsetAccountType": "Ledger",
  "OffsetAccountDisplayValue": "210100",
  "OffsetDefaultDimensionDisplayValue": "Department=ADMIN;CostCenter=CC001",
  "OffsetText": "Offset account entry",
  "Voucher": "VOUCH-001",
  "Document": "DOC-2025-001",
  "Invoice": "INV-2025-001",
  "PostingProfile": "GEN",
  "PaymentMethod": "CHECK",
  "SalesTaxGroup": "STG-001",
  "ItemSalesTaxGroup": "ISTG-001",
  "ExchRate": 1.0
}
```

### Important Notes:

1. **LineNumber**: **DO NOT SEND** - This is auto-generated by the server. Including it will cause an error.

2. **JournalBatchNumber**: Must reference an existing journal header that was created first. The header must exist before creating lines.

3. **DebitAmount vs CreditAmount**: 
   - Use **DebitAmount** for debit entries (assets, expenses)
   - Use **CreditAmount** for credit entries (liabilities, equity, revenue)
   - **Do NOT send both** unless one is explicitly 0
   - At least one must be non-zero

4. **AccountDisplayValue**: This is the main account identifier. Format depends on account structure:
   - For Ledger accounts: Usually the main account number (e.g., "110100")
   - For Vendor accounts: Vendor account number
   - For Customer accounts: Customer account number
   - May include dimensions in the display value format

5. **DefaultDimensionDisplayValue**: Financial dimensions format is typically:
   - `"Dimension1=Value1;Dimension2=Value2"`
   - Example: `"Department=ADMIN;CostCenter=CC001;Project=PRJ001"`

6. **CurrencyCode**: Must be a valid currency code configured in the system (e.g., "EGP", "USD", "EUR").

7. **TransDate**: Use ISO 8601 format: `"YYYY-MM-DDTHH:mm:ssZ"` or `"YYYY-MM-DD"` for date-only.

8. **Exchange Rates**: If `ExchRate` is not provided, the system will use the default exchange rate for the currency on the transaction date.

9. **Country-Specific Fields**: Many fields are marked for specific countries (LTM for Latin America, CN for China, ES for Spain). Only include these if your system is configured for those regions.

10. **Navigation Properties**: Never include navigation properties in POST requests. They are read-only relationships.

11. **Creating Balanced Entries**: For a balanced journal entry, you typically need:
    - At least 2 lines (one debit, one credit)
    - Total debits = Total credits
    - All lines must reference the same `JournalBatchNumber`

12. **AccountType Values**: Common enum values:
    - `"Ledger"` - General ledger account
    - `"Vend"` - Vendor account
    - `"Cust"` - Customer account
    - `"Bank"` - Bank account
    - `"FixedAssets"` - Fixed asset account
    - `"Project"` - Project account
