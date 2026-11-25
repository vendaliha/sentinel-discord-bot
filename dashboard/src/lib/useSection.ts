import { useCallback, useEffect, useRef, useState } from "react";

export function useSection<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const alive = useRef(true);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const next = await loaderRef.current();
      if (!alive.current) return;
      setData(next);
      setError(null);
    } catch (caught) {
      if (!alive.current) return;
      setError(caught instanceof Error ? caught.message : "Could not load this section.");
    } finally {
      if (alive.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void reload();
    return () => {
      alive.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const save = useCallback(
    async (action: () => Promise<unknown>, successMessage?: string) => {
      setSaving(true);
      try {
        await action();
        setError(null);
        await reload();
        return { ok: true as const, message: successMessage };
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : "That change did not save.";
        setError(message);
        return { ok: false as const, message };
      } finally {
        setSaving(false);
      }
    },
    [reload],
  );

  return { data, loading, error, saving, reload, save, setError };
}
