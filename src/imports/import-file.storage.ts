import { Inject, Injectable } from "@nestjs/common";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { ENV } from "../config/config.module";
import type { Env } from "../config/env";

/** Key of a job's CSV inside the private imports folder (generated from the job uuid, never from the client file name). */
export const importFileKey = (jobId: string): string => `${jobId}.csv`;

const KEY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.csv$/;

/**
 * Private storage for uploaded import CSVs: `UPLOAD_DIR/imports/<uuid>.csv`.
 * Same care as LocalDiskStorage (resolved path must stay inside the root), but there is NO public URL:
 * `/media/:key` only serves exact image keys from the upload root, so this subfolder is never reachable over HTTP.
 */
@Injectable()
export class ImportFileStorage {
  private readonly root: string;

  constructor(@Inject(ENV) env: Env) {
    this.root = path.resolve(env.UPLOAD_DIR, "imports");
  }

  resolvePath(key: string): string {
    if (!KEY_RE.test(key)) throw new Error("Invalid import file key");
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new Error("Storage key escapes the imports directory");
    return full;
  }

  async put(key: string, buffer: Buffer): Promise<void> {
    const full = this.resolvePath(key);
    await mkdir(this.root, { recursive: true });
    await writeFile(full, buffer, { flag: "wx", mode: 0o600 });
  }

  /** Returns null when the file is gone. */
  async read(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.resolvePath(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.resolvePath(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
}
