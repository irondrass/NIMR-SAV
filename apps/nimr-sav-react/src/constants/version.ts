/**
 * NIMR SAV v24 — Version & Cache constants
 *
 * IMPORTANT:
 * - APP_VERSION must remain "v24.0.0-alpha.14" during this internal acceptance cycle
 * - RESERVED_CACHE_NAME is reserved but NOT actively registered (no SW yet)
 * - LS_PREFIX is the ONLY authorized localStorage prefix for this app
 * - Never reuse: nimr-sav, nimr-carrosserie, nimr-sav-v23, nimr-sav-pro
 */

export const APP_VERSION = 'v24.0.0-alpha.14' as const;

export const RESERVED_CACHE_NAME = 'nimr-sav-react-v24-alpha' as const;

/** localStorage key prefix — MUST be used for ALL v24 keys */
export const LS_PREFIX = 'nimr-sav-react-v24-' as const;

/** Forbidden localStorage prefixes — must never be reused in v24 */
export const FORBIDDEN_LS_PREFIXES = [
  'nimr-sav',
  'nimr-carrosserie',
  'nimr-sav-v23',
  'nimr-sav-pro',
] as const;

export type ForbiddenPrefix = (typeof FORBIDDEN_LS_PREFIXES)[number];
