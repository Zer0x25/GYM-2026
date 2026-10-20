import { useCallback, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { api, type Staff, type AccountSession, type SupportGrant } from "../api.js";
import { useResource } from "../hooks/use-resource.js";
import { PageHead, ErrorNotice, Loading, Select } from "../components/ui/page.js";
import { DataTable } from "../components/ui/data-table.js";
import { Button } from "../components/ui/button.js";
import { Input, Label } from "../components/ui/input.js";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "../components/ui/dialog.js";
import { Confirm } from "../components/ui/confirm.js";
const labels = { admin: "Administración", recepcion: "Recepción", instructor: "Instructor" };
export function Team() {
  const loader = useCallback(() => api.staff(), []),
    { data, error, loading, reload } = useResource(loader);
  const supportLoader = useCallback(() => api.supportGrants(), []),
    {
      data: grants,
      error: grantsError,
      loading: grantsLoading,
      reload: reloadGrants,
    } = useResource(supportLoader);
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [name, setName] = useState(""),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [role, setRole] = useState<Staff["role"]>("recepcion"),
    [formError, setFormError] = useState<string | null>(null),
    [target, setTarget] = useState<Staff | null>(null),
    [sessions, setSessions] = useState<AccountSession[]>([]),
    [sessionsError, setSessionsError] = useState<string | null>(null),
    [revoke, setRevoke] = useState<AccountSession | null>(null);

  const [grantOpen, setGrantOpen] = useState(false),
    [supportEmail, setSupportEmail] = useState(""),
    [supportReason, setSupportReason] = useState(""),
    [supportDuration, setSupportDuration] = useState("60"),
    [supportScope, setSupportScope] = useState<"diagnostic" | "read_only">("diagnostic"),
    [grantFormError, setGrantFormError] = useState<string | null>(null),
    [issuedToken, setIssuedToken] = useState<string | null>(null),
    [revokeGrant, setRevokeGrant] = useState<SupportGrant | null>(null);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      await api.createStaff({ name: name.trim(), email: email.trim(), password, role });
      setOpen(false);
      setPassword("");
      toast.success("Cuenta del equipo creada");
      await reload();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "No se pudo crear");
    } finally {
      setBusy(false);
    }
  }

  async function createGrant(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setGrantFormError(null);
    try {
      const res = await api.createSupportGrant({
        supportEmail: supportEmail.trim(),
        reason: supportReason.trim(),
        durationMinutes: Number(supportDuration),
        scope: supportScope,
      });
      setGrantOpen(false);
      setSupportEmail("");
      setSupportReason("");
      setIssuedToken(res.token);
      toast.success("Acceso temporal de soporte otorgado");
      await reloadGrants();
    } catch (e) {
      setGrantFormError(e instanceof Error ? e.message : "No se pudo crear");
    } finally {
      setBusy(false);
    }
  }

  async function showSessions(staff: Staff) {
    setTarget(staff);
    setSessions([]);
    setSessionsError(null);
    setBusy(true);
    try {
      setSessions(await api.accountSessions(staff.id));
    } catch (e) {
      setSessionsError(e instanceof Error ? e.message : "No se pudieron cargar las sesiones");
    } finally {
      setBusy(false);
    }
  }

  const columns: ColumnDef<Staff>[] = [
    { accessorKey: "name", header: "Nombre" },
    { accessorKey: "email", header: "Email de acceso" },
    { accessorKey: "role", header: "Rol", cell: ({ row }) => labels[row.original.role] },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <Button variant="outline" size="sm" onClick={() => void showSessions(row.original)}>
          Ver sesiones
        </Button>
      ),
    },
  ];

  const grantColumns: ColumnDef<SupportGrant>[] = [
    { accessorKey: "supportEmail", header: "Email de soporte" },
    { accessorKey: "reason", header: "Motivo" },
    {
      accessorKey: "scope",
      header: "Alcance",
      cell: ({ row }) => (row.original.scope === "read_only" ? "Solo lectura" : "Diagnóstico"),
    },
    {
      accessorKey: "expiresAt",
      header: "Expira",
      cell: ({ row }) => new Date(row.original.expiresAt).toLocaleString("es-CL"),
    },
    {
      id: "status",
      header: "Estado",
      cell: ({ row }) => {
        const g = row.original;
        if (g.revokedAt) {
          return (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300">
              Revocado
            </span>
          );
        }
        if (new Date(g.expiresAt).getTime() <= Date.now()) {
          return (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-muted text-muted-foreground">
              Expirado
            </span>
          );
        }
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300">
            Activo
          </span>
        );
      },
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => {
        const g = row.original;
        const isActive = !g.revokedAt && new Date(g.expiresAt).getTime() > Date.now();
        if (!isActive) return null;
        return (
          <Button variant="outline" size="sm" onClick={() => setRevokeGrant(g)}>
            Revocar acceso
          </Button>
        );
      },
    },
  ];

  return (
    <section>
      <PageHead
        eyebrow="Administración"
        title="Equipo"
        description="Crea accesos con el rol adecuado y revisa las sesiones en equipos compartidos."
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" />
            Agregar al equipo
          </Button>
        }
      />
      <ErrorNotice message={error} retry={() => void reload()} />
      {loading && !data ? <Loading /> : <DataTable data={data ?? []} columns={columns} />}

      <div className="mt-12 pt-8 border-t">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Acceso temporal de soporte (D-06)</h2>
            <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
              El soporte técnico nunca tiene acceso permanente. Autoriza un permiso acotado (máximo 24h)
              con auditoría inmutable de cada consulta.
            </p>
          </div>
          <Button onClick={() => setGrantOpen(true)}>
            <Plus className="h-4 w-4" />
            Otorgar acceso de soporte
          </Button>
        </div>
        <ErrorNotice message={grantsError} retry={() => void reloadGrants()} />
        {grantsLoading && !grants ? (
          <Loading />
        ) : (
          <DataTable data={grants ?? []} columns={grantColumns} />
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Agregar al equipo</DialogTitle>
            <DialogDescription>La cuenta queda vinculada a este gimnasio.</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={create}>
            <ErrorNotice message={formError} />
            <div>
              <Label htmlFor="staff-name">Nombre</Label>
              <Input
                id="staff-name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="staff-email">Email de acceso</Label>
              <Input
                id="staff-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="staff-password">Contraseña inicial</Label>
              <Input
                id="staff-password"
                type="password"
                minLength={10}
                required
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <Select
              id="staff-role"
              label="Rol"
              value={role}
              onChange={(e) => setRole(e.target.value as Staff["role"])}
            >
              {Object.entries(labels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </Select>
            <Button type="submit" disabled={busy}>
              {busy ? "Creando…" : "Crear cuenta"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={grantOpen} onOpenChange={setGrantOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Otorgar acceso temporal de soporte</DialogTitle>
            <DialogDescription>
              Emite un token efímero con expiración estricta y auditoría inmutable de lecturas.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={createGrant}>
            <ErrorNotice message={grantFormError} />
            <div>
              <Label htmlFor="support-email">Email de soporte</Label>
              <Input
                id="support-email"
                type="email"
                required
                value={supportEmail}
                onChange={(e) => setSupportEmail(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="support-reason">Motivo</Label>
              <Input
                id="support-reason"
                required
                minLength={5}
                maxLength={500}
                value={supportReason}
                onChange={(e) => setSupportReason(e.target.value)}
              />
            </div>
            <Select
              id="support-duration"
              label="Duración del acceso"
              value={supportDuration}
              onChange={(e) => setSupportDuration(e.target.value)}
            >
              <option value="15">15 minutos</option>
              <option value="30">30 minutos</option>
              <option value="60">1 hora (60 minutos)</option>
              <option value="120">2 horas (120 minutos)</option>
              <option value="1440">24 horas (máximo)</option>
            </Select>
            <Select
              id="support-scope"
              label="Alcance"
              value={supportScope}
              onChange={(e) => setSupportScope(e.target.value as "diagnostic" | "read_only")}
            >
              <option value="diagnostic">Diagnóstico operativo</option>
              <option value="read_only">Solo lectura</option>
            </Select>
            <Button type="submit" disabled={busy}>
              {busy ? "Emitiendo…" : "Emitir permiso"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={issuedToken !== null} onOpenChange={(o) => !o && setIssuedToken(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Token de acceso temporal emitido</DialogTitle>
            <DialogDescription>
              Copia este token ahora. Por seguridad, no volverá a mostrarse ni se guarda en el
              servidor.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <code className="block rounded-lg border bg-muted p-3 font-mono text-xs break-all select-all">
              {issuedToken}
            </code>
            <Button
              className="w-full"
              onClick={() => {
                if (issuedToken) {
                  void navigator.clipboard?.writeText(issuedToken);
                  toast.success("Token copiado al portapapeles");
                }
                setIssuedToken(null);
              }}
            >
              Copiar y cerrar
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={target !== null} onOpenChange={(o) => !o && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sesiones de {target?.name}</DialogTitle>
            <DialogDescription>
              Revocar una sesión bloquea su siguiente petición al servidor.
            </DialogDescription>
          </DialogHeader>
          <ErrorNotice message={sessionsError} />
          {busy ? (
            <Loading />
          ) : sessions.length ? (
            sessions.map((s) => (
              <div key={s.id} className="rounded-lg border p-4">
                <p className="truncate text-xs text-muted-foreground">
                  {s.userAgent ?? "Equipo no identificado"}
                </p>
                <p className="mt-2 text-xs">
                  {s.ipAddress ?? "IP no disponible"} ·{" "}
                  {new Date(s.createdAt).toLocaleString("es-CL")}
                </p>
                <Button className="mt-3" size="sm" variant="outline" onClick={() => setRevoke(s)}>
                  Revocar sesión
                </Button>
              </div>
            ))
          ) : (
            !sessionsError && <p className="text-sm text-muted-foreground">Sin sesiones activas.</p>
          )}
        </DialogContent>
      </Dialog>

      <Confirm
        open={revoke !== null}
        onOpenChange={(o) => !o && setRevoke(null)}
        title="Revocar sesión"
        description="La persona tendrá que iniciar sesión nuevamente en ese equipo."
        destructive
        busy={busy}
        onConfirm={() => {
          if (!revoke) return;
          setBusy(true);
          void api
            .revokeSession(revoke.id)
            .then(() => {
              setSessions((rows) => rows.filter((r) => r.id !== revoke.id));
              setRevoke(null);
              toast.success("Sesión revocada");
            })
            .catch((e) => toast.error(e.message))
            .finally(() => setBusy(false));
        }}
      />

      <Confirm
        open={revokeGrant !== null}
        onOpenChange={(o) => !o && setRevokeGrant(null)}
        title="Revocar acceso de soporte"
        description="El token de soporte quedará invalidado de forma inmediata e irreversible."
        destructive
        busy={busy}
        onConfirm={() => {
          if (!revokeGrant) return;
          setBusy(true);
          void api
            .revokeSupportGrant(revokeGrant.id)
            .then(() => {
              setRevokeGrant(null);
              toast.success("Acceso de soporte revocado");
              return reloadGrants();
            })
            .catch((e) => toast.error(e.message))
            .finally(() => setBusy(false));
        }}
      />
    </section>
  );
}
