/**
 * Structured error information collected during posting process
 */
export interface PostingError {
  type: 'header' | 'line' | 'rollback';
  context: string;
  message: string;
  headerId?: string;
  lineNumber?: number;
  timestamp: Date;
}

/**
 * Service for collecting and managing errors during the DFO posting process
 * Provides structured error information for better UI display
 */
export class PostingErrorCollector {
  private readonly errors: PostingError[] = [];

  /**
   * Add an error related to header posting
   */
  public addHeaderError(
    message: string,
    context: string,
    headerId?: string,
  ): void {
    this.errors.push({
      type: 'header',
      context,
      message,
      headerId,
      timestamp: new Date(),
    });
  }

  /**
   * Add an error related to line posting
   */
  public addLineError(
    message: string,
    context: string,
    headerId?: string,
    lineNumber?: number,
  ): void {
    this.errors.push({
      type: 'line',
      context,
      message,
      headerId,
      lineNumber,
      timestamp: new Date(),
    });
  }

  /**
   * Add an error related to rollback operations
   */
  public addRollbackError(
    message: string,
    context: string,
    headerId?: string,
    lineNumber?: number,
  ): void {
    this.errors.push({
      type: 'rollback',
      context,
      message,
      headerId,
      lineNumber,
      timestamp: new Date(),
    });
  }

  /**
   * Get all collected errors
   */
  public getAllErrors(): PostingError[] {
    return [...this.errors];
  }

  /**
   * Get formatted error messages for UI display
   * Returns an array of user-friendly error strings
   */
  public getFormattedErrorMessages(): string[] {
    return this.errors.map((error) => {
      const parts: string[] = [];

      // Add context
      parts.push(`[${error.context}]`);

      // Add header/line identifier if available
      if (error.headerId) {
        if (error.lineNumber !== undefined) {
          parts.push(`Header: ${error.headerId}, Line: ${error.lineNumber}`);
        } else {
          parts.push(`Header: ${error.headerId}`);
        }
      }

      // Add error message
      parts.push(error.message);

      return parts.join(' - ');
    });
  }

  /**
   * Check if any errors have been collected
   */
  public hasErrors(): boolean {
    return this.errors.length > 0;
  }

  /**
   * Get count of errors by type
   */
  public getErrorCounts(): {
    header: number;
    line: number;
    rollback: number;
    total: number;
  } {
    return {
      header: this.errors.filter((e) => e.type === 'header').length,
      line: this.errors.filter((e) => e.type === 'line').length,
      rollback: this.errors.filter((e) => e.type === 'rollback').length,
      total: this.errors.length,
    };
  }

  /**
   * Clear all collected errors
   */
  public clear(): void {
    this.errors.length = 0;
  }
}
