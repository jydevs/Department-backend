import { visitorIp } from "../../common/throttle/storefront-throttler.guard";
import { authThrottleLimit } from "../../common/throttle/auth-throttle";
import { Body, Controller, Post, Get, Res, Req, Inject } from "@nestjs/common";
import type { Request, Response } from "express";
import { Throttle } from "@nestjs/throttler";
import { ApiOperation, ApiTags, ApiCookieAuth } from "@nestjs/swagger";
import { AllowWhilePending, CurrentActor, Public } from "../../common/auth/decorators";
import type { Actor } from "../../common/auth/actor";
import { AppException } from "../../common/errors/app-exception";
import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env";
import { AuthService } from "./auth.service";
import {
  LoginRequestDto,
  type LoginResponse,
  type RefreshResponse,
  type MeResponse,
  EnableTwoFARequestDto,
  type EnableTwoFAResponse,
  DisableTwoFARequestDto,
  type DisableTwoFAResponse,
  ChangePasswordRequestDto,
  type ChangePasswordResponse,
  SetupTwoFAResponse,
} from "./dto";

/**
 * Authentication endpoints: login, logout, tokens, 2FA, password changes.
 */
@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * POST /auth/login
   * Authenticate with email/password, optional TOTP.
   * Sets httpOnly cookie with refresh token.
   */
  @Post("login")
  @Public()
  @Throttle({ default: { limit: authThrottleLimit, ttl: 60_000 } })
  @ApiOperation({ summary: "Login with email and password" })
  async login(
    @Body() dto: LoginRequestDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponse> {
    const { refreshToken, ...result } = await this.authService.login(dto.email, dto.password, dto.totp, visitorIp(req, this.env.STOREFRONT_SERVER_KEY));

    // Set refresh token in httpOnly cookie
    res.cookie("dept_rt", refreshToken, {
      httpOnly: true,
      secure: this.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/api/v1/auth",
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    });

    return result;
  }

  /**
   * POST /auth/refresh
   * Rotate refresh token from cookie, return new access token.
   * Sets new refresh token in cookie.
   */
  @Post("refresh")
  @Public()
  @ApiOperation({ summary: "Refresh access token" })
  @ApiCookieAuth("dept_rt")
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<RefreshResponse> {
    // Get refresh token from cookie header
    const cookieHeader = (req.headers.cookie as string | undefined) ?? "";
    const cookies = this.parseCookies(cookieHeader);
    const refreshToken = cookies.dept_rt;

    if (!refreshToken) {
      throw AppException.unauthorized("Missing refresh token");
    }

    const { refreshToken: newRefreshToken, ...result } = await this.authService.refreshAccessToken(refreshToken);

    // Set new refresh token in cookie (absent when a concurrent refresh already rotated it: keep the cookie the winner set)
    if (newRefreshToken) {
      res.cookie("dept_rt", newRefreshToken, {
        httpOnly: true,
        secure: this.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/api/v1/auth",
        maxAge: 30 * 24 * 60 * 60 * 1000,
      });
    }

    return result;
  }

  /**
   * POST /auth/logout
   * Revoke all refresh tokens for the current user.
   */
  @Post("logout")
  @AllowWhilePending("password", "2fa")
  @ApiOperation({ summary: "Logout and revoke all sessions" })
  async logout(@CurrentActor() actor: Actor, @Res({ passthrough: true }) res: Response): Promise<{ message: string }> {
    if (actor.kind !== "staff") {
      throw AppException.unauthorized("Only authenticated users can logout");
    }

    await this.authService.logout(actor.staffId);
    res.clearCookie("dept_rt", { path: "/api/v1/auth" });

    return { message: "Logged out successfully" };
  }

  /**
   * GET /auth/me
   * Get current user info and permissions.
   */
  @Get("me")
  @AllowWhilePending("password", "2fa")
  @ApiOperation({ summary: "Get current user info" })
  async me(@CurrentActor() actor: Actor): Promise<MeResponse> {
    if (actor.kind !== "staff") {
      throw AppException.unauthorized("Authentication required");
    }

    const user = await this.authService.getUserWithPermissions(actor.staffId);

    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      permissions: user.permissions,
      totpEnabled: user.totpEnabled,
      mustChangePassword: user.mustChangePassword,
      twoFactorSetupRequired: user.twoFactorSetupRequired,
    };
  }

  /**
   * POST /auth/2fa/setup
   * Initialize 2FA setup: return otpauth URI.
   */
  @Post("2fa/setup")
  @AllowWhilePending("2fa")
  @ApiOperation({ summary: "Setup two-factor authentication" })
  async setupTwoFA(@CurrentActor() actor: Actor): Promise<SetupTwoFAResponse> {
    if (actor.kind !== "staff") {
      throw AppException.unauthorized("Authentication required");
    }

    const result = await this.authService.setupTwoFA(actor.staffId);

    return { otpauthUrl: result.otpauthUrl };
  }

  /**
   * POST /auth/2fa/enable
   * Verify code and enable 2FA, return recovery codes.
   */
  @Post("2fa/enable")
  @AllowWhilePending("2fa")
  @ApiOperation({ summary: "Enable two-factor authentication" })
  async enableTwoFA(
    @CurrentActor() actor: Actor,
    @Body() dto: EnableTwoFARequestDto,
  ): Promise<EnableTwoFAResponse> {
    if (actor.kind !== "staff") {
      throw AppException.unauthorized("Authentication required");
    }

    const recoveryCodes = await this.authService.enableTwoFA(actor.staffId, dto.password, dto.code);

    return {
      recoveryCodes,
      message: "Two-factor authentication enabled successfully. Save your recovery codes in a secure location.",
    };
  }

  /**
   * POST /auth/2fa/disable
   * Verify password and code, disable 2FA.
   */
  @Post("2fa/disable")
  @Throttle({ default: { limit: authThrottleLimit, ttl: 60_000 } })
  @ApiOperation({ summary: "Disable two-factor authentication" })
  async disableTwoFA(
    @CurrentActor() actor: Actor,
    @Body() dto: DisableTwoFARequestDto,
  ): Promise<DisableTwoFAResponse> {
    if (actor.kind !== "staff") {
      throw AppException.unauthorized("Authentication required");
    }

    await this.authService.disableTwoFA(actor.staffId, dto.password, dto.code);

    return { message: "Two-factor authentication disabled" };
  }

  /**
   * POST /auth/change-password
   * Change password with current password verification. Revokes every session and answers with a NEW one
   * (accessToken in the body + dept_rt cookie, like login) with mustChangePassword=false.
   */
  @Post("change-password")
  @AllowWhilePending("password", "2fa")
  @Throttle({ default: { limit: authThrottleLimit, ttl: 60_000 } })
  @ApiOperation({ summary: "Change user password" })
  async changePassword(
    @CurrentActor() actor: Actor,
    @Body() dto: ChangePasswordRequestDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ChangePasswordResponse> {
    if (actor.kind !== "staff") {
      throw AppException.unauthorized("Authentication required");
    }

    const { refreshToken, ...session } = await this.authService.changePassword(actor.staffId, dto.current, dto.new);
    this.setRefreshCookie(res, refreshToken);
    return session;
  }

  private setRefreshCookie(res: Response, refreshToken: string): void {
    res.cookie("dept_rt", refreshToken, {
      httpOnly: true,
      secure: this.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/api/v1/auth",
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    });
  }

  /**
   * Parse cookies from Cookie header (minimal parser, no dependencies).
   */
  private parseCookies(cookieHeader: string): Record<string, string> {
    const cookies: Record<string, string> = {};
    if (!cookieHeader) return cookies;

    for (const cookie of cookieHeader.split(";")) {
      const eq = cookie.indexOf("=");
      if (eq < 0) continue;
      const key = cookie.slice(0, eq).trim();
      const value = cookie.slice(eq + 1).trim();
      if (!key || !value) continue;
      try {
        cookies[key] = decodeURIComponent(value);
      } catch {
        // malformed percent-encoding (e.g. "%E0%A4%A"): ignore that cookie instead of failing the request with a 500
      }
    }

    return cookies;
  }
}
