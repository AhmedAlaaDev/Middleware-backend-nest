/**
 * A D365 posting outcome that must not be submitted again automatically.
 *
 * Cash custom-service calls can return deterministic business failures or an
 * ambiguous transport outcome after FO may already have committed. Retrying
 * either case risks duplicate journal lines or settlement marks.
 */
export class NonRetryableDfoPostingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = NonRetryableDfoPostingError.name;
  }
}
