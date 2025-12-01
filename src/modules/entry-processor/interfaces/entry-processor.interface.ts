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
}

export interface RawDataModel {
  [key: string]: any;
}

export interface DynDataModel {
  lineNumber?: number;
  errorCount: number;
  dimensionModel?: any;
  sourceIds: string[];
  getErrors(): string[];
  addError(property: string, message: string): void;
  [key: string]: any;
}

export interface IEntryProcessor {
  readonly entryProcessorType: EntryProcessorTypes;
  readonly requiredDimensions: string[];

  formatAndEnrichAsync(
    data: RawDataModel[],
    company: string,
    billingClassId?: string,
  ): Promise<DynDataModel[]>;

  validateAsync(
    data: DynDataModel[],
    company: string,
    billingClassId?: string,
  ): Promise<DynDataModel[]>;

  insertIntoDynamicsAsync(data: DynDataModel[], company: string): Promise<void>;

  parseToDimensions(dimensionString: string): any;
  convertToStringDimensions(dimensionsModel: any): string;
}
