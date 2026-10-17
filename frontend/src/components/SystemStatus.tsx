import { CheckCircle2, Loader2, RefreshCw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useHealth } from "@/hooks/useHealth";

function Row({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 text-sm">
      <span className="flex items-center gap-2">
        {ok ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
        ) : (
          <XCircle className="h-4 w-4 text-red-500" />
        )}
        {label}
      </span>
      <span className="font-mono text-muted-foreground">{value}</span>
    </div>
  );
}

export function SystemStatus() {
  const { state, refresh } = useHealth();

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div className="space-y-1.5">
          <CardTitle>System status</CardTitle>
          <CardDescription>Live response from the backend /api/health.</CardDescription>
        </div>
        <Button variant="ghost" size="icon" onClick={refresh} aria-label="Refresh status">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="divide-y">
        {state.phase === "loading" && (
          <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Checking…
          </div>
        )}
        {state.phase === "unreachable" && <Row label="Backend API" value={state.message} ok={false} />}
        {state.phase === "done" && (
          <>
            <Row label="Backend API" value={`v${state.data.version} · ${state.data.environment}`} ok />
            <Row
              label="PostgreSQL"
              value={state.data.database.connected ? state.data.database.version ?? "connected" : "unavailable"}
              ok={state.data.database.connected}
            />
            <Row
              label="PostGIS"
              value={state.data.database.postgis ?? "missing"}
              ok={!!state.data.database.postgis}
            />
            <Row
              label="pgvector"
              value={state.data.database.pgvector ?? "missing"}
              ok={!!state.data.database.pgvector}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}
