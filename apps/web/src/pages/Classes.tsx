import { useCallback, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Plus, CalendarDays, Clock, ArrowUpRight } from "lucide-react";
import { api, type ClassTemplate, type CreateSessionInput, type ScheduledSession } from "../api.js";
import { useSession } from "../session.js";
import { useResource } from "../hooks/use-resource.js";
import { PageHead, ErrorNotice, Loading, Select } from "../components/ui/page.js";
import { Button } from "../components/ui/button.js";
import { Input, Label } from "../components/ui/input.js";
import { SessionStateBadge } from "../components/ui/badge.js";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "../components/ui/dialog.js";
import { Confirm } from "../components/ui/confirm.js";
const types = {
  grupal: "Grupal",
  fija: "Personalizada fija",
  cita: "Cita personalizada",
  bloqueo: "Bloqueo de agenda",
};
function localInput(d: Date) {
  const date = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return date.toISOString().slice(0, 16);
}
export function Classes() {
  const { session } = useSession();
  const loader = useCallback(async () => {
    const [templates, sessions, instructors] = await Promise.all([
      api.listClassTemplates(),
      api.schedule(),
      api.instructors(),
    ]);
    return { templates, sessions, instructors };
  }, []);
  const { data, error, loading, reload } = useResource(loader);
  const [view, setView] = useState<"agenda" | "templates">("agenda"),
    [day, setDay] = useState(""),
    [instructorFilter, setInstructorFilter] = useState(""),
    [open, setOpen] = useState(false),
    [templateOpen, setTemplateOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [formError, setFormError] = useState<string | null>(null),
    [cancel, setCancel] = useState<ScheduledSession | null>(null);
  const [type, setType] = useState<CreateSessionInput["type"]>("grupal"),
    [templateId, setTemplateId] = useState(""),
    [instructorId, setInstructorId] = useState(""),
    [start, setStart] = useState(() => localInput(new Date(Date.now() + 3600000))),
    [end, setEnd] = useState(() => localInput(new Date(Date.now() + 7200000))),
    [capacity, setCapacity] = useState("10");
  const [name, setName] = useState(""),
    [templateType, setTemplateType] = useState<"grupal" | "fija">("grupal"),
    [tplCapacity, setTplCapacity] = useState("10"),
    [cancelHours, setCancelHours] = useState("24"),
    [reserveHours, setReserveHours] = useState("0"),
    [coverage, setCoverage] = useState<"none" | "unlimited" | "limited">("unlimited");
  const coach = session?.role === "instructor";
  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      await api.createSession({
        type,
        instructorId: coach ? session.user.id : instructorId,
        startsAt: new Date(start).toISOString(),
        endsAt: new Date(end).toISOString(),
        capacity: type === "bloqueo" ? 0 : type === "cita" ? 1 : Number(capacity),
        ...(templateId && (type === "grupal" || type === "fija") ? { templateId } : {}),
      });
      toast.success("Sesión publicada");
      setOpen(false);
      await reload();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "No se pudo publicar");
    } finally {
      setBusy(false);
    }
  }
  async function templateCreate(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      await api.createClassTemplate({
        name: name.trim(),
        type: templateType,
        capacity: Number(tplCapacity),
        reservationWindowHours: Number(reserveHours),
        cancellationWindowHours: Number(cancelHours),
        coverageRequired: coverage,
      });
      toast.success("Clase creada");
      setTemplateOpen(false);
      setName("");
      await reload();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "No se pudo crear");
    } finally {
      setBusy(false);
    }
  }
  const visible = (data?.sessions ?? []).filter(
    (s) =>
      (!coach || s.instructorId === session.user.id) &&
      (!day || new Date(s.startsAt).toLocaleDateString("en-CA") === day) &&
      (!instructorFilter || s.instructorId === instructorFilter),
  );
  const groups = new Map<string, ScheduledSession[]>();
  for (const s of visible) {
    const date = new Date(s.startsAt).toLocaleDateString("es-CL", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
    groups.set(date, [...(groups.get(date) ?? []), s]);
  }
  function selectTemplate(id: string) {
    setTemplateId(id);
    const tpl = data?.templates.find((t) => t.id === id);
    if (tpl) {
      setType(tpl.type);
      setCapacity(String(tpl.capacity));
    }
  }
  return (
    <section>
      <PageHead
        eyebrow={coach ? "Mi jornada" : "Programación"}
        title="Clases y agenda"
        description="Organiza clases grupales, personalizadas y citas en una agenda sin solapes."
        actions={
          <div className="flex gap-2">
            {session?.role === "admin" && (
              <Button
                variant="outline"
                onClick={() => {
                  setTemplateOpen(true);
                  setFormError(null);
                }}
              >
                Nueva clase
              </Button>
            )}
            <Button
              onClick={() => {
                setOpen(true);
                setFormError(null);
                setInstructorId(data?.instructors[0]?.id ?? "");
              }}
            >
              <Plus className="h-4 w-4" />
              Programar sesión
            </Button>
          </div>
        }
      />
      <ErrorNotice message={error} retry={() => void reload()} />
      <div className="mb-5 flex flex-wrap items-end gap-3">
        <div className="mr-auto flex gap-1 rounded-lg border bg-card p-1">
          <Button
            size="sm"
            variant={view === "agenda" ? "default" : "ghost"}
            onClick={() => setView("agenda")}
          >
            Agenda
          </Button>
          <Button
            size="sm"
            variant={view === "templates" ? "default" : "ghost"}
            onClick={() => setView("templates")}
          >
            Clases configuradas
          </Button>
        </div>
        {view === "agenda" && (
          <>
            <div>
              <Label htmlFor="agenda-day">Día</Label>
              <Input
                id="agenda-day"
                type="date"
                value={day}
                onChange={(e) => setDay(e.target.value)}
              />
            </div>
            {!coach && (
              <Select
                id="agenda-coach"
                label="Instructor"
                value={instructorFilter}
                onChange={(e) => setInstructorFilter(e.target.value)}
              >
                <option value="">Todos</option>
                {data?.instructors.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </Select>
            )}
            <Button
              variant="outline"
              onClick={() => {
                setDay("");
                setInstructorFilter("");
              }}
            >
              Ver todo
            </Button>
          </>
        )}
      </div>
      {loading && !data ? (
        <Loading />
      ) : view === "agenda" ? (
        <div className="space-y-6">
          {[...groups].map(([date, list]) => (
            <div key={date}>
              <h2 className="mb-3 text-sm font-semibold capitalize">{date}</h2>
              <div className="divide-y rounded-xl border bg-card">
                {list.map((s) => (
                  <div key={s.id} className="flex flex-wrap items-center gap-4 p-5">
                    <div className="w-20 shrink-0">
                      <p className="font-semibold tabular-nums">
                        {new Date(s.startsAt).toLocaleTimeString("es-CL", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {new Date(s.endsAt).toLocaleTimeString("es-CL", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{s.title}</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {s.instructorName} · {types[s.type]}
                      </p>
                      {s.type !== "bloqueo" && (
                        <p className="mt-2 text-xs text-muted-foreground">
                          {s.booked}/{s.capacity} reservas · {s.remaining} plazas disponibles
                        </p>
                      )}
                    </div>
                    <SessionStateBadge state={s.state} />
                    <div className="flex gap-2">
                      <Link
                        to={`/clases/${s.id}`}
                        className="inline-flex items-center gap-1 rounded-md border px-3 py-2 text-sm"
                      >
                        Ver sesión
                        <ArrowUpRight className="h-3 w-3" />
                      </Link>
                      {s.state === "programada" && (
                        <Button size="sm" variant="ghost" onClick={() => setCancel(s)}>
                          Cancelar
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {visible.length === 0 && (
            <div className="rounded-xl border bg-card p-12 text-center">
              <CalendarDays className="mx-auto mb-4 h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">No hay sesiones en esta selección.</p>
            </div>
          )}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {data?.templates.map((t: ClassTemplate) => (
            <article key={t.id} className="rounded-xl border bg-card p-6">
              <p className="text-xs text-primary">{types[t.type]}</p>
              <h2 className="mt-2 text-lg font-semibold">{t.name}</h2>
              <p className="mt-3 text-sm text-muted-foreground">
                {t.capacity} plazas · cobertura{" "}
                {t.coverageRequired === "unlimited"
                  ? "ilimitada"
                  : t.coverageRequired === "limited"
                    ? "limitada"
                    : "no requerida"}
              </p>
              <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                Cancelación anticipada: {t.cancellationWindowHours} h
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-5"
                onClick={() => {
                  selectTemplate(t.id);
                  setInstructorId(data.instructors[0]?.id ?? "");
                  setOpen(true);
                }}
              >
                Programar esta clase
              </Button>
            </article>
          ))}
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Programar sesión</DialogTitle>
            <DialogDescription>Los cupos y conflictos se verifican al publicar.</DialogDescription>
          </DialogHeader>
          <form onSubmit={create} className="space-y-4">
            <ErrorNotice message={formError} />
            <Select
              id="session-type"
              label="Modalidad"
              value={type}
              onChange={(e) => {
                setType(e.target.value as typeof type);
                setTemplateId("");
              }}
            >
              {Object.entries(types).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </Select>
            {(type === "grupal" || type === "fija") && (
              <Select
                id="session-template"
                label="Clase configurada"
                value={templateId}
                onChange={(e) => selectTemplate(e.target.value)}
              >
                <option value="">Sin plantilla</option>
                {data?.templates
                  .filter((t) => t.type === type)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
              </Select>
            )}
            <Select
              id="session-instructor"
              label="Instructor"
              value={coach ? session.user.id : instructorId}
              disabled={coach}
              required
              onChange={(e) => setInstructorId(e.target.value)}
            >
              <option value="">Selecciona instructor</option>
              {data?.instructors.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </Select>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="session-start">Inicio</Label>
                <Input
                  id="session-start"
                  type="datetime-local"
                  required
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="session-end">Fin</Label>
                <Input
                  id="session-end"
                  type="datetime-local"
                  required
                  min={start}
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                />
              </div>
            </div>
            {type !== "bloqueo" && (
              <div>
                <Label htmlFor="session-capacity">Cupo</Label>
                <Input
                  id="session-capacity"
                  type="number"
                  min="1"
                  step="1"
                  value={type === "cita" ? "1" : capacity}
                  disabled={type === "cita"}
                  onChange={(e) => setCapacity(e.target.value)}
                />
              </div>
            )}
            <Button type="submit" disabled={busy || (!coach && !instructorId)}>
              {busy ? "Publicando…" : "Crear sesión"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={templateOpen} onOpenChange={setTemplateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nueva clase</DialogTitle>
            <DialogDescription>
              Configura capacidad y políticas de reserva y cancelación.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={templateCreate} className="space-y-4">
            <ErrorNotice message={formError} />
            <div>
              <Label htmlFor="template-name">Nombre de la clase</Label>
              <Input
                id="template-name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <Select
              id="template-type"
              label="Tipo"
              value={templateType}
              onChange={(e) => setTemplateType(e.target.value as typeof templateType)}
            >
              <option value="grupal">Grupal</option>
              <option value="fija">Personalizada fija</option>
            </Select>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="template-capacity">Cupo</Label>
                <Input
                  id="template-capacity"
                  required
                  type="number"
                  min="1"
                  value={tplCapacity}
                  onChange={(e) => setTplCapacity(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="template-cancel">Cancelación (horas)</Label>
                <Input
                  id="template-cancel"
                  required
                  type="number"
                  min="0"
                  value={cancelHours}
                  onChange={(e) => setCancelHours(e.target.value)}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="template-reserve">Apertura de reservas (horas antes)</Label>
              <Input
                id="template-reserve"
                type="number"
                min="0"
                value={reserveHours}
                onChange={(e) => setReserveHours(e.target.value)}
              />
              <p className="mt-1 text-xs text-muted-foreground">0 = sin límite anticipado.</p>
            </div>
            <Select
              id="template-coverage"
              label="Cobertura requerida"
              value={coverage}
              onChange={(e) => setCoverage(e.target.value as typeof coverage)}
            >
              <option value="unlimited">Ilimitada</option>
              <option value="limited">Limitada</option>
              <option value="none">No requerida</option>
            </Select>
            <Button type="submit" disabled={busy}>
              {busy ? "Creando…" : "Crear clase"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
      <Confirm
        open={cancel !== null}
        onOpenChange={(o) => !o && setCancel(null)}
        title="Cancelar sesión"
        description="Todas las reservas de esta sesión se cancelarán según la política del gimnasio. La acción queda registrada."
        label="Cancelar sesión"
        destructive
        busy={busy}
        onConfirm={() => {
          if (!cancel) return;
          setBusy(true);
          void api
            .cancelSession(cancel.id)
            .then(() => {
              setCancel(null);
              toast.success("Sesión cancelada");
              void reload();
            })
            .catch((e) => toast.error(e.message))
            .finally(() => setBusy(false));
        }}
      />
    </section>
  );
}
