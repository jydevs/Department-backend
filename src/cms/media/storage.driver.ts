/** Injection token for the active StorageDriver (swap LocalDiskStorage for S3/R2 later). */
export const STORAGE_DRIVER = Symbol("STORAGE_DRIVER");

export interface StorageDriver {
  /** Persist the bytes under `key` and return the public URL. */
  put(key: string, buffer: Buffer, mime: string): Promise<{ url: string }>;
  /** Remove the object. A missing object is not an error. */
  delete(key: string): Promise<void>;
  /** Absolute path for local drivers (used by the file server); absent for remote drivers. */
  resolvePath?(key: string): string;
}
