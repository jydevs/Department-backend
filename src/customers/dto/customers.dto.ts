import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { addressSchema } from "../../commerce/common/address.schema";
import type { PaymentInstructions } from "../../commerce/payments/payment-provider";

/* ── shared field rules ───────────────────────────────────── */

// eslint-disable-next-line no-control-regex
const NO_CONTROL = /^[^\u0000-\u001f\u007f]*$/;
const name = z.string().trim().min(1).max(120).regex(NO_CONTROL, "Invalid characters");
const email = z.string().trim().toLowerCase().pipe(z.email().max(255));
const phone = z.string().trim().regex(/^\+?[0-9]{7,20}$/, "Invalid phone");
/** 12..256 characters: long passphrases are welcome, argon2 input stays bounded. */
export const passwordSchema = z.string().min(12).max(256);
const opaqueToken = z.string().min(20).max(200);
const optionalQuery = <T extends z.ZodType>(schema: T) => z.preprocess((v) => (v === "" ? undefined : v), schema.optional());
const boolQuery = z.preprocess((v) => (v === "true" || v === "1" ? true : v === "false" || v === "0" ? false : v), z.boolean());

/* ── auth requests ────────────────────────────────────────── */

export const registerSchema = z
  .object({
    email,
    password: passwordSchema,
    firstName: name,
    lastName: name,
    acceptsMarketing: z.boolean().default(false),
  })
  .strict();
export type RegisterInput = z.infer<typeof registerSchema>;
export class RegisterDto extends createZodDto(registerSchema) {}

export const loginSchema = z.object({ email, password: z.string().min(1).max(256) }).strict();
export class CustomerLoginDto extends createZodDto(loginSchema) {}

export const forgotPasswordSchema = z.object({ email }).strict();
export class ForgotPasswordDto extends createZodDto(forgotPasswordSchema) {}

export const resendVerificationSchema = z.object({ email }).strict();
export class ResendVerificationDto extends createZodDto(resendVerificationSchema) {}

export const resetPasswordSchema = z.object({ token: opaqueToken, password: passwordSchema }).strict();
export class ResetPasswordDto extends createZodDto(resetPasswordSchema) {}

/** The link proves mailbox ownership, so verifying also SETS the password (whoever registered the address first never keeps theirs). */
export const verifyEmailSchema = z.object({ token: opaqueToken, password: passwordSchema }).strict();
export class VerifyEmailDto extends createZodDto(verifyEmailSchema) {}

/* ── account requests ─────────────────────────────────────── */

export const updateProfileSchema = z
  .object({
    firstName: name.optional(),
    lastName: name.optional(),
    phone: phone.nullable().optional(),
    acceptsMarketing: z.boolean().optional(),
  })
  .strict();
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export class UpdateProfileDto extends createZodDto(updateProfileSchema) {}

export const changePasswordSchema = z.object({ currentPassword: z.string().min(1).max(256), newPassword: passwordSchema }).strict();
export class CustomerChangePasswordDto extends createZodDto(changePasswordSchema) {}

export const deleteAccountSchema = z.object({ password: z.string().min(1).max(256) }).strict();
export class DeleteAccountDto extends createZodDto(deleteAccountSchema) {}

const addressExtras = { label: z.string().trim().min(1).max(40).regex(NO_CONTROL, "Invalid characters").nullable().optional(), isDefault: z.boolean().optional() };
export const createAddressSchema = addressSchema.extend(addressExtras).strict();
export type CreateAddressInput = z.infer<typeof createAddressSchema>;
export class CreateAddressDto extends createZodDto(createAddressSchema) {}

/** On update the document can be removed: `null` (or an empty string) clears it; the 4-character minimum only applies to a real value. */
const clearableDocument = {
  documentType: addressSchema.shape.documentType.nullable(),
  documentNumber: z
    .union([z.null(), z.string().trim().max(20).regex(NO_CONTROL, "Invalid characters")])
    .transform((v) => (v === "" ? null : v))
    .refine((v) => v === null || v.length >= 4, "Too small: expected at least 4 characters")
    .optional(),
};
export const updateAddressSchema = addressSchema.partial().extend(clearableDocument).extend(addressExtras).strict();
export type UpdateAddressInput = z.infer<typeof updateAddressSchema>;
export class UpdateAddressDto extends createZodDto(updateAddressSchema) {}

export const addressIdParamSchema = z.object({ addressId: z.uuid() });
export class AddressIdParamDto extends createZodDto(addressIdParamSchema) {}

export const orderNumberParamSchema = z.object({ orderNumber: z.coerce.number().int().min(1).max(2_147_483_647) });
export class OrderNumberParamDto extends createZodDto(orderNumberParamSchema) {}

/* ── admin requests ───────────────────────────────────────── */

const adminFilters = {
  q: optionalQuery(z.string().trim().min(1).max(255)),
  acceptsMarketing: optionalQuery(boolQuery),
  isActive: optionalQuery(boolQuery),
  tag: optionalQuery(z.string().trim().min(1).max(50)),
};

export const customerListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  ...adminFilters,
});
export type CustomerListQuery = z.infer<typeof customerListQuerySchema>;
export class CustomerListQueryDto extends createZodDto(customerListQuerySchema) {}

export const customerExportQuerySchema = z.object(adminFilters);
export type CustomerExportQuery = z.infer<typeof customerExportQuerySchema>;
export class CustomerExportQueryDto extends createZodDto(customerExportQuerySchema) {}

export const adminUpdateCustomerSchema = z
  .object({
    firstName: name.optional(),
    lastName: name.optional(),
    phone: phone.nullable().optional(),
    tags: z.array(z.string().trim().min(1).max(50)).max(50).optional(),
    internalNote: z.string().max(5000).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .strict();
export type AdminUpdateCustomerInput = z.infer<typeof adminUpdateCustomerSchema>;
export class AdminUpdateCustomerDto extends createZodDto(adminUpdateCustomerSchema) {}

/* ── responses (explicit: never expose passwordHash, tokens or internals) ── */

export interface MessageResponse {
  message: string;
}

export interface CustomerProfileDto {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  acceptsMarketing: boolean;
  emailVerified: boolean;
  createdAt: Date;
}

export interface CustomerLoginResponse {
  accessToken: string;
  expiresIn: number;
  customer: CustomerProfileDto;
}

export interface CustomerRefreshResponse {
  accessToken: string;
  expiresIn: number;
}

export interface CustomerAddressDto {
  id: string;
  label: string | null;
  isDefault: boolean;
  fullName: string;
  phone: string;
  department: string;
  city: string;
  address1: string;
  address2: string | null;
  postalCode: string | null;
  documentType: string | null;
  documentNumber: string | null;
}

export interface PublicOrderSummaryDto {
  orderNumber: number;
  status: string;
  paymentStatus: string;
  fulfillmentStatus: string;
  currency: string;
  total: number;
  itemCount: number;
  createdAt: Date;
}

export interface PublicOrderLineDto {
  title: string;
  variantTitle: string;
  sku: string | null;
  imageUrl: string | null;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  fulfilledQuantity: number;
  refundedQuantity: number;
}

export interface PublicFulfillmentDto {
  status: string;
  carrier: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  shippedAt: Date;
}

export interface PublicOrderDto extends PublicOrderSummaryDto {
  email: string;
  phone: string | null;
  subtotal: number;
  discountTotal: number;
  shippingTotal: number;
  taxTotal: number;
  totalRefunded: number;
  discountCode: string | null;
  shippingRateName: string | null;
  shippingAddress: Record<string, unknown>;
  billingAddress: Record<string, unknown> | null;
  customerNote: string | null;
  paidAt: Date | null;
  cancelledAt: Date | null;
  lines: PublicOrderLineDto[];
  fulfillments: PublicFulfillmentDto[];
}

/** Line of `GET /storefront/customers/me/orders/:orderNumber`: the export line plus the ids needed to link/re-buy. */
export interface PublicOrderDetailLineDto extends PublicOrderLineDto {
  variantId: string;
  productId: string;
  /** Current handle of the product (null if it no longer exists). */
  productHandle: string | null;
}

/** One of my orders: same payment data as the public order status (`payment.instructions` only while `pending`). */
export interface PublicOrderDetailDto extends Omit<PublicOrderDto, "lines"> {
  lines: PublicOrderDetailLineDto[];
  payment: { provider: string; status: string; method: string | null; instructions: PaymentInstructions | null } | null;
  /** Only while the order is `pending`. */
  reservedUntil: Date | null;
}

export interface CustomerDataExportDto {
  exportedAt: Date;
  profile: CustomerProfileDto & { marketingConsentAt: Date | null; lastLoginAt: Date | null };
  addresses: CustomerAddressDto[];
  orders: PublicOrderDto[];
  sessions: { createdAt: Date; expiresAt: Date; revokedAt: Date | null; userAgent: string | null; ip: string | null }[];
  newsletter: { status: string; source: string; consentAt: Date | null; createdAt: Date } | null;
  contactMessages: { name: string; subject: string | null; message: string; status: string; createdAt: Date }[];
}

export interface AdminCustomerDto {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  acceptsMarketing: boolean;
  marketingConsentAt: Date | null;
  isActive: boolean;
  hasAccount: boolean;
  emailVerified: boolean;
  tags: string[];
  lastLoginAt: Date | null;
  anonymizedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminCustomerOrderDto {
  id: string;
  orderNumber: number;
  status: string;
  paymentStatus: string;
  fulfillmentStatus: string;
  currency: string;
  total: number;
  createdAt: Date;
}

export interface AdminCustomerDetailDto extends AdminCustomerDto {
  internalNote: string | null;
  addresses: CustomerAddressDto[];
  orders: AdminCustomerOrderDto[];
}
