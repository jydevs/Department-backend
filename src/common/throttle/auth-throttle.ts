/**
 * Login attempts per minute per IP. Fixed at 5 in production (env validation enforces it);
 * AUTH_THROTTLE_LIMIT only exists so several developers/agents can share one dev API.
 *
 * It is a function (the throttler resolves it per request): decorators are evaluated at import time, BEFORE
 * `loadDotEnv()` fills process.env from `.env`, so reading the variable there would ignore the file.
 */
export const authThrottleLimit = (): number => Math.max(1, Number(process.env.AUTH_THROTTLE_LIMIT ?? 5) || 5);
