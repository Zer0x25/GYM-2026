import { paymentMethodLabel } from "../lib/payment-method.js";
import { CreditPeriods } from "../components/CreditPeriods.js";
import { useCallback, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Banknote, ArrowLeft, Plus } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { api, formatCLP, type Payment } from "../api.js";
import { useSession } from "../session.js";
import { useResource } from "../hooks/use-resource.js";
import { PageHead, ErrorNotice, Loading, Select } from "../components/ui/page.js";
import { Button } from "../components/ui/button.js";
import { Input, Label } from "../components/ui/input.js";
import { MembershipStateBadge, PaymentStateBadge } from "../components/ui/badge.js";
import { DataTable } from "../components/ui/data-table.js";
import { QuickPay } from "../components/QuickPay.js";
import { Confirm } from "../components/ui/confirm.js";
import { MemberQr } from "../components/MemberQr.js";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "../components/ui/dialog.js";
export function MemberDetail() {
  const { id = "" } = useParams();
  const { session } = useSession();
  const loader = useCallback(async () => {
    const [profile, plans] = await Promise.all([api.memberOverview(id), api.listPlans()]);
    return { profile, plans };
  }, [id]);
  const { data, error, loading, reload } = useResource(loader);
  const [planId, setPlanId] = useState(""),
    [pay, setPay] = useState(false),
    [busy, setBusy] = useState(false),
    [qrAction, setQrAction] = useState<"revoke" | "reissue" | null>(null),
    [qr, setQr] = useState(""),
    [contact, setContact] = useState(""),
    [consentRef, setConsentRef] = useState(""),
    [pauseOpen, setPauseOpen] = useState(false),
    [pauseMembershipId, setPauseMembershipId] = useState<string | null>(null),
    [pauseReason, setPauseReason] = useState(""),
    [pauseStarts, setPauseStarts] = useState(""),
    [pauseEnds, setPauseEnds] = useState(""),
    [pauseError, setPauseError] = useState<string | null>(null),
    [scheduleOpen, setScheduleOpen] = useState(false),
    [scheduleMembershipId, setScheduleMembershipId] = useState<string | null>(null),
    [scheduleNextPlanId, setScheduleNextPlanId] = useState(""),
    [scheduleError, setScheduleError] = useState<string | null>(null);
  async function assign() {
    if (!planId) return;
    setBusy(true);
    try {
      await api.createMembership({ memberId: id, planId });
      toast.success("Plan asignado, pendiente de pago");
      await reload();
      setPay(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo asignar");
    } finally {
      setBusy(false);
    }
  }
  async function qrChange() {
    setBusy(true);
    try {
      if (qrAction === "revoke") {
        await api.revokeQr(id);
        setQr("");
        toast.success("QR revocado");
      } else {
        setQr((await api.reissueQr(id)).qrToken);
        toast.success("Nuevo QR emitido");
      }
      setQrAction(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo cambiar el QR");
    } finally {
      setBusy(false);
    }
  }
  const columns: ColumnDef<Payment>[] = [
    {
      accessorKey: "createdAt",
      header: "Fecha",
      cell: ({ getValue }) => new Date(getValue() as string).toLocaleDateString("es-CL"),
    },
    {
      accessorKey: "amountCents",
      header: "Monto",
      cell: ({ getValue }) => formatCLP(getValue() as number),
    },
    {
      accessorKey: "method",
      header: "Método",
      cell: ({ getValue }) => paymentMethodLabel(getValue()),
    },
    {
      accessorKey: "state",
      header: "Estado",
      cell: ({ row }) => <PaymentStateBadge state={row.original.state} />,
    },
    {
      accessorKey: "reference",
      header: "Referencia",
      cell: ({ getValue }) => String(getValue() ?? "—"),
    },
    {
      accessorKey: "comment",
      header: "Comentario",
      cell: ({ getValue }) => String(getValue() ?? "—"),
    },
  ];
  if (loading && !data) return <Loading />;
  if (!data) return <ErrorNotice message={error} retry={() => void reload()} />;
  const { profile, plans } = data;
  return (
    <section>
      <Link
        to="/panel"
        className="mb-5 inline-flex items-center gap-2 text-sm text-muted-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Todos los socios
      </Link>
      <PageHead
        eyebrow={profile.member.isMinor ? "Ficha del socio (Menor)" : "Ficha del socio"}
        title={profile.member.fullName}
        description={`${profile.member.contactEmail ?? "Sin email de contacto"} · alta ${new Date(profile.member.createdAt).toLocaleDateString("es-CL")}`}
        actions={
          <Button disabled={profile.memberships.length === 0} onClick={() => setPay(true)}>
            <Banknote className="h-4 w-4" />
            Registrar cobro
          </Button>
        }
      />
      <ErrorNotice message={error} />
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-6">
          <CreditPeriods periods={profile.creditPeriods ?? []} />
          <div className="rounded-2xl border bg-card p-6">
            <h2 className="mb-4 font-semibold">Membresías y cobertura</h2>
            {profile.memberships.map((m) => (
              <div
                key={m.id}
                className="flex flex-wrap items-center justify-between gap-3 border-t py-4"
              >
                <div>
                  <p className="font-medium">{m.plan.name}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {formatCLP(m.plan.priceCents)} · {m.plan.durationDays} días
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {m.endAt
                      ? `Vence el ${new Date(m.endAt).toLocaleDateString("es-CL")}`
                      : "El período comienza al validar el primer pago."}
                  </p>
                  {(m.cyclePaidCents ?? 0) > 0 && (
                    <p className="mt-1 text-xs font-medium text-amber-600 dark:text-amber-400">
                      Abono: {formatCLP(m.cyclePaidCents!)} pagado / {formatCLP(m.cycleRemainingCents ?? (m.plan.priceCents - m.cyclePaidCents!))} pendiente
                    </p>
                  )}
                  {m.nextPlan && (
                    <p className="mt-1 text-xs font-medium text-primary">
                      Próximo plan programado: {m.nextPlan.name}
                    </p>
                  )}
                  {m.activePause && (
                    <p className="mt-1 text-xs font-medium text-amber-600 dark:text-amber-400">
                      Pausa activa hasta {new Date(m.activePause.endsAt).toLocaleDateString("es-CL")}{" "}
                      ({m.activePause.reason})
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <MembershipStateBadge state={m.state ?? "pending_payment"} />
                  {session?.role === "admin" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setPauseMembershipId(m.id);
                        setPauseOpen(true);
                      }}
                    >
                      Pausar
                    </Button>
                  )}
                  {(session?.role === "admin" || session?.role === "recepcion") && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setScheduleMembershipId(m.id);
                        setScheduleNextPlanId(m.nextPlanId ?? "");
                        setScheduleOpen(true);
                      }}
                    >
                      Programar cambio
                    </Button>
                  )}
                </div>
              </div>
            ))}
            {profile.memberships.length === 0 && (
              <p className="py-4 text-sm text-muted-foreground">Asigna un plan para comenzar.</p>
            )}
            <div className="mt-4 flex items-end gap-3 border-t pt-5">
              <div className="flex-1">
                <Select
                  id="assign-plan"
                  label="Asignar plan"
                  value={planId}
                  onChange={(e) => setPlanId(e.target.value)}
                >
                  <option value="">Selecciona un plan</option>
                  {plans
                    .filter((p) => p.active)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} · {formatCLP(p.priceCents)}
                      </option>
                    ))}
                </Select>
              </div>
              <Button disabled={!planId || busy} onClick={() => void assign()}>
                <Plus className="h-4 w-4" />
                Asignar
              </Button>
            </div>
          </div>
          <div>
            <h2 className="mb-4 font-semibold">Historial de pagos</h2>
            <DataTable data={profile.payments} columns={columns} empty="Sin pagos registrados." />
          </div>
        </div>
        <aside className="space-y-5">
          <div className="rounded-2xl border bg-card p-5">
            <h2 className="font-semibold">Contacto</h2>
            {profile.member.isMinor && (
              <div className="mt-3 rounded-lg bg-muted/60 p-3 text-xs space-y-1">
                <p className="font-medium text-foreground">Socio menor de edad</p>
                <p className="text-muted-foreground">
                  Adulto responsable:{" "}
                  <span className="font-semibold text-foreground">
                    {profile.member.adultResponsibleName ?? "Sin asignar"}
                  </span>
                </p>
                <p className="text-muted-foreground">
                  Consentimiento D-05:{" "}
                  <span className="font-semibold text-foreground">
                    {profile.member.guardianConsentRef ?? "Sin acta registrada"}
                  </span>
                  {profile.member.guardianConsentAt && (
                    <span className="ml-1 text-muted-foreground">
                      (sellado el{" "}
                      {new Date(profile.member.guardianConsentAt).toLocaleDateString("es-CL")})
                    </span>
                  )}
                </p>
                {(session?.role === "admin" || session?.role === "recepcion") && (
                  <form
                    className="mt-3 space-y-2 border-t pt-2"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (!consentRef.trim()) return;
                      setBusy(true);
                      try {
                        await api.updateMember(id, { guardianConsentRef: consentRef.trim() });
                        toast.success("Consentimiento D-05 actualizado");
                        setConsentRef("");
                        await reload();
                      } catch (err) {
                        toast.error(
                          err instanceof Error ? err.message : "Error al actualizar consentimiento",
                        );
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    <Label htmlFor="consent-edit" className="text-xs">
                      Actualizar acta/folio de consentimiento (D-05)
                    </Label>
                    <div className="flex gap-2">
                      <Input
                        id="consent-edit"
                        placeholder={profile.member.guardianConsentRef ?? "ej. ACTA-2026-0042"}
                        value={consentRef}
                        onChange={(e) => setConsentRef(e.target.value)}
                        className="h-8 text-xs"
                      />
                      <Button
                        type="submit"
                        size="sm"
                        variant="outline"
                        disabled={busy || !consentRef.trim()}
                      >
                        Guardar
                      </Button>
                    </div>
                  </form>
                )}
              </div>
            )}
            <form
              className="mt-4 space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                setBusy(true);
                void api
                  .updateContact(id, contact.trim() || null)
                  .then(() => {
                    toast.success("Contacto actualizado");
                    void reload();
                  })
                  .catch((e) => toast.error(e.message))
                  .finally(() => setBusy(false));
              }}
            >
              <Label htmlFor="contact-edit">Nuevo email de contacto</Label>
              <Input
                id="contact-edit"
                type="email"
                value={contact}
                placeholder={profile.member.contactEmail ?? "email@ejemplo.cl"}
                onChange={(e) => setContact(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                No cambia el email de inicio de sesión.
              </p>
              <Button type="submit" variant="outline" disabled={busy}>
                Actualizar contacto
              </Button>
            </form>
          </div>
          {session?.role === "admin" && (
            <div className="rounded-2xl border bg-card p-5">
              <h2 className="font-semibold">Código de ingreso</h2>
              <p className="my-3 text-xs leading-relaxed text-muted-foreground">
                Emite un nuevo QR si el socio perdió o compartió su código. El anterior deja de
                funcionar.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => setQrAction("reissue")}>
                  Emitir nuevo QR
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setQrAction("revoke")}>
                  Revocar QR
                </Button>
              </div>
              {qr && (
                <div className="mt-4">
                  <MemberQr token={qr} />
                </div>
              )}
            </div>
          )}
        </aside>
      </div>
      <QuickPay
        open={pay}
        onOpenChange={setPay}
        memberName={profile.member.fullName}
        memberships={profile.memberships}
        plans={plans}
        onDone={() => void reload()}
      />
      <Confirm
        open={qrAction !== null}
        onOpenChange={(o) => !o && setQrAction(null)}
        title={qrAction === "revoke" ? "Revocar QR" : "Emitir nuevo QR"}
        description="El código anterior dejará de funcionar. La membresía y los pagos se conservan."
        busy={busy}
        onConfirm={() => void qrChange()}
        destructive={qrAction === "revoke"}
      />
      <Dialog open={pauseOpen} onOpenChange={setPauseOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pausar membresía</DialogTitle>
            <DialogDescription>
              La pausa extiende la vigencia por los días pausados y cancela reservas futuras en ese
              intervalo restituyendo los créditos.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!pauseMembershipId) return;
              setBusy(true);
              setPauseError(null);
              try {
                const startsIso = pauseStarts.includes("Z")
                  ? pauseStarts
                  : new Date(pauseStarts).toISOString();
                const endsIso = pauseEnds.includes("Z")
                  ? pauseEnds
                  : new Date(pauseEnds).toISOString();
                await api.createMembershipPause(pauseMembershipId, {
                  startsAt: startsIso,
                  endsAt: endsIso,
                  reason: pauseReason.trim(),
                });
                toast.success("Pausa registrada");
                setPauseOpen(false);
                setPauseReason("");
                setPauseStarts("");
                setPauseEnds("");
                await reload();
              } catch (e) {
                setPauseError(e instanceof Error ? e.message : "No se pudo registrar la pausa");
              } finally {
                setBusy(false);
              }
            }}
            className="space-y-4"
          >
            <ErrorNotice message={pauseError} />
            <div>
              <Label htmlFor="pause-reason">Motivo de la pausa</Label>
              <Input
                id="pause-reason"
                required
                value={pauseReason}
                onChange={(e) => setPauseReason(e.target.value)}
                placeholder="Ej. Reposo médico por 7 días"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="pause-starts">Fecha de inicio</Label>
                <Input
                  id="pause-starts"
                  type="datetime-local"
                  required
                  value={pauseStarts}
                  onChange={(e) => setPauseStarts(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="pause-ends">Fecha de fin</Label>
                <Input
                  id="pause-ends"
                  type="datetime-local"
                  required
                  value={pauseEnds}
                  onChange={(e) => setPauseEnds(e.target.value)}
                />
              </div>
            </div>
            <Button type="submit" disabled={busy || !pauseReason.trim()}>
              {busy ? "Registrando…" : "Registrar pausa"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Programar cambio de plan</DialogTitle>
            <DialogDescription>
              El cambio tomará efecto en la próxima renovación validada sin alterar el período en
              curso.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!scheduleMembershipId) return;
              setBusy(true);
              setScheduleError(null);
              try {
                await api.schedulePlanChange(scheduleMembershipId, {
                  nextPlanId: scheduleNextPlanId || null,
                });
                toast.success("Cambio de plan programado");
                setScheduleOpen(false);
                await reload();
              } catch (e) {
                setScheduleError(
                  e instanceof Error ? e.message : "No se pudo programar el cambio",
                );
              } finally {
                setBusy(false);
              }
            }}
            className="space-y-4"
          >
            <ErrorNotice message={scheduleError} />
            <div>
              <Select
                id="schedule-next-plan"
                label="Siguiente plan para renovación"
                value={scheduleNextPlanId}
                onChange={(e) => setScheduleNextPlanId(e.target.value)}
              >
                <option value="">Sin cambio (mantener plan actual)</option>
                {plans
                  .filter((p) => p.active)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {formatCLP(p.priceCents)}
                    </option>
                  ))}
              </Select>
            </div>
            <Button type="submit" disabled={busy}>
              {busy ? "Guardando…" : "Guardar cambio"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
