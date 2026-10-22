import { AUTH_THROTTLE_LIMIT } from "../../common/throttle/auth-throttle";
import { Body, Controller, HttpCode, Inject, Post, Req, Res } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import { Public } from "../../common/auth/decorators";
import { AppException } from "../../common/errors/app-exception";
import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env";
import {
  CustomerLoginDto,
  ForgotPasswordDto,
  RegisterDto,
  ResendVerificationDto,
  ResetPasswordDto,
  VerifyEmailDto,
  type CustomerLoginResponse,
  type CustomerRefreshResponse,
  type MessageResponse,
} from "../dto/customers.dto";
import { CustomerAuthService } from "./customer-auth.service";

export const CUSTOMER_REFRESH_COOKIE = "dept_ct";
const COOKIE_PATH = "/api/v1/storefront/customers";
const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** Storefront customer authentication. Every route is @Public() for the staff guard: nothing here uses a staff token. */
@ApiTags("storefront-customers-auth")
@Controller("storefront/customers")
export class CustomerAuthController {
  constructor(
    private readonly auth: CustomerAuthService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Post("register")
  @Public()
  @HttpCode(202)
  @Throttle({ default: { limit: AUTH_THROTTLE_LIMIT, ttl: 60_000 } })
  @ApiOperation({ summary: "Register an account (always 202: does not reveal whether the email exists)" })
  register(@Body() dto: RegisterDto): MessageResponse {
    this.auth.register(dto);
    return { message: "If the address can be registered, we sent you an email to verify it." };
  }

  @Post("login")
  @Public()
  @HttpCode(200)
  @Throttle({ default: { limit: AUTH_THROTTLE_LIMIT, ttl: 60_000 } })
  @ApiOperation({ summary: "Log in with email and password" })
  async login(@Body() dto: CustomerLoginDto, @Res({ passthrough: true }) res: Response): Promise<CustomerLoginResponse> {
    const { refreshToken, ...result } = await this.auth.login(dto.email, dto.password);
    this.setRefreshCookie(res, refreshToken);
    res.setHeader("Cache-Control", "no-store");
    return result;
  }

  @Post("refresh")
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: "Rotate the refresh cookie and get a new access token" })
  @ApiCookieAuth(CUSTOMER_REFRESH_COOKIE)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<CustomerRefreshResponse> {
    const current = readCookie(req.headers.cookie, CUSTOMER_REFRESH_COOKIE);
    if (!current) throw AppException.unauthorized("Missing refresh token");

    try {
      const { refreshToken, ...result } = await this.auth.refresh(current);
      this.setRefreshCookie(res, refreshToken);
      res.setHeader("Cache-Control", "no-store");
      return result;
    } catch (err) {
      res.clearCookie(CUSTOMER_REFRESH_COOKIE, { path: COOKIE_PATH });
      throw err;
    }
  }

  @Post("logout")
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: "End this session (public: works even when the access token already expired)" })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<MessageResponse> {
    await this.auth.logout(readCookie(req.headers.cookie, CUSTOMER_REFRESH_COOKIE));
    res.clearCookie(CUSTOMER_REFRESH_COOKIE, { path: COOKIE_PATH });
    return { message: "Logged out" };
  }

  @Post("forgot-password")
  @Public()
  @HttpCode(202)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({ summary: "Request a password reset link (always 202)" })
  forgotPassword(@Body() dto: ForgotPasswordDto): MessageResponse {
    this.auth.forgotPassword(dto.email);
    return { message: "If the account exists, we sent you an email with instructions." };
  }

  @Post(["auth/resend-verification", "resend-verification"])
  @Public()
  @HttpCode(202)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({ summary: "Resend the email verification link (always 202: does not reveal whether the account exists)" })
  resendVerification(@Body() dto: ResendVerificationDto): MessageResponse {
    this.auth.resendVerification(dto.email);
    return { message: "If the account exists and is not verified yet, we sent you a new verification email." };
  }

  @Post("reset-password")
  @Public()
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: "Set a new password with a reset token; signs out every session" })
  async resetPassword(@Body() dto: ResetPasswordDto, @Res({ passthrough: true }) res: Response): Promise<MessageResponse> {
    await this.auth.resetPassword(dto.token, dto.password);
    res.clearCookie(CUSTOMER_REFRESH_COOKIE, { path: COOKIE_PATH });
    return { message: "Password updated. Please log in again." };
  }

  @Post("verify-email")
  @Public()
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: "Verify the email address with the emailed token; sets the given password and signs out every session" })
  async verifyEmail(@Body() dto: VerifyEmailDto): Promise<MessageResponse> {
    await this.auth.verifyEmail(dto.token, dto.password);
    return { message: "Email verified" };
  }

  private setRefreshCookie(res: Response, value: string): void {
    res.cookie(CUSTOMER_REFRESH_COOKIE, value, {
      httpOnly: true,
      secure: this.env.NODE_ENV === "production",
      sameSite: "lax",
      path: COOKIE_PATH,
      maxAge: COOKIE_MAX_AGE_MS,
    });
  }
}

function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0 || part.slice(0, idx).trim() !== name) continue;
    const raw = part.slice(idx + 1).trim();
    try {
      return raw ? decodeURIComponent(raw) : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}
