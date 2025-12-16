export interface RefreshData {
  accessToken: string;
  refreshToken: string;
  atExpiresAt: string;
  rtExpiresAt: string;
  familyId: string;
}

export type RefreshErrorCode =
  | 'INVALID_TYPE'
  | 'NOT_FOUND_REUSE_DETECTED'
  | 'EXPIRED_OR_REVOKED'
  | 'HASH_MISMATCH'
  | 'USER_NOT_FOUND';

export type RefreshResult =
  | {
      ok: true;
      data: RefreshData;
    }
  | { ok: false; code: RefreshErrorCode };
