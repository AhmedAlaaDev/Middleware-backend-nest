export class ICacheEntry {
  id: string;
  key: string;
  value: string;
  expiresAt: string;
}

export interface ICreateCacheEntry {
  key: string;
  value: string;
  expiresAt: Date;
}

export type IUpdateCacheEntry = Partial<ICreateCacheEntry>;

export interface ICacheEntryFilters {
  key?: string;
  expiresAt?: Date;
}
