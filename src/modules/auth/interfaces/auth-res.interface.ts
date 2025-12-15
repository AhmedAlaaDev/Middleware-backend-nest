export class AuthResponse {
  /**
   * Access token used to authenticate the user
   * @example eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ...
   */
  accessToken: string;

  /**
   * Refresh token used to obtain new access tokens
   * @example eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwianRpIjoiYWJjZGVmIiwiaWF0IjoxNTE2MjM5MDIyfQ...
   */
  refreshToken: string;

  /**
   * Expiration date of the access token in ISO 8601 format
   * @example 2023-12-31T23:59:59.999Z
   */
  accessTokenExpiresAt: string;

  /**
   * Expiration date of the refresh token in ISO 8601 format
   * @example 2024-01-31T23:59:59.999Z
   */
  refreshTokenExpiresAt: string;
}
