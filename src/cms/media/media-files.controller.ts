import { Controller, Get, Inject, Param, Res } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import type { Response } from "express";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Public } from "../../common/auth/decorators";
import { AppException } from "../../common/errors/app-exception";
import { EXT_TO_MIME } from "./image-type";
import { STORAGE_DRIVER, type StorageDriver } from "./storage.driver";

const KEY_RE = /^[0-9a-f-]{36}\.(png|jpe?g|webp|avif|gif)$/;

/** Serves uploaded files at GET /media/:key (outside the api/v1 prefix). No directory listing: exact keys only. */
@Controller({ path: "media" })
export class MediaFilesController {
  constructor(@Inject(STORAGE_DRIVER) private readonly storage: StorageDriver) {}

  @Get(":key")
  @Public()
  // images are served from the CDN/edge cache and requested in bulk by every page: the global per-IP limit would 429 normal browsing
  @SkipThrottle()
  async serve(@Param("key") key: string, @Res() res: Response): Promise<void> {
    const match = KEY_RE.exec(key);
    if (!match || !this.storage.resolvePath) throw AppException.notFound("File");
    const full = this.storage.resolvePath(key);
    const info = await stat(full).catch(() => null);
    if (!info?.isFile()) throw AppException.notFound("File");

    res.setHeader("Content-Type", EXT_TO_MIME[match[1]] ?? "application/octet-stream");
    res.setHeader("Content-Length", info.size);
    res.setHeader("Content-Disposition", "inline");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.setHeader("X-Content-Type-Options", "nosniff");
    // the storefront lives on another origin and embeds these images
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    createReadStream(full)
      .on("error", () => res.destroy())
      .pipe(res);
  }
}
