import { useCallback, useEffect, useState } from "react";
import { getHealth, type HealthResponse } from "@/services/api";

type State =
  | { phase: "loading" }
  | { phase: "done"; data: HealthResponse }
  | { phase: "unreachable"; message: string };

export function useHealth() {
  const [state, setState] = useState<State>({ phase: "loading" });

  const refresh = useCallback(() => {
    setState({ phase: "loading" });
    getHealth()
      .then((data) => setState({ phase: "done", data }))
      .catch((e: Error) => setState({ phase: "unreachable", message: e.message }));
  }, []);

  useEffect(refresh, [refresh]);
  return { state, refresh };
}
