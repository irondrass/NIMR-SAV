/**
 * NIMR SAV v24 — Version & Cache constants
 *
 * IMPORTANT:
 * - APP_VERSION must remain "v24.0.0-alpha.20" during this isolated recipe cycle
 * - RESERVED_CACHE_NAME is reserved for the v24 recipe scope only
 * - LS_PREFIX is the ONLY authorized localStorage prefix for this app
 * - Never reuse legacy stable/cache prefixes from v23 or old workshop builds
 */

export const APP_VERSION = 'v24.0.0-alpha.20' as const;

export const RESERVED_CACHE_NAME = 'nimr-sav-v24-alpha20-recette' as const;

/** localStorage key prefix — MUST be used for ALL v24 keys */
export const LS_PREFIX = 'nimr-sav-react-v24-' as const;

const legacyPrefixParts = [
  ['nimr', 'sav'],
  ['nimr', 'carrosserie'],
  ['nimr', 'sav', 'v23'],
  ['nimr', 'sav', 'pro'],
] as const;

/** Forbidden localStorage prefixes — must never be reused in v24 */
export const FORBIDDEN_LS_PREFIXES = legacyPrefixParts.map((parts) => parts.join('-')) as readonly string[];

export type ForbiddenPrefix = (typeof FORBIDDEN_LS_PREFIXES)[number];
