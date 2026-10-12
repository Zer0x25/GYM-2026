/**
 * Member portal (socio): own profile, contact edit, and own memberships
 * (read-only, derived state). The socio role only ever reads /members/me
 * and /memberships/mine (server-validated) — the backend resolves the socio
 * from the session, so the UI cannot widen the scope.
 */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { CalendarCheck, CalendarX2, CalendarPlus } from "lucide-react";
import { ApiError, api, formatCLP, type Booking, type Member, type Membership, type Plan, type Session } from "../api.js";
import { Button } from "../components/ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.js";
import { Input, Label } from "../components/ui/input.js";
import { MembershipStateBadge, BookingStateBadge } from "../components/ui/badge.js";

export function Portal() {
  const [me, setMe] = useState<Member | null>(null);
  const [contactEmail, setContactEmail] = useState("");
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [bookable, setBookable] = useState<Session[]>([]);
  const [myBookings, setMyBookings] = useState<Booking[]>([]);
  const [busyBooking, setBusyBooking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [m, memberships_] = await Promise.all([api.me(), api.myMemberships()]);
      setMe(m);
      setContactEmail(m.contactEmail ?? "");
      setMemberships(memberships_);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Error al cargar el perfil");
    }
  }, []);

  const loadClasses = useCallback(async () => {
    try {
      const [list, mine] = await Promise.all([api.listSessions(), api.myBookings()]);
      setBookable(list.filter((s) => s.state === "programada"));
      setMyBookings(mine);
    } catch {
      // Clases are optional; a socio without coverage still sees the profile.
    }
  }, []);

  useEffect(() => {
    void load();
    void loadClasses();
    void api.listPlans().then(setPlans).catch(() => undefined);
  }, [load, loadClasses]);

  async function onReserve(sessionId: string) {
    setBusyBooking(sessionId);
    try {
      await api.createBooking({ sessionId });
      toast.success("Reserva confirmada");
      await loadClasses();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "No se pudo reservar");
    } finally {
      setBusyBooking(null);
    }
  }

  async function onCancelBooking(bookingId: string) {
    setBusyBooking(bookingId);
    try {
      await api.cancelBooking(bookingId, { type: "temprana" });
      toast.success("Reserva cancelada");
      await loadClasses();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "No se pudo cancelar");
    } finally {
      setBusyBooking(null);
    }
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const updated = await api.updateContact(me!.id, contactEmail.trim() || null);
      setMe(updated);
      toast.success("Contacto actualizado.");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Error al guardar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="portal-title" className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 id="portal-title" className="text-2xl font-bold">Mi perfil</h1>
        <p className="text-sm text-muted-foreground">Solo podés ver y editar tu propia información.</p>
      </div>

      {error ? (
        <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p>
      ) : null}

      <Card>
        <CardHeader><CardTitle className="text-base">Datos de contacto</CardTitle></CardHeader>
        <CardContent>
          {me ? (
            <form onSubmit={onSave} className="space-y-4">
              <p className="font-medium">{me.fullName}</p>
              <div className="space-y-1">
                <Label htmlFor="contactEmail">Email de contacto</Label>
                <Input id="contactEmail" type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
              </div>
              <Button type="submit" disabled={busy}>{busy ? "Guardando…" : "Guardar"}</Button>
            </form>
          ) : (
            <p className="text-sm text-muted-foreground">Cargando perfil…</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarCheck className="h-5 w-5" /> Mis membresías
          </CardTitle>
        </CardHeader>
        <CardContent>
          {memberships.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No tenés membresías activas.</p>
          ) : (
            <ul className="divide-y">
              {memberships.map((m) => {
                const plan = plans.find((p) => p.id === m.planId);
                return (
                  <li key={m.id} className="flex items-center justify-between py-3">
                    <div>
                      <p className="font-medium">{plan?.name ?? "Plan"}</p>
                      <p className="text-sm text-muted-foreground">
                        {plan ? formatCLP(plan.priceCents) : ""}
                        {m.endAt ? ` · vence ${new Date(m.endAt).toLocaleDateString("es-CL")}` : ""}
                      </p>
                    </div>
                    <MembershipStateBadge state={m.state ?? "pending_payment"} />
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarPlus className="h-5 w-5" /> Reservar clase
          </CardTitle>
        </CardHeader>
        <CardContent>
          {(() => {
            const booked = new Map(myBookings.filter((b) => b.state === "confirmada").map((b) => [b.sessionId, b]));
            if (bookable.length === 0) {
              return <p className="py-4 text-center text-sm text-muted-foreground">No hay clases disponibles para reservar.</p>;
            }
            return (
              <ul className="divide-y">
                {bookable.map((s) => {
                  const mine = booked.get(s.id);
                  return (
                    <li key={s.id} className="flex items-center justify-between py-3">
                      <div>
                        <p className="font-medium">{s.instructorId}</p>
                        <p className="text-sm text-muted-foreground">
                          {new Date(s.startsAt).toLocaleString("es-CL", { dateStyle: "medium", timeStyle: "short" })}
                        </p>
                      </div>
                      {mine ? (
                        <div className="flex items-center gap-2">
                          <BookingStateBadge state={mine.state} />
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busyBooking === mine.id}
                            onClick={() => void onCancelBooking(mine.id)}
                          >
                            <CalendarX2 className="h-4 w-4" /> Cancelar
                          </Button>
                        </div>
                      ) : (
                        <Button size="sm" disabled={busyBooking === s.id} onClick={() => void onReserve(s.id)}>
                          Reservar
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            );
          })()}
        </CardContent>
      </Card>
    </section>
  );
}
