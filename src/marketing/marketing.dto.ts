import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { pageQuerySchema } from "../common/pagination/pagination";

/* ── storefront ── */

const subscribeSchema = z.strictObject({
  email: z.email().max(255).transform((v) => v.toLowerCase()),
  source: z
    .string()
    .trim()
    .regex(/^[a-z0-9_-]{1,40}$/i)
    .default("footer"),
});
export class SubscribeNewsletterDto extends createZodDto(subscribeSchema) {}

/** confirm tokens are 43 base64url characters; unsubscribe tokens are `<subscriber uuid>.<43 char hmac>`. */
const tokenQuerySchema = z.object({ token: z.string().regex(/^[A-Za-z0-9_.-]{43,90}$/) });
export class NewsletterTokenQueryDto extends createZodDto(tokenQuerySchema) {}

/** Plain text only: no HTML tags, no control characters (newlines and tabs allowed where `multiline`). */
const plain = (max: number, multiline = false) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((v) => !/<[^>]*>/.test(v), "HTML is not allowed")
    // eslint-disable-next-line no-control-regex
    .refine((v) => !(multiline ? /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/ : /[\u0000-\u001F\u007F]/).test(v), "Control characters are not allowed");

const contactSchema = z.strictObject({
  name: plain(120),
  email: z.email().max(255).transform((v) => v.toLowerCase()),
  subject: plain(200).optional(),
  /** 7-20 digits, optional leading +. */
  phone: z.preprocess((v) => (v === "" ? undefined : v), z.string().regex(/^[+]?[0-9]{7,20}$/, "Invalid phone number").optional()),
  message: plain(4000, true),
  /** honeypot: real users never see it */
  website: z.string().max(500).optional(),
});
export class CreateContactMessageDto extends createZodDto(contactSchema) {}

/* ── admin ── */

const CONTACT_STATUSES = ["new", "read", "replied", "spam"] as const;
const NEWSLETTER_STATUSES = ["pending", "subscribed", "unsubscribed"] as const;
const optionalText = (max: number) => z.preprocess((v) => (v === "" ? undefined : v), z.string().trim().max(max).optional());

const contactListSchema = pageQuerySchema.extend({
  status: z.preprocess((v) => (v === "" ? undefined : v), z.enum(CONTACT_STATUSES).optional()),
  q: optionalText(100),
});
export class ContactMessageListQueryDto extends createZodDto(contactListSchema) {}

const contactUpdateSchema = z.strictObject({ status: z.enum(CONTACT_STATUSES) });
export class UpdateContactMessageDto extends createZodDto(contactUpdateSchema) {}

const newsletterListSchema = pageQuerySchema.extend({
  status: z.preprocess((v) => (v === "" ? undefined : v), z.enum(NEWSLETTER_STATUSES).optional()),
  q: optionalText(100),
});
export class NewsletterListQueryDto extends createZodDto(newsletterListSchema) {}

export interface ContactMessageResponse {
  id: string;
  name: string;
  email: string;
  subject: string | null;
  phone: string | null;
  message: string;
  status: string;
  ip: string | null;
  createdAt: Date;
}

export interface NewsletterSubscriberResponse {
  id: string;
  email: string;
  status: string;
  source: string;
  consentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AcceptedResponse {
  accepted: true;
}

export interface NewsletterTokenResponse {
  status: "subscribed" | "unsubscribed";
}
