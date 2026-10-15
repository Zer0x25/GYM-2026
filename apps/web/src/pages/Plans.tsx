import { useCallback, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Plus, Check } from "lucide-react";
import { api, formatCLP } from "../api.js";
import { useSession } from "../session.js";
import { useResource } from "../hooks/use-resource.js";
import { PageHead, ErrorNotice, Loading, Select } from "../components/ui/page.js";
import { Button } from "../components/ui/button.js";
import { Input, Label } from "../components/ui/input.js";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "../components/ui/dialog.js";
export function Plans() {
  const { session } = useSession();
  const loader = useCallback(() => api.listPlans(), []);
  const { data, error, loading, reload } = useResource(loader);
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [name, setName] = useState(""),
    [price, setPrice] = useState("30000"),
    [days, setDays] = useState("30"),
    [coverage, setCoverage] = useState<"none" | "unlimited" | "limited">("unlimited"),
    [quotas, setQuotas] = useState({ grupal: "", fija: "", cita: "" }),
    [formError, setFormError] = useState<string | null>(null);
  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      if (
        coverage === "limited" &&
        Object.values(quotas).some(
          (value) =>
            value === "" ||
            !Number.isInteger(Number(value)) ||
            Number(value) < 0 ||
            Number(value) > 100000,
        )
      )
        throw new Error("Configura las tres cantidades de créditos por período.");
      await api.createPlan({
        name: name.trim(),
        priceCents: Number(price),
        durationDays: Number(days),
        coverage,
        ...(coverage === "limited"
          ? {
              classCredits: {
                grupal: Number(quotas.grupal),
                fija: Number(quotas.fija),
                cita: Number(quotas.cita),
              },
            }
          : {}),
      });
      setOpen(false);
      setName("");
      setQuotas({ grupal: "", fija: "", cita: "" });
      toast.success("Plan creado");
      await reload();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "No se pudo crear el plan");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <PageHead
        eyebrow="Membresías"
        title="Planes"
        description="Define las opciones de tu gimnasio y asígnalas desde la ficha de cada socio."
        actions={
          session?.role === "admin" && (
            <Button onClick={() => setOpen(true)}>
              <Plus className="h-4 w-4" />
              Nuevo plan
            </Button>
          )
        }
      />
      <ErrorNotice message={error} retry={() => void reload()} />
      {loading && !data ? (
        <Loading />
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {data?.map((p) => (
            <article key={p.id} className="rounded-2xl border bg-card p-6">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {p.durationDays} días
              </p>
              <h2 className="mt-3 text-xl font-semibold">{p.name}</h2>
              <p className="mt-5 text-3xl font-semibold tracking-tight">
                {formatCLP(p.priceCents)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">CLP por período</p>
              <div className="my-5 border-t" />
              <p className="flex items-center gap-2 text-sm">
                <Check className="h-4 w-4 text-primary" />
                {p.coverage === "none"
                  ? "Sin cobertura de ingreso"
                  : p.coverage === "limited"
                    ? "Cobertura limitada"
                    : "Cobertura ilimitada"}
              </p>
              {p.coverage === "limited" && (
                <p className="mt-3 text-sm">
                  Por período: {p.grupalCredits ?? "sin configurar"} grupales ·{" "}
                  {p.fijaCredits ?? "sin configurar"} fijas · {p.citaCredits ?? "sin configurar"}{" "}
                  citas. Sin acumulación.
                </p>
              )}
              <p className="mt-3 text-xs text-muted-foreground">
                Se activa después de validar el pago.
              </p>
            </article>
          ))}
          {data?.length === 0 && (
            <p className="rounded-xl border bg-card p-8 text-muted-foreground">
              Crea tu primer plan para comenzar.
            </p>
          )}
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nuevo plan</DialogTitle>
            <DialogDescription>Precio en pesos chilenos y duración del período.</DialogDescription>
          </DialogHeader>
          <form onSubmit={create} className="space-y-4">
            <ErrorNotice message={formError} />
            <div>
              <Label htmlFor="plan-name">Nombre del plan</Label>
              <Input
                id="plan-name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="plan-price">Precio (CLP)</Label>
                <Input
                  id="plan-price"
                  type="number"
                  min="0"
                  step="1"
                  required
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="plan-days">Duración en días</Label>
                <Input
                  id="plan-days"
                  type="number"
                  min="1"
                  step="1"
                  required
                  value={days}
                  onChange={(e) => setDays(e.target.value)}
                />
              </div>
            </div>
            <Select
              id="plan-coverage"
              label="Cobertura"
              value={coverage}
              onChange={(e) => setCoverage(e.target.value as typeof coverage)}
            >
              <option value="unlimited">Ilimitada</option>
              <option value="limited">Limitada</option>
              <option value="none">Sin ingreso</option>
            </Select>
            {coverage === "limited" && (
              <fieldset className="space-y-3 rounded-lg border p-3">
                <legend className="px-1 text-sm font-medium">
                  Créditos separados · sin acumulación
                </legend>
                {(
                  [
                    ["grupal", "Créditos grupales por período"],
                    ["fija", "Créditos de fijas por período"],
                    ["cita", "Créditos de citas por período"],
                  ] as const
                ).map(([key, label]) => (
                  <div key={key}>
                    <Label htmlFor={`quota-${key}`}>{label}</Label>
                    <Input
                      id={`quota-${key}`}
                      type="number"
                      min="0"
                      max="100000"
                      step="1"
                      required
                      value={quotas[key]}
                      onChange={(e) => setQuotas({ ...quotas, [key]: e.target.value })}
                    />
                  </div>
                ))}
                <p className="text-xs text-muted-foreground">
                  0 no habilita esa modalidad. Cada período validado conserva sus propias
                  condiciones.
                </p>
              </fieldset>
            )}
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy ? "Creando…" : "Crear plan"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
