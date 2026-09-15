"use client";

import { useEffect, useState } from "react";

/**
 * A piece of screen state that survives navigating away and back.
 *
 * Filters, tabs and search boxes were all plain `useState`, so a clinician who
 * filtered the patient list to "Cardiology · red risk", opened a patient and
 * pressed back had to rebuild the filter every single time. That is the most
 * repeated avoidable action in the product.
 *
 * Scoped to the browser tab (sessionStorage), so it is remembered for the
 * working session and forgotten when the tab closes — a filter that persisted
 * for weeks would be its own kind of surprise. Never throws: private windows
 * and blocked site data simply fall back to ordinary component state.
 */
export function useSticky<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(initial);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(`hos.${key}`);
      if (raw !== null) setValue(JSON.parse(raw) as T);
    } catch {
      /* storage unavailable — keep the default */
    }
    setHydrated(true);
  }, [key]);

  useEffect(() => {
    if (!hydrated) return; /* don't write the default over a stored value */
    try {
      sessionStorage.setItem(`hos.${key}`, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  }, [key, value, hydrated]);

  return [value, setValue];
}
