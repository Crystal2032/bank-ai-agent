import { useCallback, useEffect, useRef, useState, type DependencyList } from "react";

export interface Loaded<T> {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  reload: () => void;
}

/** Loads data when dependencies change; ignores stale responses. */
export function useLoad<T>(load: () => Promise<T>, deps: DependencyList): Loaded<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const latest = useRef(0);
  const run = useCallback(load, deps);
  useEffect(() => {
    const ticket = ++latest.current;
    setLoading(true);
    run().then(
      (value) => {
        if (ticket !== latest.current) return;
        setData(value);
        setError(null);
        setLoading(false);
      },
      (reason: unknown) => {
        if (ticket !== latest.current) return;
        setError(reason);
        setLoading(false);
      },
    );
  }, [run, nonce]);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, error, loading, reload };
}
