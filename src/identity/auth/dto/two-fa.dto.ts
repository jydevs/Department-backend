import { createZodDto } from "nestjs-zod";
import { z } from "zod";

// Setup 2FA
export const setupTwoFAResponseSchema = z.object({
  otpauthUrl: z.string().startsWith("otpauth://"),
});

export type SetupTwoFAResponse = z.infer<typeof setupTwoFAResponseSchema>;

// Enable 2FA
export const enableTwoFARequestSchema = z.object({
  code: z.string().regex(/^\d{6}$/),
  password: z.string().min(1).max(256),
});

export class EnableTwoFARequestDto extends createZodDto(enableTwoFARequestSchema) {}

export const enableTwoFAResponseSchema = z.object({
  recoveryCodes: z.array(z.string()).length(8),
  message: z.string(),
});

export type EnableTwoFAResponse = z.infer<typeof enableTwoFAResponseSchema>;

/** Second factor for sensitive actions: the 6-digit authenticator code OR one of the 8-character recovery codes (consumed when used). */
const secondFactorCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^(\d{6}|[A-Z0-9]{8})$/);

// Disable 2FA
export const disableTwoFARequestSchema = z.object({
  password: z.string().min(1).max(256),
  code: secondFactorCodeSchema,
});

export class DisableTwoFARequestDto extends createZodDto(disableTwoFARequestSchema) {}

export const disableTwoFAResponseSchema = z.object({
  message: z.string(),
});

export type DisableTwoFAResponse = z.infer<typeof disableTwoFAResponseSchema>;

// Regenerate recovery codes
export const regenerateRecoveryCodesRequestSchema = z.object({
  password: z.string().min(1).max(256),
  code: secondFactorCodeSchema,
});

export class RegenerateRecoveryCodesRequestDto extends createZodDto(regenerateRecoveryCodesRequestSchema) {}

export const regenerateRecoveryCodesResponseSchema = enableTwoFAResponseSchema;

export type RegenerateRecoveryCodesResponse = z.infer<typeof regenerateRecoveryCodesResponseSchema>;
