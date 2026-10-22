/**
 * Login attempts per minute per IP. Fixed at 5 in production (env validation enforces it);
 * AUTH_THROTTLE_LIMIT only exists so several developers/agents can share one dev API.
 */
export const AUTH_THROTTLE_LIMIT = Math.max(1, Number(process.env.AUTH_THROTTLE_LIMIT ?? 5) || 5);
