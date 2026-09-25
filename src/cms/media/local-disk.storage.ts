import { mkdir, unlink, writeFile } from "node:fs/promises";
import * as path from "node:path";
import type { StorageDriver } from "./storage.driver";

export class LocalDiskStorage implements StorageDriver {
  private readonly root: string;

  constructor(
    uploadDir: string,
    private readonly publicUrl: string,
  ) {
    this.root = path.resolve(uploadDir);
  }

  /** Absolute path for `key`, guaranteed to live inside the upload dir (throws otherwise). */
  resolvePath(key: string): string {
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new Error("Storage key escapes the upload directory");
    return full;
  }

  async put(key: string, buffer: Buffer): Promise<{ url: string }> {
    const full = this.resolvePath(key);
    await mkdir(this.root, { recursive: true });
    await writeFile(full, buffer, { flag: "wx" });
    return { url: `${this.publicUrl.replace(/\/+$/, "")}/media/${key}` };
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.resolvePath(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
}
