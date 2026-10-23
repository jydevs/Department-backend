import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { loginResponseSchema } from "./login.dto";

export const changePasswordRequestSchema = z.object({
  current: z.string().min(1).max(256),
  new: z.string().min(12).max(256),
});

export class ChangePasswordRequestDto extends createZodDto(changePasswordRequestSchema) {}

/** A fresh session, same shape as the login response (the refresh token travels in the dept_rt cookie). */
export const changePasswordResponseSchema = loginResponseSchema.extend({ mustChangePassword: z.literal(false) });

export type ChangePasswordResponse = z.infer<typeof changePasswordResponseSchema>;
