import { Controller, Get, Inject, ServiceUnavailableException } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { SkipThrottle } from "@nestjs/throttler";
import { DataSource } from "typeorm";
import { Public } from "../common/auth/decorators";
import { ENV } from "../config/config.module";
import type { Env } from "../config/env";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Read from package.json at runtime so the compiled output stays flat (dist/main.js). */
function readPackage(): { name: string; version: string } {
  try {
    return JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));
  } catch {
    return { name: "department-backend", version: "0.0.0" };
  }
}
const pkg = readPackage();

/** Liveness / readiness / version. Unprefixed and never rate limited (load balancers poll them). */
@ApiTags("system")
@Public()
@SkipThrottle()
@Controller()
export class HealthController {
  constructor(
    private readonly dataSource: DataSource,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get("health")
  @ApiOperation({ summary: "Liveness: the process is up" })
  health() {
    return { status: "ok", uptimeSeconds: Math.round(process.uptime()) };
  }

  @Get("ready")
  @ApiOperation({ summary: "Readiness: the database answers" })
  async ready() {
    try {
      await Promise.race([
        this.dataSource.query("SELECT 1"),
        new Promise((_, reject) => setTimeout(() => reject(new Error("db timeout")), 2000).unref()),
      ]);
      return { status: "ready", database: "up" };
    } catch {
      throw new ServiceUnavailableException({ code: "NOT_READY", message: "Database unavailable" });
    }
  }

  @Get("version")
  @ApiOperation({ summary: "Build information" })
  version() {
    return { name: pkg.name, version: pkg.version, gitSha: this.env.GIT_SHA ?? null, node: process.version };
  }
}
