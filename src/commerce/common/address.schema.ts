import { z } from "zod";

// eslint-disable-next-line no-control-regex
const NO_CONTROL = /^[^\u0000-\u001f\u007f]*$/;
const text = (min: number, max: number) => z.string().trim().min(min).max(max).regex(NO_CONTROL, "Invalid characters");

export const addressSchema = z.object({
  fullName: text(2, 120),
  phone: z.string().trim().regex(/^\+?[0-9]{7,20}$/, "Invalid phone"),
  department: text(2, 60),
  city: text(2, 80),
  address1: text(5, 200),
  address2: text(0, 200).optional(),
  postalCode: text(0, 12).optional(),
  documentType: z.enum(["CC", "CE", "NIT", "PP"]).optional(),
  documentNumber: text(4, 20).optional(),
});

export type Address = z.infer<typeof addressSchema>;
