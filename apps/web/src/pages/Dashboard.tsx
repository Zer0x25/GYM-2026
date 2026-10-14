import { useCallback } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, CalendarDays, Users, ScanLine, Receipt, Wallet } from "lucide-react";
import { api, formatCLP } from "../api.js";
import { useResource } from "../hooks/use-resource.js";
import { PageHead, ErrorNotice, Loading, Stat } from "../components/ui/page.js";
export function Dashboard() {
  const loader = useCallback(async () => {
    const [members, memberships, payments, cash, schedule] = await Promise.all([
      api.listMembers(),
      api.listMemberships(),
      api.listPayments("provisional"),
      api.currentCashSession(),
      api.schedule(),
    ]);
    return { members, memberships, payments, cash, schedule };
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
