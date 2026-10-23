export const PERMISSIONS = [
  "staff:read",
  "staff:write",
  "roles:read",
  "roles:write",
  "audit:read",
  "settings:write",
  "products:read",
  "products:write",
  "collections:read",
  "collections:write",
  "inventory:read",
  "inventory:write",
  "orders:read",
  "orders:write",
  /** mark an order as paid by hand (money not verified by the gateway): owner/admin only */
  "orders:payments",
  /** register refunds: owner/admin only */
  "orders:refunds",
  "customers:read",
  "customers:write",
  "content:read",
  "content:write",
  "content:publish",
  "media:write",
  "discounts:read",
  "discounts:write",
  "shipping:read",
  "shipping:write",
  "settings:read",
  "marketing:read",
  "marketing:write",
  "import:read",
  "import:write",
  "analytics:read",
] as const;

export type Permission = typeof PERMISSIONS[number];

/**
 * Sensitive permissions: a role holding ANY of them must have 2FA enrolled when REQUIRE_STAFF_2FA is on (default in production).
 * They cover privilege escalation (roles/staff/settings), money (manual payments, refunds) and bulk or customer-facing
 * writes (imports, customers, discounts). Today only owner and admin hold them; a custom role that gets one is covered too.
 * Keep docs/API.md (section 6 of the auth flow) in sync when this list changes.
 */
export const TWO_FACTOR_REQUIRED_PERMISSIONS: readonly Permission[] = [
  "roles:write",
  "staff:write",
  "settings:write",
  "orders:payments",
  "orders:refunds",
  "import:write",
  "customers:write",
  "discounts:write",
];

export type RoleKey = "owner" | "admin" | "editor" | "fulfillment" | "support" | "analyst";

export const ROLE_DEFAULTS: Record<RoleKey, Permission[]> = {
  owner: [...PERMISSIONS],
  admin: PERMISSIONS.filter((p) => p !== "roles:write"),
  editor: [
    "content:read",
    "content:write",
    "content:publish",
    "media:write",
    "products:read",
    "products:write",
    "collections:read",
    "collections:write",
    "inventory:read",
  ],
  fulfillment: ["orders:read", "orders:write", "inventory:read", "inventory:write", "shipping:read"],
  support: ["orders:read", "customers:read", "marketing:read"],
  analyst: [
    "staff:read",
    "roles:read",
    "audit:read",
    "products:read",
    "collections:read",
    "inventory:read",
    "orders:read",
    "customers:read",
    "content:read",
    "analytics:read",
    "discounts:read",
    "shipping:read",
    "marketing:read",
  ],
};
