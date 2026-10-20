import { useCallback } from "react";
import { Link } from "react-router-dom";
import {
  ArrowUpRight,
  CalendarDays,
  Users,
  ScanLine,
  Receipt,
  Wallet,
  Activity,
  ShieldCheck,
} from "lucide-react";
import { api, formatCLP } from "../api.js";
import { useResource } from "../hooks/use-resource.js";
import { PageHead, ErrorNotice, Loading, Stat } from "../components/ui/page.js";
import type { SystemStatusResponse } from "@gym/contracts";

export function Dashboard() {
  const loader = useCallback(async () => {
    const [members, memberships, payments, cash, schedule, systemStatus] = await Promise.all([
      api.listMembers(),
      api.listMemberships(),
      api.listPayments("provisional"),
      api.currentCashSession(),
      api.schedule(),
      api.systemStatus().catch(() => null as SystemStatusResponse | null),
    ]);
    return { members, memberships, payments, cash, schedule, systemStatus };
  }, []);
  const { data, error, loading, reload } = useResource(loader);
  const active = new Set(
    data?.memberships.filter((m) => m.state === "active").map((m) => m.memberId),
  );
  const next =
    data?.schedule
      .filter(
        (s) =>
          s.state === "programada" && s.type !== "bloqueo" && new Date(s.startsAt) > new Date(),
      )
      .slice(0, 5) ?? [];
  return (
    <section>
      <PageHead
        eyebrow="Administración"
        title="Tu gimnasio, hoy"
        description="Lo que necesita atención y las próximas actividades de tu equipo."
      />
      <ErrorNotice message={error} retry={() => void reload()} />
      {loading && !data ? (
        <Loading />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat
              label="Socios registrados"
              value={data?.members.length ?? 0}
              note="En tu organización"
            />
            <Stat
              label="Membresías activas"
              value={active.size}
              note="Socios con período vigente"
            />
            <Stat
              label="Pagos por revisar"
              value={data?.payments.length ?? 0}
              note={`${formatCLP(data?.payments.reduce((v, p) => v + p.amountCents, 0) ?? 0)} pendientes de decisión`}
            />
            <Stat
              label="Turno de caja"
              value={data?.cash ? "Abierto" : "Cerrado"}
              note={
                data?.cash
                  ? `Apertura ${formatCLP(data.cash.openingCents)}`
                  : "Abre un turno antes de validar pagos"
              }
            />
          </div>
          {data?.systemStatus && (
            <article className="mt-6 rounded-2xl border bg-card p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 font-semibold">
                  <ShieldCheck className="h-4 w-4 text-primary" />
                  Diagnóstico y controles de producción (G2)
                </h2>
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Activity className="h-3.5 w-3.5 text-emerald-500" />
                  Sonda DB: OK · Servidor: {new Date(data.systemStatus.serverTime).toLocaleTimeString("es-CL")}
                </span>
              </div>
              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-xl border bg-background/50 p-3">
                  <p className="text-xs font-medium text-muted-foreground">Menores (D-05)</p>
                  <p className="mt-1 text-sm font-semibold">
                    {data.systemStatus.minorPolicy.serverLocked
                      ? "Bloqueado en servidor"
                      : data.systemStatus.minorPolicy.enabled
                        ? "Habilitado"
                        : "Deshabilitado"}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {data.systemStatus.minorPolicy.orgEnabled ? "Org: permitida" : "Org: restringida"}
                  </p>
                </div>
                <div className="rounded-xl border bg-background/50 p-3">
                  <p className="text-xs font-medium text-muted-foreground">Entrega de correo</p>
                  <p className="mt-1 text-sm font-semibold">
                    {data.systemStatus.emailDelivery.mode === "configured"
                      ? "Configurado"
                      : "Deshabilitado"}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Reset: {data.systemStatus.emailDelivery.passwordReset ? "Sí" : "No"} · Verif: {data.systemStatus.emailDelivery.contactVerification ? "Sí" : "No"}
                  </p>
                </div>
                <div className="rounded-xl border bg-background/50 p-3">
                  <p className="text-xs font-medium text-muted-foreground">Contingencia offline (P-09.3)</p>
                  <p className="mt-1 text-sm font-semibold">
                    {data.systemStatus.offline.enabled ? "Habilitada" : "Deshabilitada"}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {data.systemStatus.offline.enabledDevicesCount} equipos ({data.systemStatus.offline.freshnessHours}h vigencia)
                  </p>
                </div>
                <div className="rounded-xl border bg-background/50 p-3">
                  <p className="text-xs font-medium text-muted-foreground">Acceso soporte (D-06)</p>
                  <p className="mt-1 text-sm font-semibold">
                    {data.systemStatus.supportAccess.activeGrantsCount} activas
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {data.systemStatus.supportAccess.activeGrantsCount > 0 ? "Concesión temporal vigente" : "Sin concesiones vigentes"}
                  </p>
                </div>
              </div>
            </article>
          )}
          <div className="mt-6 grid gap-6 lg:grid-cols-[1.5fr_1fr]">
            <article className="rounded-2xl border bg-card p-6">
              <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-2 font-semibold">
                  <CalendarDays className="h-4 w-4" />
                  Próximas sesiones
                </h2>
                <Link to="/clases" className="text-xs font-medium text-primary">
                  Ver agenda
                </Link>
              </div>
              <div className="mt-4 divide-y">
                {next.map((s) => (
                  <Link key={s.id} to={`/clases/${s.id}`} className="flex items-center gap-4 py-4">
                    <div className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-muted text-lg font-semibold">
                      {new Date(s.startsAt).getDate()}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium">{s.title}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {s.instructorName} ·{" "}
                        {new Date(s.startsAt).toLocaleString("es-CL", {
                          dateStyle: "short",
                          timeStyle: "short",
                        })}
                      </p>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {s.booked}/{s.capacity}
                    </span>
                    <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
                  </Link>
                ))}
                {next.length === 0 && (
                  <p className="py-6 text-sm text-muted-foreground">
                    No hay sesiones próximas. Publica la próxima actividad desde la agenda.
                  </p>
                )}
              </div>
            </article>
            <article className="rounded-2xl border bg-card p-6">
              <h2 className="font-semibold">Acciones de la jornada</h2>
              <div className="mt-4 space-y-2">
                {[
                  { to: "/payments", label: "Revisar pagos pendientes", icon: Receipt },
                  { to: "/cash", label: "Caja y conciliación", icon: Wallet },
                  { to: "/panel", label: "Gestionar socios", icon: Users },
                  { to: "/mostrador", label: "Atender en recepción", icon: ScanLine },
                ].map(({ to, label, icon: Icon }) => (
                  <Link
                    key={to}
                    to={to}
                    className="flex items-center gap-3 rounded-lg p-3 text-sm hover:bg-muted"
                  >
                    <Icon className="h-4 w-4 text-primary" />
                    <span className="flex-1">{label}</span>
                    <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
                  </Link>
                ))}
              </div>
            </article>
          </div>
        </>
      )}
    </section>
  );
}
