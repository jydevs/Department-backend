export const PERMISSIONS = [
  "staff:read",
  "staff:write",
  "roles:read",
  "roles:write",
  "audit:read",
  "settings:write",
  "products:read",
  "products:write",
  "orders:read",
  "orders:write",
  "customers:read",
  "customers:write",
  "content:read",
  "content:write",
  "content:publish",
  "media:write",
  "discounts:write",
  "analytics:read",
] as const;

export type Permission = typeof PERMISSIONS[number];

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
  ],
  fulfillment: ["orders:read", "orders:write"],
  support: ["orders:read", "customers:read"],
  analyst: [
    "staff:read",
    "roles:read",
    "audit:read",
    "products:read",
    "orders:read",
    "customers:read",
    "content:read",
    "analytics:read",
  ],
};
