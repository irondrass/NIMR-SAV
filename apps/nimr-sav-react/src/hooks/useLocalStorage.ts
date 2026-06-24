import { useState, useCallback } from 'react';
import { LS_PREFIX, FORBIDDEN_LS_PREFIXES } from '@/constants/version';

/**
 * useLocalStorage — v24 hook with enforced prefix "nimr-sav-react-v24-"
 *
 * Security guarantees:
 * - All keys are automatically prefixed with LS_PREFIX
 * - Will throw at runtime if a forbidden v23.x prefix is detected
 * - Never reads keys from v23.x localStorage
 */

function buildKey(key: string): string {
  // Guard: reject any attempt to reuse forbidden v23.x prefixes
  for (const forbidden of FORBIDDEN_LS_PREFIXES) {
    if (key.startsWith(forbidden)) {
      throw new Error(
        `[NIMR v24] localStorage key "${key}" uses forbidden prefix "${forbidden}". ` +
        `Use "${LS_PREFIX}" prefix exclusively.`
      );
    }
  }
  return `${LS_PREFIX}${key}`;
}

export function useLocalStorage<T>(
  key: string,
  initialValue: T
): [T, (value: T | ((prev: T) => T)) => void, () => void] {
  const prefixedKey = buildKey(key);

  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      const item = window.localStorage.getItem(prefixedKey);
      return item !== null ? (JSON.parse(item) as T) : initialValue;
    } catch {
      return initialValue;
    }
  });

  const setValue = useCallback(
    (value: T | ((prev: T) => T)) => {
      try {
        const valueToStore =
          typeof value === 'function'
            ? (value as (prev: T) => T)(storedValue)
            : value;
        setStoredValue(valueToStore);
        window.localStorage.setItem(prefixedKey, JSON.stringify(valueToStore));
      } catch (error) {
        console.error('[NIMR v24] localStorage write error:', error);
      }
    },
    [prefixedKey, storedValue]
  );

  const removeValue = useCallback(() => {
    try {
      setStoredValue(initialValue);
      window.localStorage.removeItem(prefixedKey);
    } catch (error) {
      console.error('[NIMR v24] localStorage remove error:', error);
    }
  }, [prefixedKey, initialValue]);

  return [storedValue, setValue, removeValue];
}
