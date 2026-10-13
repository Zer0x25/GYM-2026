/**
 * Mostrador de recepción (spec 009, surface Operate).
 *
 * La pantalla de acción del recepcionista: escaneo de QR de ingreso con
 * respuesta inmediata (permitido/denegado por cobertura) + feed de ingresos
 * en vivo. NO es un dashboard de navegación — es una superficie de una sola
 * acción dominante, pensada para alguien de pie y apurado.
 *
 * Reglas (ADR-0003 / ADR-0002):
 *  - La UI NUNCA autoriza: el backend re-valida cada check-in. allowed:false
 *    es una decisión de negocio (cobertura), no un error de transporte.
 *  - Cross-tenant / token desconocido → 404 real (ApiError status 404).
 *  - Color reservado para estado: verde ingresó, rojo denegado, ámbar aviso.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { QrCode, RefreshCw } from "lucide-react";
import { ApiError, api, type CheckinFeedEntry, type CheckinResult } from "../api.js";
import { Button } from "../components/ui/button.js";
import { Input } from "../components/ui/input.js";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "../components/ui/dialog.js";
import { cn } from "../lib/cn.js";

/** Resultado del último escaneo, para el modal. null = aún no se escaneó. */
type ScanState =
  | { kind: "idle" }
  | { kind: "allowed"; result: CheckinResult }
  | { kind: "denied"; result: CheckinResult }
  | { kind: "unknown"; message: string };

export function Mostrador() {
  const [token, setToken] = useState("");
  const [scan, setScan] = useState<ScanState>({ kind: "idle" });
  const [feed, setFeed] = useState<CheckinFeedEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Poll the live feed (mostrador view). A real deployment would swap this
  // for a websocket/SSE; polling keeps it dependency-free for now.
  const loadFeed = useCallback(async () => {
    try {
      setFeed(await api.recentCheckins(50));
    } catch {
      /* transient: keep the last known feed */
    }
  }, []);

  useEffect(() => {
    void loadFeed();
    const t = setInterval(() => void loadFeed(), 8000);
    return () => clearInterval(t);
  }, [loadFeed]);

  async function doScan(qrToken: string) {
    const value = qrToken.trim();
    if (!value) return;
    setBusy(true);
    try {
      const result = await api.checkin(value);
      setScan(result.allowed ? { kind: "allowed", result } : { kind: "denied", result });
      setToken("");
      void loadFeed();
      inputRef.current?.focus();
    } catch (e) {
      // 404 = token unknown or from another tenant (anti-enumeration). The
      // receptionist sees a neutral message; no existence leak.
      if (e instanceof ApiError && e.status === 404) {
        setScan({ kind: "unknown", message: "QR no reconocido" });
      } else {
        setScan({
          kind: "unknown",
          message: e instanceof ApiError ? e.message : "No se pudo validar el ingreso",
        });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto max-w-3xl" aria-labelledby="mostrador-title">
      <div className="mb-6">
        <h1 id="mostrador-title" className="text-2xl font-bold tracking-tight">
          Ingreso y cobro
        </h1>
        <p className="text-sm text-muted-foreground">
          Escaneá el QR del socio para validar su ingreso, o buscalo a mano.
        </p>
      </div>

      {/* Zona de escaneo: la acción dominante del mostrador */}
      <form
        className="rounded-xl border-2 border-dashed border-border bg-card p-8 text-center transition-colors focus-within:border-primary"
        onSubmit={(e) => {
          e.preventDefault();
          void doScan(token);
        }}
      >
        <QrCode className="mx-auto mb-3 h-12 w-12 text-muted-foreground" aria-hidden />
        <p className="text-lg font-semibold">Escanear QR de ingreso</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Apuntá la lectora al código del socio — valida cobertura al instante.
        </p>
        <div className="mx-auto mt-4 flex max-w-md gap-2">
          <Input
            ref={inputRef}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Token del QR o nombre del socio…"
            aria-label="Token de QR"
            autoFocus
          />
          <Button type="submit" disabled={busy || !token.trim()}>
            {busy ? "Validando…" : "Validar"}
          </Button>
        </div>
      </form>

      {/* Feed de ingresos en vivo */}
      <div className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Ingresos de hoy
          </h2>
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-success">
              <span className="h-2 w-2 animate-pulse rounded-full bg-success" aria-hidden />
              EN VIVO
            </span>
            <Button variant="ghost" size="sm" onClick={() => void loadFeed()} aria-label="Actualizar">
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="divide-y divide-border rounded-xl border bg-card">
          {feed.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">
              Sin ingresos registrados todavía.
            </p>
          ) : (
            feed.map((entry) => (
              <div key={entry.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{entry.fullName}</p>
                  <p className="text-xs text-muted-foreground">
                    {entry.detail ?? "—"} · {new Date(entry.at).toLocaleTimeString("es-CL")}
                  </p>
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold",
                    entry.outcome === "ok"
                      ? "bg-success/10 text-success"
                      : "bg-destructive/10 text-destructive",
                  )}
                >
                  {entry.outcome === "ok" ? "Ingresó" : "Denegado"}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Respuesta de escaneo: permitido / denegado / desconocido */}
      <Dialog open={scan.kind !== "idle"} onOpenChange={(o) => !o && setScan({ kind: "idle" })}>
        <DialogContent className="max-w-sm text-center">
          {scan.kind === "allowed" && (
            <>
              <DialogHeader>
                <div className="mx-auto mb-2 grid h-16 w-16 place-items-center rounded-full bg-success/10 text-3xl text-success">
                  ✓
                </div>
                <DialogTitle>{scan.result.member?.fullName}</DialogTitle>
                <DialogDescription>
                  Puede ingresar. {scan.result.membershipEndsAt
                    ? `Membresía vence el ${new Date(scan.result.membershipEndsAt).toLocaleDateString("es-CL")}.`
                    : ""}
                </DialogDescription>
              </DialogHeader>
            </>
          )}
          {scan.kind === "denied" && (
            <>
              <DialogHeader>
                <div className="mx-auto mb-2 grid h-16 w-16 place-items-center rounded-full bg-destructive/10 text-3xl text-destructive">
                  ✕
                </div>
                <DialogTitle>Ingreso denegado</DialogTitle>
                <DialogDescription>
                  {scan.result.reason ?? "Sin cobertura activa."} Ofrecele la renovación antes de
                  registrar el pago.
                </DialogDescription>
              </DialogHeader>
            </>
          )}
          {scan.kind === "unknown" && (
            <>
              <DialogHeader>
                <div className="mx-auto mb-2 grid h-16 w-16 place-items-center rounded-full bg-muted text-3xl text-muted-foreground">
                  ?
                </div>
                <DialogTitle>QR no reconocido</DialogTitle>
                <DialogDescription>{scan.message}</DialogDescription>
              </DialogHeader>
            </>
          )}
          <div className="mt-2 flex justify-center gap-2">
            <Button variant="ghost" onClick={() => setScan({ kind: "idle" })}>
              Cerrar
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <p className="mt-8 text-center text-xs text-muted-foreground">
        El backend es la autoridad: la interfaz nunca autoriza por sí sola.
      </p>
    </section>
  );
}
