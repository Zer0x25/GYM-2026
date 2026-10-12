/**
 * Staff panel: members of the current organization (server-filtered by
 * tenant — the UI cannot widen the scope) with their derived membership
 * state, plus quick actions: create member, quick-pay (register a
 * provisional payment). Admin/recepción can create; socio never reaches
 * here (RequireStaff bounces). Backend is the authority for every rule.
 */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Plus, Banknote } from "lucide-react";
import { ApiError, api, type Member, type Membership, type Plan } from "../api.js";
import { useSession } from "../session.js";
import { Button } from "../components/ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.js";
import { Input, Label } from "../components/ui/input.js";
import { MembershipStateBadge } from "../components/ui/badge.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table.js";
import { QuickPay } from "../components/QuickPay.js";

export function Panel() {
  const { session } = useSession();
  const [members, setMembers] = useState<Member[]>([]);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fullName, setFullName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [busy, setBusy] = useState(false);

  // quick-pay target
  const [payMember, setPayMember] = useState<Member | null>(null);

  const load = useCallback(async (q?: string) => {
    try {
      const [m, memberships_, plans_] = await Promise.all([
        api.listMembers(q),
        api.listMemberships(),
        api.listPlans(),
      ]);
      setMembers(m);
      setMemberships(memberships_);
      setPlans(plans_);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Error al cargar socios");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const canCreate = session?.role === "admin" || session?.role === "recepcion";

  // Latest membership per member, for the state badge.
  const membershipByMember = new Map<string, Membership>();
  for (const m of memberships) membershipByMember.set(m.memberId, m);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.createMember({
        fullName: fullName.trim(),
        contactEmail: contactEmail.trim() || null,
      });
      setFullName("");
      setContactEmail("");
      await load(query);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Error al crear socio");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="panel-title">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 id="panel-title" className="text-2xl font-bold">
            Socios
          </h1>
          <p className="text-sm text-muted-foreground">
            {session?.organization.name} — sesión: {session?.user.email} ({session?.role})
          </p>
        </div>
      </div>

      <Input
        type="search"
        placeholder="Buscar socio…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          void load(e.target.value);
        }}
        className="mb-4 max-w-sm"
      />

      {error ? (
        <p role="alert" className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {canCreate ? (
        <Card className="mb-4">
          <CardHeader><CardTitle className="text-base">Nuevo socio</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={onCreate} className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label htmlFor="fullName">Nombre completo</Label>
                <Input id="fullName" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="contactEmail">Email (opcional)</Label>
                <Input id="contactEmail" type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
              </div>
              <Button type="submit" disabled={busy || !fullName.trim()}>
                <Plus className="h-4 w-4" /> {busy ? "Creando…" : "Crear socio"}
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Membresía</TableHead>
                <TableHead>Alta</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => {
                const membership = membershipByMember.get(m.id);
                return (
                  <TableRow key={m.id}>
                    <TableCell className="font-medium">{m.fullName}</TableCell>
                    <TableCell className="text-muted-foreground">{m.contactEmail ?? "—"}</TableCell>
                    <TableCell>
                      {membership?.state ? <MembershipStateBadge state={membership.state} /> : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>{new Date(m.createdAt).toLocaleDateString("es-CL")}</TableCell>
                    <TableCell className="text-right">
                      {canCreate && membership ? (
                        <Button size="sm" variant="outline" onClick={() => setPayMember(m)}>
                          <Banknote className="h-4 w-4" /> Cobrar
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
              {members.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                    Sin socios registrados.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Quick-pay drawer for a member (2-step provisional payment) */}
      <QuickPay
        open={payMember !== null}
        onOpenChange={(o) => !o && setPayMember(null)}
        memberName={payMember?.fullName ?? ""}
        memberships={payMember ? memberships.filter((m) => m.memberId === payMember.id) : []}
        plans={plans}
        onDone={() => void load(query)}
      />
    </section>
  );
}
