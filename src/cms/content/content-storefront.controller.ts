import { Controller, Get, Param, Query, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { Public } from "../../common/auth/decorators";
import { BundleQueryDto, PreviewQueryDto, StorefrontBundleDto, StorefrontDocumentDto, StorefrontKeyParamsDto, StorefrontPageListItemDto } from "./content.dto";
import { etagMatches } from "./content.util";
import { Served, StorefrontContentService } from "./storefront-content.service";

const CACHE = "public, s-maxage=60, stale-while-revalidate=300";

/** Headers are set only after a successful lookup, so a 401/404 is never cached. Returns undefined on 304. */
function send<T>(req: Request, res: Response, served: Served<T>): T | undefined {
  if (served.preview) {
    res.setHeader("Cache-Control", "private, no-store");
    return served.body;
  }
  res.setHeader("Cache-Control", CACHE);
  if (served.etag) {
    res.setHeader("ETag", served.etag);
    if (etagMatches(req.headers["if-none-match"], served.etag)) {
      res.status(304);
      return undefined;
    }
  }
  return served.body;
}

@Controller("storefront/content")
@Public()
export class ContentStorefrontController {
  constructor(private readonly storefront: StorefrontContentService) {}

  @Get("settings")
  async settings(@Query() { preview }: PreviewQueryDto, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<StorefrontDocumentDto | undefined> {
    return send(req, res, await this.storefront.get("settings", "site", preview));
  }

  @Get("menus/:key")
  async menu(
    @Param() { key }: StorefrontKeyParamsDto,
    @Query() { preview }: PreviewQueryDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StorefrontDocumentDto | undefined> {
    return send(req, res, await this.storefront.get("menu", key, preview));
  }

  @Get("templates/:key")
  async template(
    @Param() { key }: StorefrontKeyParamsDto,
    @Query() { preview }: PreviewQueryDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StorefrontDocumentDto | undefined> {
    return send(req, res, await this.storefront.get("template", key, preview));
  }

  @Get("pages")
  async pages(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<StorefrontPageListItemDto[] | undefined> {
    return send(req, res, await this.storefront.listPages());
  }

  @Get("pages/:key")
  async page(
    @Param() { key }: StorefrontKeyParamsDto,
    @Query() { preview }: PreviewQueryDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StorefrontDocumentDto | undefined> {
    return send(req, res, await this.storefront.get("page", key, preview));
  }

  @Get("bundle")
  async bundle(@Query() { template }: BundleQueryDto, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<StorefrontBundleDto | undefined> {
    return send(req, res, await this.storefront.bundle(template));
  }
}
