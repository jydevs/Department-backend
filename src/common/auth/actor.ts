/** Who is making the request. Set by the auth guard (Phase 1); read via @CurrentActor() or RequestContextStore. */
export type Actor =
  | { kind: "anonymous" }
  | { kind: "customer"; customerId: string }
  | { kind: "staff"; staffId: string; roles: string[]; permissions: ReadonlySet<string> }
  | { kind: "apiKey"; keyId: string; permissions: ReadonlySet<string> }
  | { kind: "storefront" }; // the Next.js server, identified by STOREFRONT_SERVER_KEY
