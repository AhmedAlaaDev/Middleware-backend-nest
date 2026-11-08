import type { ActualJournalLine } from '@/modules/d365fo/services/cash-journal-line-identity';

/**
 * Result of posting headers
 */
export interface PostHeadersResult {
  headerIds: string[];
  responses: unknown[];
}

/**
 * Result of deleting lines
 */
export interface DeleteLinesResult {
  successful: Array<{ headerId: string; lineNumber: number }>;
  failed: Array<{ headerId: string; lineNumber: number; error: string }>;
}

/**
 * Strategy interface for posting different types of documents to D365FO
 * This allows the processor to work with different posting types (vendor journals, free text invoices, etc.)
 * while maintaining a consistent interface
 */
export interface IDfoPostingStrategy {
  /**
   * Validate a complete journal group before its D365 header is created.
   * Strategies without external preflight requirements may omit this hook.
   */
  validateLinesBeforeHeader?(
    lines: unknown[],
    dataAreaId: string,
  ): Promise<void>;

  /**
   * Post headers in batches
   * @param headers Array of header requests
   * @param chunkSize Number of headers to post per chunk
   * @returns Array of created header IDs
   */
  postHeadersInBatches(
    headers: unknown[],
    chunkSize: number,
  ): Promise<PostHeadersResult>;

  /**
   * Post lines in batches
   * @param lines Array of line requests
   * @param chunkSize Number of lines to post per chunk
   * @returns Array of successfully posted line identifiers (headerId and lineNumber)
   */
  postLinesInBatches(
    lines: unknown[],
    chunkSize: number,
  ): Promise<Array<{ headerId: string; lineNumber: number }>>;

  /**
   * Post lines for a specific header. Strategy only forwards to service; line attachment lives in D365FO service.
   * @param headerKey The header identifier (e.g. JournalBatchNumber or InvoiceIdentifier)
   * @param lines Array of line requests (without header key attached)
   * @param dataAreaId The company data area ID
   * @param chunkSize Number of lines to post per chunk (default: 20)
   */
  postLinesForHeader(
    headerKey: string,
    lines: unknown[],
    dataAreaId: string,
    chunkSize?: number,
  ): Promise<Array<{ headerId: string; lineNumber: number }>>;

  /**
   * Delete a header by its ID
   * @param headerId The header identifier
   * @param dataAreaId The company data area ID
   */
  deleteHeader(headerId: string, dataAreaId: string): Promise<void>;

  /**
   * Delete lines in batches
   * @param lines Array of line identifiers to delete
   * @param dataAreaId The company data area ID
   * @param chunkSize Number of lines to delete per chunk
   * @returns Result indicating which deletions succeeded and which failed
   */
  deleteLinesInBatches(
    lines: Array<{ headerId: string; lineNumber: number }>,
    dataAreaId: string,
    chunkSize: number,
  ): Promise<DeleteLinesResult>;

  /**
   * Extract header ID from a posting response
   * @param response The response from posting a header
   * @returns The header identifier as a string
   */
  extractHeaderIdFromResponse(response: unknown): string;

  /**
   * Query and list all lines for a specific header from D365FO
   * @param headerKey The header identifier (e.g., JournalBatchNumber)
   * @param dataAreaId The company data area ID
   * @returns Array of line objects with LineNumber
   */
  listLinesForHeader(
    headerKey: string,
    dataAreaId: string,
  ): Promise<Array<{ LineNumber: number }>>;

  /**
   * Whether the header still exists in D365FO. Used before a persisted header
   * is replaced, so a failure message can never cause a second journal for a
   * group whose first journal is still there. Strategies that cannot verify
   * this omit the method; the caller then keeps the existing header.
   */
  headerExists?(headerId: string, dataAreaId: string): Promise<boolean>;

  /**
   * Every line of a journal with the fields that identify it (all pages).
   * Optional: only the routes that verify the posted journal content
   * (Custody Settlement) implement it.
   */
  listJournalLineDetails?(
    headerKey: string,
    dataAreaId: string,
  ): Promise<ActualJournalLine[]>;
}
