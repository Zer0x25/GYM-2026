import { useCallback, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { api, type Staff, type AccountSession } from "../api.js";
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
            <div className="space-y-4">
              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant="outline"
                  className="text-destructive hover:bg-destructive/10"
                  disabled={busy}
                  onClick={() => {
                    if (!target) return;
                    setBusy(true);
                    void api
                      .revokeAllSessions(target.id)
                      .then((res) => {
                        setSessions([]);
                        toast.success(`Todas las sesiones cerradas (${res.revoked})`);
                      })
                      .catch((e) => toast.error(e.message))
                      .finally(() => setBusy(false));
                  }}
                >
                  Cerrar todas las sesiones
                </Button>
              </div>
              {sessions.map((s) => (
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
              ))}
            </div>
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
          if (!revoke || !target) return;
          setBusy(true);
          void api
            .revokeSession(target.id, revoke.id)
            .then(() => {
              setSessions((rows) => rows.filter((r) => r.id !== revoke.id));
              setRevoke(null);
              toast.success("Sesión revocada");
            })
            .catch((e) => toast.error(e.message))
            .finally(() => setBusy(false));
        }}
      />
    </section>
  );
}
