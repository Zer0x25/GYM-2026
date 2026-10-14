import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ScanLine,
  Search,
  ArrowUpRight,
  RefreshCw,
  CheckCircle2,
  XCircle,
  WifiOff,
} from "lucide-react";
import { ApiError, api, type CheckinFeedEntry, type CheckinResult, type Member } from "../api.js";
import { Button } from "../components/ui/button.js";
import { Input } from "../components/ui/input.js";
import { PageHead, ErrorNotice } from "../components/ui/page.js";

export function Mostrador() {
  const [token, setToken] = useState(""),
    [query, setQuery] = useState(""),
    [found, setFound] = useState<Member[]>([]),
    [selected, setSelected] = useState<Member | null>(null);
  const [feed, setFeed] = useState<CheckinFeedEntry[]>([]),
    [feedError, setFeedError] = useState(false),
    [updated, setUpdated] = useState<Date | null>(null),
    [result, setResult] = useState<CheckinResult | null>(null),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [searchBusy, setSearchBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const loadFeed = useCallback(async () => {
    try {
      setFeed(await api.recentCheckins(50));
      setUpdated(new Date());
      setFeedError(false);
    } catch {
      setFeedError(true);
    }
  }, []);
  useEffect(() => {
    void loadFeed();
    const id = setInterval(() => void loadFeed(), 8000);
    return () => clearInterval(id);
  }, [loadFeed]);
  useEffect(() => {
    let active = true;
    if (!query.trim()) {
      setFound([]);
      return;
    }
    setSearchBusy(true);
    const id = setTimeout(() => {
      void api
        .listMembers(query)
        .then((rows) => {
          if (active) setFound(rows);
        })
        .catch(() => {
          if (active) setError("No se pudieron buscar socios. Reintenta cuando haya conexión.");
        })
        .finally(() => {
          if (active) setSearchBusy(false);
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(id);
    };
  }, [query]);
  async function scan(memberId?: string) {
    if (busy || (!memberId && !token.trim())) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await (memberId ? api.checkinMember(memberId) : api.checkin(token.trim())));
      setToken("");
      void loadFeed();
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 404
          ? "QR no reconocido"
          : e instanceof ApiError
            ? e.message
            : "No se pudo validar el ingreso",
      );
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }
  return (
    <section>
      <PageHead
        eyebrow="Recepción"
        title="Mostrador"
        description="Identifica al socio, verifica su ingreso y resuelve lo que necesita."
        actions={
          <Link
            to="/panel"
            className="inline-flex items-center gap-2 rounded-lg border bg-card px-4 py-2 text-sm font-medium"
          >
            Ver socios
            <ArrowUpRight className="h-4 w-4" />
          </Link>
        }
      />
      <div className="grid gap-6 xl:grid-cols-[1.15fr_1fr]">
        <div className="space-y-5">
          <div className="rounded-2xl border bg-card p-6 sm:p-8">
            <div className="mb-5 flex items-center gap-3">
              <span className="rounded-xl bg-primary/10 p-3 text-primary">
                <ScanLine className="h-6 w-6" />
              </span>
              <div>
                <h2 className="font-semibold">Ingreso con QR</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Lectora física o token del código personal
                </p>
              </div>
            </div>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void scan();
              }}
            >
              <Input
                ref={inputRef}
                autoFocus
                value={token}
                onChange={(e) => setToken(e.target.value)}
                aria-label="Token de QR"
                placeholder="Escanea o pega el token"
              />
              <Button type="submit" disabled={busy || !token.trim()}>
                {busy ? "Validando…" : "Validar QR"}
              </Button>
            </form>
          </div>
          <div className="rounded-2xl border bg-card p-6">
            <div className="mb-4 flex items-center gap-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <h2 className="font-semibold">Buscar por nombre</h2>
            </div>
            <Input
              type="search"
              aria-label="Buscar socio por nombre"
              placeholder="Nombre o email del socio"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelected(null);
              }}
            />
            {query.trim() && !selected && (
              <div className="mt-3 max-h-56 overflow-y-auto">
                {searchBusy ? (
                  <p className="py-3 text-sm text-muted-foreground">Buscando…</p>
                ) : found.length ? (
                  found.slice(0, 10).map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      className="flex w-full items-center justify-between rounded-lg px-3 py-3 text-left hover:bg-muted"
                      onClick={() => {
                        setSelected(m);
                        setFound([]);
                        setError(null);
                        setResult(null);
                      }}
                    >
                      <span>
                        <span className="block text-sm font-medium">{m.fullName}</span>
                        <span className="text-xs text-muted-foreground">
                          {m.contactEmail ?? "Sin email de contacto"}
                        </span>
                      </span>
                      <ArrowUpRight className="h-4 w-4" />
                    </button>
                  ))
                ) : (
                  <p className="py-3 text-sm text-muted-foreground">
                    No encontramos socios con ese nombre.
                  </p>
                )}
              </div>
            )}
            {selected && (
              <div className="mt-4 rounded-lg bg-muted/40 p-4">
                <p className="font-semibold">{selected.fullName}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button disabled={busy} onClick={() => void scan(selected.id)}>
                    Validar ingreso
                  </Button>
                  <Link
                    to={`/panel/${selected.id}`}
                    className="inline-flex items-center rounded-md border bg-card px-3 py-2 text-sm"
                  >
                    Ficha y cobro
                    <ArrowUpRight className="ml-2 h-4 w-4" />
                  </Link>
                </div>
              </div>
            )}
          </div>
          <ErrorNotice message={error} />
          {result && (
            <div
              role="status"
              className={`rounded-2xl border p-6 ${result.allowed ? "border-success/30 bg-success/5" : "border-destructive/30 bg-destructive/5"}`}
            >
              <div className="flex items-start gap-3">
                {result.allowed ? (
                  <CheckCircle2 className="h-7 w-7 text-success" />
                ) : (
                  <XCircle className="h-7 w-7 text-destructive" />
                )}
                <div>
                  <h2 className="text-lg font-semibold">
                    {result.allowed
                      ? `${result.fullName ?? selected?.fullName ?? "Socio"}, puede ingresar`
                      : "Ingreso denegado"}
                  </h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {result.allowed
                      ? `Membresía vigente${result.membershipEndsAt ? ` hasta el ${new Date(result.membershipEndsAt).toLocaleDateString("es-CL")}` : ""}.`
                      : (result.reason ?? "Sin cobertura activa.")}
                  </p>
                  {!result.allowed && (selected || result.memberId) && (
                    <Link
                      className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-primary"
                      to={`/panel/${selected?.id ?? result.memberId}`}
                    >
                      Revisar membresía y renovación
                      <ArrowUpRight className="h-4 w-4" />
                    </Link>
                  )}
                </div>
              </div>
            </div>
          )}
          <Link
            to="/contingencia"
            className="flex items-center justify-between rounded-xl border border-dashed p-4 text-sm text-muted-foreground"
          >
            <span className="flex items-center gap-2">
              <WifiOff className="h-4 w-4" />
              Preparar contingencia sin conexión
            </span>
            <ArrowUpRight className="h-4 w-4" />
          </Link>
        </div>
        <div className="rounded-2xl border bg-card">
          <div className="flex items-center justify-between border-b p-5">
            <div>
              <h2 className="font-semibold">Ingresos de hoy</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {updated
                  ? `Última actualización ${updated.toLocaleTimeString("es-CL")}`
                  : "Conectando con recepción…"}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              aria-label="Actualizar ingresos"
              onClick={() => void loadFeed()}
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
          {feedError && (
            <p role="alert" className="border-b bg-warning/10 p-4 text-xs text-foreground">
              No se pudieron actualizar los ingresos. Los datos pueden estar desactualizados.
            </p>
          )}
          <div className="max-h-[38rem] divide-y overflow-y-auto">
            {feed.map((entry) => (
              <div key={entry.id} className="flex items-center gap-3 p-5">
                <span
                  className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-semibold ${entry.outcome === "ok" ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}
                >
                  {entry.fullName.charAt(0)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{entry.fullName}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {entry.detail ?? "Ingreso supervisado"} ·{" "}
                    {new Date(entry.at).toLocaleTimeString("es-CL")}
                  </p>
                </div>
                <span
                  className={`text-xs font-medium ${entry.outcome === "ok" ? "text-success" : "text-destructive"}`}
                >
                  {entry.outcome === "ok" ? "Ingresó" : "Denegado"}
                </span>
              </div>
            ))}
            {feed.length === 0 && (
              <div className="p-12 text-center">
                <ScanLine className="mx-auto mb-3 h-8 w-8 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">
                  {feedError
                    ? "Información no disponible."
                    : "Aún no hay ingresos registrados hoy."}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
