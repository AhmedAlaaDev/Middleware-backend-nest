export enum DataBatchStatus {
  Pending = 'Pending',
  Processing = 'Processing',
  Completed = 'Completed',
  Canceled = 'Canceled',
}

export enum EntryProcessorTypes {
  AccountReceivableFreight = 1,
  AccountReceivableTrucking = 2,
  AccountReceivableFreightCreditNote = 3,
  AccountReceivableTruckingCreditNote = 4,
  LedgerFreightClosingEntry = 5,
  LedgerTruckingClosingEntry = 6,
  AccountPayableFreight = 7,
  AccountPayableTrucking = 8,
  CustodyFreight = 9,
  CustodyTrucking = 10,
  LedgerCashOut = 11,
  LedgerBankOut = 12,
  LedgerVisaOut = 13,
  LedgerCashIn = 14,
  LedgerBankIn = 15,
  LedgerVisaIn = 16,
  VendorFreight = 17,
  VendorTrucking = 18,
  VendorFreightAdjustment = 19,
  VendorTruckingAdjustment = 20,
}
