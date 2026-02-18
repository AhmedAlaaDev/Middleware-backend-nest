export const ENTRY_PROCESSOR_NAMES = {
  ACCOUNT_RECEIVABLE_FREIGHT: 'AccountReceivableFreightEntryProcessor',
  ACCOUNT_RECEIVABLE_FREIGHT_CREDIT_NOTE:
    'AccountReceivableFreightCreditNoteEntryProcessor',
  ACCOUNT_RECEIVABLE_TRUCKING: 'AccountReceivableTruckingEntryProcessor',
  ACCOUNT_RECEIVABLE_TRUCKING_CREDIT_NOTE:
    'AccountReceivableTruckingCreditNoteEntryProcessor',
  VENDOR_FREIGHT: 'VendorFreightEntryProcessor',
  VENDOR_TRUCKING: 'VendorTruckingEntryProcessor',
  LEDGER_FREIGHT_CLOSING_ENTRY: 'ClosingFreightEntryProcessor',
  LEDGER_TRUCKING_CLOSING_ENTRY: 'ClosingTruckingEntryProcessor',
  LEDGER_CUSTODY_SETTLEMENT_ENTRY: 'ClosingCustodySettlementEntryProcessor',
  LEDGER_CLOSING_FREIGHT_DIFFERENCE: 'ClosingFreightDifferenceEntryProcessor',
  CASH_IN_FREIGHT: 'CashInFreightEntryProcessor',
  CASH_OUT_FREIGHT: 'CashOutFreightEntryProcessor',
} as const;
