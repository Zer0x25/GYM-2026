/**
 * Member portal (socio): own profile, contact edit, and own memberships
 * (read-only, derived state). The socio role only ever reads /members/me
 * and /memberships/mine (server-validated) — the backend resolves the socio
 * from the session, so the UI cannot widen the scope.
 */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { CalendarCheck } from "lucide-react";
import { ApiError, api, formatCLP, type Member, type Membership, type Plan } from "../api.js";
import { Button } from "../components/ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.js";
import { Input, Label } from "../components/ui/input.js";
import { MembershipStateBadge } from "../components/ui/badge.js";

export function Portal() {
  const [me, setMe] = useState<Member | null>(null);
  const [contactEmail, setContactEmail] = useState("");
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
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

  useEffect(() => {
    void load();
    void api.listPlans().then(setPlans).catch(() => undefined);
  }, [load]);

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
    </section>
  );
}
