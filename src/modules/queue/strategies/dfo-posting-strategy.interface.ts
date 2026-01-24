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
   * Prepare lines for posting by updating them with header IDs
   * @param lines Array of line requests
   * @param headerIds Array of header IDs (should match the order of headers)
   * @param groupedData Original grouped data structure
   * @returns Array of prepared line requests
   */
  prepareLinesForPosting(
    lines: unknown[],
    headerIds: string[],
    groupedData: unknown[],
  ): unknown[];
}
