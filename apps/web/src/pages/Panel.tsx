import { useCallback, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Plus, ArrowUpRight } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { api, type Member, type Membership } from "../api.js";
import { useSession } from "../session.js";
import { useResource } from "../hooks/use-resource.js";
import { PageHead, ErrorNotice, Loading, Select } from "../components/ui/page.js";
import { DataTable } from "../components/ui/data-table.js";
import { Button } from "../components/ui/button.js";
import { Input, Label } from "../components/ui/input.js";
import { MembershipStateBadge } from "../components/ui/badge.js";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "../components/ui/dialog.js";
import { canManageMembers } from "../permissions.js";

export function Panel() {
  const { session } = useSession(),
    navigate = useNavigate();
  const manage = canManageMembers(session?.role);
  const loader = useCallback(async () => {
    const policyPromise =
      typeof api.minorPolicy === "function"
        ? api.minorPolicy().catch(() => ({ enabled: true, orgEnabled: true, serverLocked: false }))
        : Promise.resolve({ enabled: true, orgEnabled: true, serverLocked: false });
    const [members, minorPolicy] = await Promise.all([api.listMembers(), policyPromise]);
    if (!manage) return { members, memberships: [], plans: [], minorPolicy };
    const [memberships, plans] = await Promise.all([api.listMemberships(), api.listPlans()]);
    return { members, memberships, plans, minorPolicy };
  }, [manage]);
  const { data, error, loading, reload } = useResource(loader);
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [policyBusy, setPolicyBusy] = useState(false),
    [fullName, setFullName] = useState(""),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [portal, setPortal] = useState(true),
    [planId, setPlanId] = useState(""),
    [isMinor, setIsMinor] = useState(false),
    [adultResponsibleId, setAdultResponsibleId] = useState(""),
    [guardianConsentRef, setGuardianConsentRef] = useState(""),
    [formError, setFormError] = useState<string | null>(null);
  const membershipByMember = useMemo(() => {
    const map = new Map<string, Membership>();
    for (const m of data?.memberships ?? []) {
      const prior = map.get(m.memberId);
      if (
        !prior ||
        (m.state === "active" && prior.state !== "active") ||
        (prior.state !== "active" && new Date(m.createdAt) > new Date(prior.createdAt))
      )
        map.set(m.memberId, m);
    }
    return map;
  }, [data]);
  const rows = (data?.members ?? []).filter(
    (m) =>
      (m.fullName + " " + (m.contactEmail ?? "")).toLowerCase().includes(query.toLowerCase()) &&
      (filter === "all" || (membershipByMember.get(m.id)?.state ?? "none") === filter),
  );
  const columns: ColumnDef<Member>[] = [
    {
      accessorKey: "fullName",
      header: "Socio",
      cell: ({ row }) => (
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
            {row.original.fullName.charAt(0)}
          </span>
          <div className="flex items-center gap-2">
            <span className="font-medium">{row.original.fullName}</span>
            {row.original.isMinor && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                Menor
              </span>
            )}
          </div>
        </div>
      ),
    },
    {
      accessorKey: "contactEmail",
      header: "Contacto",
      cell: ({ getValue }) => (
        <span className="text-muted-foreground">{String(getValue() ?? "Sin email")}</span>
      ),
    },
    ...(manage
      ? [
          {
            id: "membership",
            header: "Membresía",
            cell: ({ row }: { row: { original: Member } }) => {
              const m = membershipByMember.get(row.original.id);
              return m?.state ? (
                <MembershipStateBadge state={m.state} />
              ) : (
                <span className="text-muted-foreground">Sin plan</span>
              );
            },
          },
        ]
      : []),
    {
      accessorKey: "createdAt",
      header: "Alta",
      cell: ({ getValue }) => new Date(getValue() as string).toLocaleDateString("es-CL"),
    },
    ...(manage
      ? [
          {
            id: "actions",
            header: "",
            cell: ({ row }: { row: { original: Member } }) => (
              <Link
                className="inline-flex items-center gap-1 text-sm font-medium text-primary"
                to={`/panel/${row.original.id}`}
              >
                Ver ficha
                <ArrowUpRight className="h-4 w-4" />
              </Link>
            ),
          },
        ]
      : []),
  ];
  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      let id: string;
      if (portal && email && !isMinor) {
        const result = await api.createSocio({
          name: fullName.trim(),
          email: email.trim(),
          password,
        });
        id = result.memberId;
      } else {
        id = (
          await api.createMember({
            fullName: fullName.trim(),
            ...(email.trim() ? { contactEmail: email.trim() } : {}),
            isMinor,
            adultResponsibleId: isMinor && adultResponsibleId ? adultResponsibleId : null,
            guardianConsentRef:
              isMinor && guardianConsentRef.trim() ? guardianConsentRef.trim() : null,
          })
        ).id;
      }
      if (planId) {
        try {
          await api.createMembership({ memberId: id, planId });
        } catch (e) {
          toast.error(
            `Socio creado. No se pudo asignar el plan: ${e instanceof Error ? e.message : "reintenta desde su ficha"}`,
          );
        }
      }
      toast.success("Socio creado");
      setOpen(false);
      navigate(`/panel/${id}`);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "No se pudo crear el socio");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <PageHead
        eyebrow="Comunidad"
        title="Socios"
        description="Encuentra a cada socio y gestiona su membresía desde una sola ficha."
        actions={
          manage && (
            <div className="flex items-center gap-2">
              {session?.role === "admin" && data?.minorPolicy && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={policyBusy || data.minorPolicy.serverLocked}
                  onClick={async () => {
                    setPolicyBusy(true);
                    try {
                      const next = !data.minorPolicy.orgEnabled;
                      await api.setMinorPolicy(next);
                      toast.success(
                        next
                          ? "Registro de menores habilitado"
                          : "Registro de menores deshabilitado",
                      );
                      await reload();
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "Error al actualizar política");
                    } finally {
                      setPolicyBusy(false);
                    }
                  }}
                >
                  Menores:{" "}
                  {data.minorPolicy.serverLocked
                    ? "Bloqueado (servidor)"
                    : data.minorPolicy.enabled
                      ? "Habilitados"
                      : "Deshabilitados"}
                </Button>
              )}
              <Button
                onClick={() => {
                  setOpen(true);
                  setFormError(null);
                  setIsMinor(false);
                  setAdultResponsibleId("");
                  setGuardianConsentRef("");
                }}
              >
                <Plus className="h-4 w-4" />
                Nuevo socio
              </Button>
            </div>
          )
        }
      />
      <ErrorNotice message={error} retry={() => void reload()} />
      <div className="mb-5 flex flex-wrap items-end gap-3">
        <Input
          type="search"
          aria-label="Buscar socio"
          placeholder="Buscar por nombre o email…"
          className="max-w-sm"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {manage && (
          <Select
            id="member-status"
            label="Estado"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">Todos los socios</option>
            <option value="active">Activos</option>
            <option value="expired">Vencidos</option>
            <option value="pending_payment">Pendientes de pago</option>
            <option value="none">Sin plan</option>
          </Select>
        )}
      </div>
      {loading && !data ? (
        <Loading />
      ) : (
        <DataTable
          data={rows}
          columns={columns}
          empty={
            query ? "No encontramos socios con esa búsqueda." : "Aún no hay socios registrados."
          }
        />
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nuevo socio</DialogTitle>
            <DialogDescription>
              Crea su ficha, asigna un plan y continúa con el cobro.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={create} className="space-y-4">
            <ErrorNotice message={formError} />
            <div>
              <Label htmlFor="member-name">Nombre completo</Label>
              <Input
                id="member-name"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="member-email">Email de contacto</Label>
              <Input
                id="member-email"
                type="email"
                required={portal && !isMinor}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <label className={`flex items-center gap-2 text-sm ${isMinor ? "opacity-50" : ""}`}>
              <input
                type="checkbox"
                checked={portal && !isMinor}
                disabled={isMinor}
                onChange={(e) => setPortal(e.target.checked)}
              />
              Crear acceso al portal del socio
            </label>
            {portal && !isMinor && (
              <div>
                <Label htmlFor="member-password">Contraseña inicial</Label>
                <Input
                  id="member-password"
                  type="password"
                  minLength={10}
                  autoComplete="new-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Mínimo 10 caracteres. Entrégala al socio por un canal privado.
                </p>
              </div>
            )}
            {data?.minorPolicy && !data.minorPolicy.enabled && (
              <div
                role="status"
                className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300"
              >
                Restricción de piloto (D-05): registro de menores deshabilitado
                {data.minorPolicy.serverLocked
                  ? " por configuración del servidor (ALLOW_MINOR_MEMBERS=false)."
                  : " por política de la organización."}
              </div>
            )}
            <div>
              <label
                className={`flex items-center gap-2 text-sm ${data?.minorPolicy && !data.minorPolicy.enabled ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={isMinor}
                  disabled={data?.minorPolicy ? !data.minorPolicy.enabled : false}
                  onChange={(e) => {
                    setIsMinor(e.target.checked);
                    if (e.target.checked) {
                      setPortal(false);
                    } else {
                      setAdultResponsibleId("");
                      setGuardianConsentRef("");
                    }
                  }}
                />
                Es menor de edad
              </label>
            </div>
            {isMinor && (
              <div className="space-y-4">
                <div>
                  <Select
                    id="member-guardian"
                    label="Adulto responsable"
                    value={adultResponsibleId}
                    onChange={(e) => setAdultResponsibleId(e.target.value)}
                    required
                  >
                    <option value="">Selecciona un adulto responsable…</option>
                    {(data?.members ?? [])
                      .filter((m) => !m.isMinor)
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.fullName}
                        </option>
                      ))}
                  </Select>
                </div>
                <div>
                  <Label htmlFor="guardian-consent-ref">
                    Folio / acta de autorización (D-05)
                  </Label>
                  <Input
                    id="guardian-consent-ref"
                    placeholder="ej. ACTA-2026-0042"
                    value={guardianConsentRef}
                    onChange={(e) => setGuardianConsentRef(e.target.value)}
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Documento o acta firmada por el adulto responsable.
                  </p>
                </div>
              </div>
            )}
            <Select
              id="member-plan"
              label="Plan inicial"
              value={planId}
              onChange={(e) => setPlanId(e.target.value)}
            >
              <option value="">Asignar más adelante</option>
              {data?.plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.durationDays} días
                </option>
              ))}
            </Select>
            <Button
              type="submit"
              disabled={busy || !fullName.trim() || (isMinor && !adultResponsibleId)}
            >
              {busy ? "Creando…" : "Crear socio"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
