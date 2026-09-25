import { Controller, HttpCode, Post } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { RequirePermissions } from "../common/auth/decorators";
import { MaintenanceService, type MaintenanceSummary } from "./maintenance.service";

@Controller("admin/maintenance")
export class MaintenanceController {
  constructor(private readonly maintenance: MaintenanceService) {}

  /** Runs one maintenance pass now (same as the hourly one) and returns the per-task summary. */
  @Post("run")
  @HttpCode(200)
  @Throttle({ default: { limit: 2, ttl: 60_000 } })
  @RequirePermissions("settings:write")
  run(): Promise<MaintenanceSummary> {
    return this.maintenance.run();
  }
}
