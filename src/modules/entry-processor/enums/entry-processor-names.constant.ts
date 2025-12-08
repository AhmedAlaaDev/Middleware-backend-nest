export const ENTRY_PROCESSOR_NAMES = {
  ACCOUNT_RECEIVABLE_FREIGHT: 'AccountReceivableFreightEntryProcessor',
  ACCOUNT_RECEIVABLE_FREIGHT_CREDIT_NOTE:
    'AccountReceivableFreightCreditNoteEntryProcessor',
  ACCOUNT_RECEIVABLE_TRUCKING: 'AccountReceivableTruckingEntryProcessor',
  ACCOUNT_RECEIVABLE_TRUCKING_CREDIT_NOTE:
    'AccountReceivableTruckingCreditNoteEntryProcessor',
  VENDOR_FREIGHT: 'VendorFreightEntryProcessor',
  VENDOR_TRUCKING: 'VendorTruckingEntryProcessor',
  VENDOR_FREIGHT_ADJUSTMENT: 'VendorFreightAdjustmentEntryProcessor',
  VENDOR_TRUCKING_ADJUSTMENT: 'VendorTruckingAdjustmentEntryProcessor',
  LEDGER_FREIGHT_CLOSING_ENTRY: 'FreightClosingEntryProcessor',
  LEDGER_TRUCKING_CLOSING_ENTRY: 'TruckingClosingEntryProcessor',
} as const;
