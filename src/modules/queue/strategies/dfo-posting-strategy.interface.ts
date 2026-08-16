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

export interface DfoHeaderIdentity {
  JournalBatchNumber: string;
  Description?: string;
}

/**
 * Strategy interface for posting different types of documents to D365FO
 * This allows the processor to work with different posting types (vendor journals, free text invoices, etc.)
 * while maintaining a consistent interface
 */
export interface IDfoPostingStrategy {
  /**
   * Load the authoritative header identity from D365FO. The description carries
   * the middleware integration marker used to reject a reused journal number.
   */
  getHeaderIdentity?(
    headerKey: string,
    dataAreaId: string,
  ): Promise<DfoHeaderIdentity | null>;

  /**
   * Find headers stamped with one middleware integration marker. A marker is
   * the durable idempotency key for one upload journal group.
   */
  findHeadersByIntegrationMarker?(
    integrationMarker: string,
    dataAreaId: string,
  ): Promise<string[]>;

  /**
   * Verify that a journal header still exists in D365FO. Cash posting uses
   * this authoritative read-back before it resumes or completes a journal.
   */
  headerExists?(headerKey: string, dataAreaId: string): Promise<boolean>;

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
}
