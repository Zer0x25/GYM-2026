/**
 * Classes & sessions page (spec 004, REQ-6) — the staff operations hub.
 *
 * Tabs: Clases (crear sesión desde plantilla) · Agenda (timeline unificada
 * del instructor, sin solapes TX-02) · Plantillas (admin).
 *
 * Backend is the authority: it rejects instructor overlap (409) and enforces
 * capacity/coverage. The UI surfaces those errors as toasts and never
 * authorizes on its own.
 */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { CalendarPlus, CalendarRange, Layers } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  ApiError,
  api,
  type ClassTemplate,
  type CreateSessionInput,
  type Session,
} from "../api.js";
import { useSession } from "../session.js";
import { Button } from "../components/ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.js";
import { Input, Label } from "../components/ui/input.js";
import { Badge, SessionStateBadge } from "../components/ui/badge.js";
import { Tabs, TabsList, TabsTrigger } from "../components/ui/tabs.js";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table.js";

/** Local datetime string (YYYY-MM-DDTHH:mm) for an <input type="datetime-local">. */
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const TYPE_LABEL: Record<string, string> = {
  grupal: "Grupal",
  fija: "Fija",
  cita: "Cita",
  bloqueo: "Bloqueo",
};

export function Classes() {
  const { session } = useSession();
  const isAdmin = session?.role === "admin";
  const navigate = useNavigate();
  const [tab, setTab] = useState<"clases" | "agenda" | "plantillas">("clases");

  const [templates, setTemplates] = useState<ClassTemplate[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [agenda, setAgenda] = useState<Session[]>([]);
  const [instructorId, setInstructorId] = useState("inst-1");
  const [error, setError] = useState<string | null>(null);

  // New-session form
  const [templateId, setTemplateId] = useState("");
  const [startsAt, setStartsAt] = useState(() => toLocalInput(new Date(Date.now() + 3600_000)));
  const [endsAt, setEndsAt] = useState(() => toLocalInput(new Date(Date.now() + 7200_000)));
  const [busy, setBusy] = useState(false);

  // New-template form
  const [tplName, setTplName] = useState("");
  const [tplCapacity, setTplCapacity] = useState("10");
  const [tplCancelH, setTplCancelH] = useState("24");

  const load = useCallback(async () => {
    try {
      const [tpls, list] = await Promise.all([api.listClassTemplates(), api.listSessions()]);
      setTemplates(tpls);
      setSessions(list);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Error al cargar clases");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function loadAgenda() {
    try {
      setAgenda(await api.agenda(instructorId));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Error al cargar la agenda");
    }
  }

  async function onCreateSession(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const input: CreateSessionInput = {
        templateId: templateId || undefined,
        type: "grupal",
        instructorId,
        startsAt: new Date(startsAt).toISOString(),
        endsAt: new Date(endsAt).toISOString(),
        capacity: templates.find((t) => t.id === templateId)?.capacity ?? 10,
      };
      await api.createSession(input);
      toast.success("Sesión creada");
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Error al crear la sesión");
    } finally {
      setBusy(false);
    }
  }

  async function onCreateTemplate(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.createClassTemplate({
        name: tplName.trim(),
        type: "grupal",
        capacity: Number(tplCapacity) || 10,
        cancellationWindowHours: Number(tplCancelH) || 24,
      });
      setTplName("");
      toast.success("Plantilla creada");
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Error al crear la plantilla");
    } finally {
      setBusy(false);
    }
  }

  async function onCancelSession(id: string) {
    try {
      await api.cancelSession(id);
      toast.success("Sesión cancelada");
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "No se pudo cancelar");
    }
  }

  const fmtDateTime = (iso: string) =>
    new Date(iso).toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" });

  return (
    <section aria-labelledby="classes-title">
      <div className="mb-6">
        <h1 id="classes-title" className="text-2xl font-bold">Clases y agenda</h1>
        <p className="text-sm text-muted-foreground">
          El backend evita solapes del instructor (TX-02) y controla el cupo (TX-01).
        </p>
      </div>

      <Tabs value={tab} onValueChange={(v: string) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="clases">Clases</TabsTrigger>
          <TabsTrigger value="agenda">Agenda</TabsTrigger>
          <TabsTrigger value="plantillas">Plantillas</TabsTrigger>
        </TabsList>
      </Tabs>

      {error ? (
        <p role="alert" className="mt-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p>
      ) : null}

      {tab === "clases" ? (
        <div className="mt-4 space-y-4">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><CalendarPlus className="h-5 w-5" /> Nueva sesión</CardTitle></CardHeader>
            <CardContent>
              <form onSubmit={onCreateSession} className="flex flex-wrap items-end gap-3">
                <div className="space-y-1">
                  <Label htmlFor="tpl">Plantilla</Label>
                  <select
                    id="tpl"
                    className="h-9 rounded-md border bg-background px-2 text-sm"
                    value={templateId}
                    onChange={(e) => setTemplateId(e.target.value)}
                  >
                    <option value="">Sin plantilla</option>
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>{t.name} · cupo {t.capacity}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="instructor">Instructor</Label>
                  <Input id="instructor" value={instructorId} onChange={(e) => setInstructorId(e.target.value)} required />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="startsAt">Inicio</Label>
                  <Input id="startsAt" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} required />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="endsAt">Fin</Label>
                  <Input id="endsAt" type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} required />
                </div>
                <Button type="submit" disabled={busy || !instructorId.trim()}>
                  {busy ? "Creando…" : "Crear sesión"}
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Próximas sesiones</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Instructor</TableHead>
                    <TableHead>Inicio</TableHead>
                    <TableHead>Fin</TableHead>
                    <TableHead>Cupo</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sessions.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell>{TYPE_LABEL[s.type] ?? s.type}</TableCell>
                      <TableCell className="text-muted-foreground">{s.instructorId}</TableCell>
                      <TableCell>{fmtDateTime(s.startsAt)}</TableCell>
                      <TableCell>{fmtDateTime(s.endsAt)}</TableCell>
                      <TableCell>{s.capacity}</TableCell>
                      <TableCell><SessionStateBadge state={s.state} /></TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="ghost" onClick={() => navigate(`/clases/${s.id}`)}>Ver</Button>
                          {s.state === "programada" ? (
                            <Button size="sm" variant="outline" onClick={() => void onCancelSession(s.id)}>Cancelar</Button>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {sessions.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Sin sesiones.</TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {tab === "agenda" ? (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><CalendarRange className="h-5 w-5" /> Agenda del instructor</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-end gap-3">
              <div className="space-y-1">
                <Label htmlFor="agenda-instructor">Instructor</Label>
                <Input id="agenda-instructor" value={instructorId} onChange={(e) => setInstructorId(e.target.value)} />
              </div>
              <Button variant="outline" onClick={() => void loadAgenda()}>Ver agenda</Button>
            </div>
            {agenda.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">Sin compromisos. Elegí un instructor y cargá la agenda.</p>
            ) : (
              <ul className="divide-y">
                {agenda.map((s) => (
                  <li key={s.id} className="flex items-center justify-between py-2 text-sm">
                    <span className="flex items-center gap-2">
                      <Badge variant="outline">{TYPE_LABEL[s.type] ?? s.type}</Badge>
                      {fmtDateTime(s.startsAt)} — {fmtDateTime(s.endsAt)}
                    </span>
                    <SessionStateBadge state={s.state} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ) : null}

      {tab === "plantillas" ? (
        <div className="mt-4 space-y-4">
          {isAdmin ? (
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Layers className="h-5 w-5" /> Nueva plantilla</CardTitle></CardHeader>
              <CardContent>
                <form onSubmit={onCreateTemplate} className="flex flex-wrap items-end gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="tplName">Nombre</Label>
                    <Input id="tplName" value={tplName} onChange={(e) => setTplName(e.target.value)} required />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="tplCap">Cupo</Label>
                    <Input id="tplCap" type="number" min="1" value={tplCapacity} onChange={(e) => setTplCapacity(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="tplCancel">Ventana cancelación (h)</Label>
                    <Input id="tplCancel" type="number" min="0" value={tplCancelH} onChange={(e) => setTplCancelH(e.target.value)} />
                  </div>
                  <Button type="submit" disabled={busy || !tplName.trim()}>{busy ? "Creando…" : "Crear plantilla"}</Button>
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
                    <TableHead>Tipo</TableHead>
                    <TableHead>Cupo</TableHead>
                    <TableHead>Ventana cancelación</TableHead>
                    <TableHead>Cobertura</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {templates.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="font-medium">{t.name}</TableCell>
                      <TableCell>{TYPE_LABEL[t.type] ?? t.type}</TableCell>
                      <TableCell>{t.capacity}</TableCell>
                      <TableCell>{t.cancellationWindowHours} h</TableCell>
                      <TableCell>{t.coverageRequired}</TableCell>
                    </TableRow>
                  ))}
                  {templates.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">Sin plantillas.</TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </section>
  );
}
