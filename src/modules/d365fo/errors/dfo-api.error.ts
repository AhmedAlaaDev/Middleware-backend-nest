export interface DfoApiErrorOptions {
  message: string;
  status?: number;
  code?: string;
  method?: string;
  endpoint?: string;
  isConcurrencyConflict?: boolean;
  isDependentLinesError?: boolean;
  isResourceNotFound?: boolean;
  isValidationError?: boolean;
  responseData?: unknown;
}

interface DfoErrorResponse {
  status?: number;
  data?: unknown;
}

export class DfoApiError extends Error {
  public readonly status?: number;
  public readonly code?: string;
  public readonly method?: string;
  public readonly endpoint?: string;
  public readonly isConcurrencyConflict: boolean;
  public readonly isDependentLinesError: boolean;
  public readonly isResourceNotFound: boolean;
  public readonly isValidationError: boolean;
  public readonly response?: DfoErrorResponse;

  constructor(options: DfoApiErrorOptions) {
    super(options.message);
    this.name = DfoApiError.name;
    this.status = options.status;
    this.code = options.code;
    this.method = options.method;
    this.endpoint = options.endpoint;
    this.isConcurrencyConflict = options.isConcurrencyConflict ?? false;
    this.isDependentLinesError = options.isDependentLinesError ?? false;
    this.isResourceNotFound = options.isResourceNotFound ?? false;
    this.isValidationError = options.isValidationError ?? false;
    this.response =
      options.status === undefined && options.responseData === undefined
        ? undefined
        : { status: options.status, data: options.responseData };
  }
}

export function dfoErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isDfoDependentLinesError(error: unknown): boolean {
  return error instanceof DfoApiError && error.isDependentLinesError;
}

export function isDfoResourceNotFoundError(error: unknown): boolean {
  return error instanceof DfoApiError && error.isResourceNotFound;
}
