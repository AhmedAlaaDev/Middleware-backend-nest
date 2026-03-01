import {
  D365FOVendorInvoiceJournalHeaderRequest,
  D365FOVendorInvoiceJournalLineRequest,
  D365FOVendorPaymentJournalHeaderRequest,
  D365FOVendorPaymentJournalLineRequest,
} from '@/modules/d365fo/types';

export interface PostVendorJournalDFOJobPayload {
  batchId: string;
  company: string;
  journalKind?: 'invoice' | 'payment';
  groupedJournals?: Array<{
    header: D365FOVendorInvoiceJournalHeaderRequest;
    lines: D365FOVendorInvoiceJournalLineRequest[];
  }>;
  paymentGroupedJournals?: Array<{
    header: D365FOVendorPaymentJournalHeaderRequest;
    lines: D365FOVendorPaymentJournalLineRequest[];
  }>;
  correlationId?: string;
  sourceModule?: 'VENDOR';
}
