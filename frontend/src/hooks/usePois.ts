import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useDebounced } from "@/hooks/useDebounced";
import {
  fetchCategories, fetchMapPoints, fetchPoi, fetchPois,
  type CategoryCount, type PoiDetail, type PoiFeatureCollection, type PoiItem, type PoiQuery,
} from "@/services/pois";
import { useExplore } from "@/stores/explore";

const PAGE = 20;

/** Current filters as an API query; search is debounced so typing does not spam the backend. */
export function usePoiQuery(): PoiQuery {
  const { categories, search, origin, radiusKm } = useExplore();
  const debouncedSearch = useDebounced(search);
  const debouncedRadius = useDebounced(radiusKm, 300);
  const lat = origin?.lat;
  const lon = origin?.lon;
  return useMemo(
    () => ({
      categories,
      search: debouncedSearch,
      origin: lat !== undefined && lon !== undefined ? { lat, lon } : null,
      radiusKm: debouncedRadius,
    }),
    [categories, debouncedSearch, lat, lon, debouncedRadius],
  );
}

type Async<T> = { data: T | null; loading: boolean; error: boolean };

function useAsync<T>(fn: (signal: AbortSignal) => Promise<T>, deps: unknown[]): Async<T> & { reload: () => void } {
  const [state, setState] = useState<Async<T>>({ data: null, loading: true, error: false });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    const ctrl = new AbortController();
    setState((s) => ({ ...s, loading: true, error: false }));
    fn(ctrl.signal)
      .then((data) => setState({ data, loading: false, error: false }))
      .catch((e) => {
        if (e?.name !== "AbortError") setState({ data: null, loading: false, error: true });
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);
  return { ...state, reload: () => setNonce((n) => n + 1) };
}

export function useCategories() {
  const { i18n } = useTranslation();
  return useAsync<CategoryCount[]>(() => fetchCategories(i18n.language), [i18n.language]);
}

export function useMapPoints(q: PoiQuery) {
  const { i18n } = useTranslation();
  return useAsync<PoiFeatureCollection>((s) => fetchMapPoints(q, i18n.language, s), [q, i18n.language]);
}

export function usePoiDetail(id: number | null, origin: PoiQuery["origin"]) {
  const { i18n } = useTranslation();
  return useAsync<PoiDetail | null>(
    (s) => (id === null ? Promise.resolve(null) : fetchPoi(id, i18n.language, origin, s)),
    [id, i18n.language, origin?.lat, origin?.lon],
  );
}

/** Paginated list; changing filters or language restarts from page one. */
export function usePoiList(q: PoiQuery) {
  const { i18n } = useTranslation();
  const [items, setItems] = useState<PoiItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [nonce, setNonce] = useState(0);

  const load = useCallback(
    (offset: number, signal?: AbortSignal) => {
      setLoading(true);
      setError(false);
      return fetchPois(q, i18n.language, offset, PAGE, signal)
        .then((r) => {
          setItems((prev) => (offset === 0 ? r.items : [...prev, ...r.items]));
          setTotal(r.total);
          setLoading(false);
        })
        .catch((e) => {
          if (e?.name === "AbortError") return;
          setError(true);
          setLoading(false);
        });
    },
    [q, i18n.language],
  );

  useEffect(() => {
    const ctrl = new AbortController();
    load(0, ctrl.signal);
    return () => ctrl.abort();
  }, [load, nonce]);

  return {
    items, total, loading, error,
    loadMore: () => load(items.length),
    reload: () => setNonce((n) => n + 1),
  };
}
