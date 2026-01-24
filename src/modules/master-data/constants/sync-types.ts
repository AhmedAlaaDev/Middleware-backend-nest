export const SYNC_TYPES = {
  CUSTOMERS: 'customers',
  FINANCIAL_DIMENSIONS: 'financial-dimensions',
  BILLING_DATA: 'billing-data',
  MAIN_ACCOUNTS: 'main-accounts',
  VENDORS: 'vendors',
  EXCHANGE_RATES: 'exchange-rates',
  PAYMENT_TERMS: 'payment-terms',
  LEDGERS: 'ledgers',
} as const;

export const SYNC_TYPE_LABELS: Record<string, string> = {
  [SYNC_TYPES.CUSTOMERS]: 'Customers',
  [SYNC_TYPES.FINANCIAL_DIMENSIONS]: 'Financial Dimensions',
  [SYNC_TYPES.BILLING_DATA]: 'Billing Data',
  [SYNC_TYPES.MAIN_ACCOUNTS]: 'Main Accounts',
  [SYNC_TYPES.VENDORS]: 'Vendors',
  [SYNC_TYPES.EXCHANGE_RATES]: 'Exchange Rates',
  [SYNC_TYPES.PAYMENT_TERMS]: 'Payment Terms',
  [SYNC_TYPES.LEDGERS]: 'Ledgers',
};

export const SYNC_TYPES_LIST = Object.values(SYNC_TYPES);
