import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from './api';

export type Query<T> = { data: T | undefined; error: ApiError | null; loading: boolean; reload: () => Promise<void>; setData: (d: T) => void };

/** Minimal data hook: runs `fn` on mount and whenever `deps` change; keeps stale data visible while reloading. */
export function useQuery<T>(fn: () => Promise<T>, deps: unknown[]): Query<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const run = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    try {
      const d = await fnRef.current();
      if (mine === seq.current) { setData(d); setError(null); }
    } catch (e) {
      if (mine === seq.current) setError(e instanceof ApiError ? e : new ApiError(0, 'Something went wrong'));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void run(); }, deps);
  return { data, error, loading, reload: run, setData };
}

export function useDebounced<T>(value: T, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}
