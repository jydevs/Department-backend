import { z } from "zod";

/**
 * Date accepted from the outside as an ISO string (or `YYYY-MM-DD`) and delivered to the service as a `Date`.
 * `z.coerce.date()` cannot be represented in JSON Schema and would crash the OpenAPI generation at boot.
 */
export const dateInput = z
  .string()
  .max(40)
  .refine((v) => !Number.isNaN(Date.parse(v)), "Invalid date")
  .transform((v) => new Date(v));
