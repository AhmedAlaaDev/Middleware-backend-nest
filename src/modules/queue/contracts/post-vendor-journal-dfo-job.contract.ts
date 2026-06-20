import {
  D365FOVendorInvoiceJournalHeaderRequest,
  D365FOVendorInvoiceJournalLineRequest,
  D365FOVendorPaymentJournalHeaderRequest,
  D365FOVendorPaymentJournalLineRequest,
} from '@/modules/d365fo/types';
import { DurablePostingJobPayload } from '@/modules/queue/contracts/durable-posting-job.contract';

export type VendorJournalPostingGroup =
  | {
      header: D365FOVendorInvoiceJournalHeaderRequest;
      lines: D365FOVendorInvoiceJournalLineRequest[];
    }
  | {
      header: D365FOVendorPaymentJournalHeaderRequest;
      lines: D365FOVendorPaymentJournalLineRequest[];
    };

export type PostVendorJournalDFOJobPayload = DurablePostingJobPayload;
