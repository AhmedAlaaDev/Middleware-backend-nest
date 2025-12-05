export enum DataBatchStatus {
  Pending = 'Pending',
  Processing = 'Processing',
  Completed = 'Completed',
  Canceled = 'Canceled',
}

export enum EntryProcessorTypes {
  AccountReceivableFreight = 'AccountReceivableFreight',
  AccountReceivableTrucking = 'AccountReceivableTrucking',
  AccountReceivableFreightCreditNote = 'AccountReceivableFreightCreditNote',
  AccountReceivableTruckingCreditNote = 'AccountReceivableTruckingCreditNote',
  LedgerFreightClosingEntry = 'LedgerFreightClosingEntry',
  LedgerTruckingClosingEntry = 'LedgerTruckingClosingEntry',
  AccountPayableFreight = 'AccountPayableFreight',
  AccountPayableTrucking = 'AccountPayableTrucking',
  CustodyFreight = 'CustodyFreight',
  CustodyTrucking = 'CustodyTrucking',
  LedgerCashOut = 'LedgerCashOut',
  LedgerBankOut = 'LedgerBankOut',
  LedgerVisaOut = 'LedgerVisaOut',
  LedgerCashIn = 'LedgerCashIn',
  LedgerBankIn = 'LedgerBankIn',
  LedgerVisaIn = 'LedgerVisaIn',
}
