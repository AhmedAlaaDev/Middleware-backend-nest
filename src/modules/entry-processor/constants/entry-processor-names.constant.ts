export const ENTRY_PROCESSOR_NAMES = {
  ACCOUNT_RECEIVABLE_FREIGHT: 'AccountReceivableFreightEntryProcessor',
  ACCOUNT_RECEIVABLE_FREIGHT_CREDIT_NOTE:
    'AccountReceivableFreightCreditNoteEntryProcessor',
  ACCOUNT_RECEIVABLE_TRUCKING: 'AccountReceivableTruckingEntryProcessor',
  ACCOUNT_RECEIVABLE_TRUCKING_CREDIT_NOTE:
    'AccountReceivableTruckingCreditNoteEntryProcessor',
  ACCOUNT_RECEIVABLE_YARD: 'AccountReceivableYardEntryProcessor',
  ACCOUNT_RECEIVABLE_SHIPPING_LINES:
    'AccountReceivableShippingLinesEntryProcessor',
  VENDOR_FREIGHT: 'VendorFreightEntryProcessor',
  VENDOR_TRUCKING: 'VendorTruckingEntryProcessor',
  VENDOR_PAYMENT_FREIGHT: 'VendorPaymentFreightEntryProcessor',
  VENDOR_PAYMENT_TRUCKING: 'VendorPaymentTruckingEntryProcessor',
  LEDGER_FREIGHT_CLOSING_ENTRY: 'ClosingFreightEntryProcessor',
  LEDGER_TRUCKING_CLOSING_ENTRY: 'ClosingTruckingEntryProcessor',
  LEDGER_CUSTODY_SETTLEMENT_ENTRY: 'ClosingCustodySettlementEntryProcessor',
  LEDGER_CLOSING_FREIGHT_DIFFERENCE: 'ClosingFreightDifferenceEntryProcessor',
  CASH_IN_FREIGHT: 'CashInFreightEntryProcessor',
  CASH_OUT_FREIGHT: 'CashOutFreightEntryProcessor',
  CASH_IN_TRUCKING: 'CashInTruckingEntryProcessor',
  CASH_OUT_TRUCKING: 'CashOutTruckingEntryProcessor',
} as const;
