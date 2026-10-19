import { useCallback, useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { QrCode, CalendarDays, Clock, ArrowUpRight, RefreshCw } from "lucide-react";
import { api, type Booking } from "../api.js";
import { useResource } from "../hooks/use-resource.js";
import { PageHead, ErrorNotice, Loading } from "../components/ui/page.js";
import { Button } from "../components/ui/button.js";
import { Input, Label } from "../components/ui/input.js";
import { MembershipStateBadge } from "../components/ui/badge.js";
import { CreditPeriods } from "../components/CreditPeriods.js";
import { MemberQr } from "../components/MemberQr.js";
import { Confirm } from "../components/ui/confirm.js";
export function Portal() {
  const loader = useCallback(() => api.portalOverview(), []);
  const { data, error, loading, reload } = useResource(loader);
  const scheduleLoader = useCallback(
    async () => ({ sessions: await api.schedule(), bookings: await api.myBookings() }),
    [],
  );
  const schedule = useResource(scheduleLoader);
  const [qr, setQr] = useState(""),
    [qrError, setQrError] = useState<string | null>(null),
    [busy, setBusy] = useState<string | null>(null),
    [cancel, setCancel] = useState<Booking | null>(null),
    [rotate, setRotate] = useState(false),
    [email, setEmail] = useState(""),
    [contactOpen, setContactOpen] = useState(false);
  const loadQr = useCallback(async () => {
    setQrError(null);
    try {
      setQr((await api.myQr()).qrToken);
    } catch (e) {
      setQr("");
      setQrError(e instanceof Error ? e.message : "No se pudo cargar tu QR");
    }
  }, []);
  useEffect(() => {
    void loadQr();
  }, [loadQr]);
  async function reserve(id: string) {
    if (busy) return;
    setBusy(id);
    try {
      await api.createBooking({ sessionId: id });
      toast.success("Reserva confirmada");
      await Promise.all([schedule.reload(), reload()]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo reservar");
    } finally {
      setBusy(null);
    }
  }
  async function cancelBooking() {
    if (!cancel) return;
    setBusy(cancel.id);
    try {
      await api.cancelBooking(cancel.id, { type: "temprana" });
      toast.success("Reserva cancelada");
      setCancel(null);
      await Promise.all([schedule.reload(), reload()]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo cancelar");
    } finally {
      setBusy(null);
    }
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!data) return;
    setBusy("contact");
    try {
      if (email.trim()) {
        await api.requestContactVerification(data.member.id, email.trim());
        toast.success("Verificación solicitada. El contacto cambiará al confirmar el enlace.");
      } else {
        await api.updateContact(data.member.id, null);
        toast.success("Contacto eliminado");
      }
      setContactOpen(false);
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setBusy(null);
    }
  }
  const bookings = new Map(
    (schedule.data?.bookings ?? [])
      .filter((b) => b.state === "confirmada")
      .map((b) => [b.sessionId, b]),
  );
  const upcoming = (schedule.data?.sessions ?? []).filter(
    (s) => s.state === "programada" && s.type !== "bloqueo" && new Date(s.startsAt) > new Date(),
  );
  const mine = upcoming.filter((s) => bookings.has(s.id));
  const active = data?.memberships.find((m) => m.state === "active");
  return (
    <section>
      <PageHead
        eyebrow={
          data?.member.fullName ? `Hola, ${data.member.fullName.split(" ")[0]}` : "Tu gimnasio"
        }
        title="Mi acceso"
        description="Tu QR, tu membresía y tu próxima clase, siempre a mano."
      />
      <ErrorNotice message={error} retry={() => void reload()} />
      {loading && !data ? (
        <Loading />
      ) : (
        <div className="grid gap-6 md:grid-cols-[20rem_1fr]">
          <div className="space-y-5">
            <article className="rounded-2xl border bg-card p-6 text-center">
              <div className="mb-4 flex items-center justify-center gap-2 text-sm font-semibold">
                <QrCode className="h-4 w-4" />
                Mi QR de ingreso
              </div>
              <ErrorNotice message={qrError} retry={() => void loadQr()} />
              {qr && <MemberQr token={qr} />}
              <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
                Muestra este código en recepción. El ingreso depende de tu cobertura vigente.
              </p>
              <Button variant="ghost" size="sm" className="mt-3" onClick={() => setRotate(true)}>
                <RefreshCw className="h-3 w-3" />
                Renovar mi código
              </Button>
            </article>
            <CreditPeriods periods={data?.creditPeriods ?? []} />
            <article className="rounded-2xl border bg-card p-6">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Mi membresía
              </p>
              {active ? (
                <>
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <h2 className="font-semibold">{active.plan.name}</h2>
                    <MembershipStateBadge state="active" />
                  </div>
                  {active.activePause && (
                    <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">
                      <p className="font-semibold">Membresía pausada (pausa activa)</p>
                      <p className="mt-1">
                        Hasta el {new Date(active.activePause.endsAt).toLocaleDateString("es-CL")}{" "}
                        ({active.activePause.extendedDays} días extendidos).
                      </p>
                      <p className="mt-1 italic">{active.activePause.reason}</p>
                    </div>
                  )}
                  {active.nextPlan && (
                    <div className="mt-3 rounded-lg border border-primary/30 bg-primary/10 p-3 text-xs">
                      <p className="font-semibold text-primary">Cambio de plan programado</p>
                      <p className="mt-1">
                        Próxima renovación cambiará a:{" "}
                        <span className="font-medium">{active.nextPlan.name}</span>
                      </p>
                    </div>
                  )}
                  <p className="mt-3 text-sm text-muted-foreground">
                    Vigente hasta {new Date(active.endAt!).toLocaleDateString("es-CL")}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {active.plan.coverage === "unlimited"
                      ? "Cobertura ilimitada"
                      : active.plan.coverage === "limited"
                        ? "Cobertura limitada"
                        : "Sin cobertura de ingreso"}
                  </p>
                </>
              ) : (
                <p className="mt-3 text-sm">
                  {data?.memberships.length
                    ? "Tu membresía requiere revisión o renovación en recepción."
                    : "Solicita un plan en recepción para comenzar."}
                </p>
              )}
              {data?.memberships
                .filter((m) => m.id !== active?.id)
                .map((m) => (
                  <div
                    key={m.id}
                    className="mt-4 flex items-center justify-between border-t pt-3 text-xs"
                  >
                    <span>{m.plan.name}</span>
                    <MembershipStateBadge state={m.state ?? "pending_payment"} />
                  </div>
                ))}
            </article>
            <article className="rounded-2xl border bg-card p-6">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">Mi contacto</h2>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setEmail(data?.member.contactEmail ?? "");
                    setContactOpen(!contactOpen);
                  }}
                >
                  Editar
                </Button>
              </div>
              <p className="mt-2 break-all text-sm text-muted-foreground">
                {data?.member.contactEmail ?? "Sin email de contacto"}
              </p>
              {contactOpen && (
                <form className="mt-4 space-y-3" onSubmit={save}>
                  <Label htmlFor="portal-email">Email de contacto</Label>
                  <Input
                    id="portal-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    El nuevo correo requiere verificación. Tu email de inicio de sesión se mantiene.
                  </p>
                  <Button type="submit" size="sm" disabled={busy !== null}>
                    {email.trim() ? "Solicitar verificación" : "Eliminar contacto"}
                  </Button>
                </form>
              )}
            </article>
          </div>
          <div className="space-y-6">
            <article className="rounded-2xl border bg-card p-6">
              <h2 className="flex items-center gap-2 text-lg font-semibold">
                <CalendarDays className="h-5 w-5 text-primary" />
                Mis próximas clases
              </h2>
              {schedule.error ? (
                <ErrorNotice message={schedule.error} retry={() => void schedule.reload()} />
              ) : schedule.loading && !schedule.data ? (
                <Loading />
              ) : mine.length ? (
                mine.map((s) => (
                  <div
                    key={s.id}
                    className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4"
                  >
                    <div>
                      <p className="font-medium">{s.title}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{s.instructorName}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {new Date(s.startsAt).toLocaleString("es-CL", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy !== null}
                      onClick={() => setCancel(bookings.get(s.id)!)}
                    >
                      Cancelar reserva
                    </Button>
                  </div>
                ))
              ) : (
                <p className="mt-5 text-sm text-muted-foreground">
                  Todavía no tienes reservas próximas. Elige una clase abajo.
                </p>
              )}
            </article>
            <article className="rounded-2xl border bg-card p-6">
              <h2 className="text-lg font-semibold">Encuentra tu próxima clase</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Reserva tu lugar. La cobertura y el cupo se verifican al confirmar.
              </p>
              {schedule.error ? (
                <ErrorNotice message={schedule.error} />
              ) : (
                <div className="mt-5 divide-y">
                  {upcoming
                    .filter((s) => !bookings.has(s.id))
                    .map((s) => (
                      <div
                        key={s.id}
                        className="flex flex-wrap items-center justify-between gap-3 py-5"
                      >
                        <div>
                          <p className="font-semibold">{s.title}</p>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {s.instructorName} ·{" "}
                            {s.type === "cita"
                              ? "Personalizada"
                              : s.type === "fija"
                                ? "Personalizada fija"
                                : "Grupal"}
                          </p>
                          <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            {new Date(s.startsAt).toLocaleString("es-CL", {
                              dateStyle: "medium",
                              timeStyle: "short",
                            })}{" "}
                            · {s.remaining} plazas
                          </p>
                        </div>
                        <Button
                          size="sm"
                          disabled={busy !== null || s.remaining === 0}
                          onClick={() => void reserve(s.id)}
                        >
                          {busy === s.id
                            ? "Reservando…"
                            : s.remaining === 0
                              ? "Completa"
                              : "Reservar"}
                          <ArrowUpRight className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                  {upcoming.length === 0 && !schedule.loading && (
                    <p className="py-5 text-sm text-muted-foreground">
                      No hay clases publicadas próximamente.
                    </p>
                  )}
                </div>
              )}
            </article>
          </div>
        </div>
      )}
      <Confirm
        open={cancel !== null}
        onOpenChange={(o) => !o && setCancel(null)}
        title="Cancelar reserva"
        description="La política de cancelación de la clase determina si se devuelve el beneficio. Tu plaza se libera al confirmar."
        onConfirm={() => void cancelBooking()}
        busy={busy !== null}
        label="Confirmar cancelación"
        destructive
      />
      <Confirm
        open={rotate}
        onOpenChange={setRotate}
        title="Renovar mi QR"
        description="Tu código anterior dejará de funcionar. Usa el nuevo código en recepción."
        onConfirm={() => {
          setBusy("qr");
          void api
            .rotateQr()
            .then((r) => {
              setQr(r.qrToken);
              setQrError(null);
              setRotate(false);
            })
            .catch((e) => toast.error(e.message))
            .finally(() => setBusy(null));
        }}
        busy={busy === "qr"}
      />
    </section>
  );
}
