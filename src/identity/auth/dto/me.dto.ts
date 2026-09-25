import { z } from "zod";

export const meResponseSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  fullName: z.string(),
  role: z.string(),
  permissions: z.array(z.string()),
  totpEnabled: z.boolean(),
});

export type MeResponse = z.infer<typeof meResponseSchema>;
