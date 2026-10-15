import { paymentMethodLabel } from "../lib/payment-method.js";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { Lock, Unlock, RefreshCw } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { api, formatCLP, type CashMovement, type CashSession } from "../api.js";
import { useResource } from "../hooks/use-resource.js";
import { PageHead, ErrorNotice, Loading, Stat } from "../components/ui/page.js";
import { DataTable } from "../components/ui/data-table.js";
import { Button } from "../components/ui/button.js";
import { Input, Label } from "../components/ui/input.js";
import { Confirm } from "../components/ui/confirm.js";
export function Cash() {
  const loader = useCallback(async () => {
    const session = await api.currentCashSession();
    const movements = session ? (await api.getCashSession(session.id)).movements : [];
    return { session, movements };
  }, []);
  const { data, error, loading, reload } = useResource(loader);
  const [dialog, setDialog] = useState<"open" | "close" | null>(null),
    [amount, setAmount] = useState(""),
    [busy, setBusy] = useState(false),
    [lastClosed, setLastClosed] = useState<CashSession | null>(null);
  const expected = data?.session
    ? data.session.openingCents + data.movements.reduce((sum, m) => sum + m.amountCents, 0)
    : 0;
  const cash =
    data?.movements.filter((m) => m.method === "cash").reduce((sum, m) => sum + m.amountCents, 0) ??
    0;
  const transfer =
    data?.movements
      .filter((m) => m.method === "transfer")
      .reduce((sum, m) => sum + m.amountCents, 0) ?? 0;
  const transbank =
    data?.movements
      .filter((m) => m.method === "transbank")
      .reduce((sum, m) => sum + m.amountCents, 0) ?? 0;
  async function submit() {
    if (busy) return;
    if (!amount.trim() || !Number.isSafeInteger(Number(amount)) || Number(amount) < 0) {
      toast.error("Ingresa un monto entero igual o mayor a cero");
      return;
    }
    setBusy(true);
    try {
      if (dialog === "open") {
        await api.openCashSession(Number(amount));
        setLastClosed(null);
        toast.success("Turno abierto");
      } else if (data?.session) {
        setLastClosed(await api.closeCashSession(data.session.id, Number(amount)));
        toast.success("Turno cerrado y conciliado");
      }
      setDialog(null);
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo actualizar caja");
    } finally {
      setBusy(false);
    }
  }
  const columns: ColumnDef<CashMovement>[] = [
    {
      accessorKey: "createdAt",
      header: "Hora",
      cell: ({ getValue }) => new Date(getValue() as string).toLocaleTimeString("es-CL"),
    },
    { accessorKey: "type", header: "Movimiento", cell: () => "Ingreso validado" },
    {
      accessorKey: "method",
      header: "Método",
      cell: ({ getValue }) => paymentMethodLabel(getValue()),
    },
    {
      accessorKey: "amountCents",
      header: "Monto",
      cell: ({ getValue }) => formatCLP(getValue() as number),
    },
  ];
  return (
    <section>
      <PageHead
        eyebrow="Finanzas"
        title="Caja"
        description="Controla el turno y concilia los cobros confirmados. Los pagos pendientes aún no cuentan como movimientos."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => void reload()}>
              <RefreshCw className="h-4 w-4" />
              Actualizar
            </Button>
            {data && !error && (
              <Button
                variant={data.session ? "outline" : "default"}
                onClick={() => {
                  setAmount("");
                  setDialog(data.session ? "close" : "open");
                }}
              >
                {data.session ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
                {data.session ? "Cerrar turno" : "Abrir turno"}
              </Button>
            )}
          </div>
        }
      />
      <ErrorNotice message={error} retry={() => void reload()} />
      {loading && !data ? (
        <Loading />
      ) : (
        data && (
          <>
            <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
              <Stat
                label="Estado del turno"
                value={data.session ? "Abierto" : "Cerrado"}
                note={
                  data.session
                    ? `Apertura ${formatCLP(data.session.openingCents)}`
                    : "Sin turno activo"
                }
              />
              <Stat
                label="Efectivo validado"
                value={formatCLP(cash)}
                note={`${data.movements.filter((m) => m.method === "cash").length} movimientos`}
              />
              <Stat
                label="Transferencias validadas"
                value={formatCLP(transfer)}
                note={`${data.movements.filter((m) => m.method === "transfer").length} movimientos`}
              />
              <Stat
                label="Transbank externo"
                value={formatCLP(transbank)}
                note="Cobros registrados y validados manualmente"
              />
              <Stat
                label="Total esperado"
                value={formatCLP(expected)}
                note="Apertura + todos los movimientos"
              />
            </div>
            {lastClosed && (
              <article className="mb-6 rounded-xl border bg-card p-5">
                <h2 className="font-semibold">Último cierre</h2>
                <div className="mt-3 flex flex-wrap gap-6 text-sm">
                  <span>Esperado: {formatCLP(lastClosed.expectedClosingCents ?? 0)}</span>
                  <span>Declarado: {formatCLP(lastClosed.declaredClosingCents ?? 0)}</span>
                  <span
                    className={lastClosed.discrepancyCents ? "text-destructive" : "text-success"}
                  >
                    Diferencia: {formatCLP(lastClosed.discrepancyCents ?? 0)}
                  </span>
                </div>
              </article>
            )}
            <h2 className="mb-4 font-semibold">Movimientos del turno</h2>
            <DataTable
              data={data.movements}
              columns={columns}
              empty={
                data.session
                  ? "Sin cobros validados todavía."
                  : "Abre un turno para comenzar la jornada."
              }
            />
          </>
        )
      )}
      <Confirm
        open={dialog !== null}
        onOpenChange={(o) => !o && setDialog(null)}
        title={dialog === "open" ? "Abrir turno de caja" : "Cerrar turno"}
        description={
          dialog === "open"
            ? "Registra el fondo de apertura en pesos chilenos."
            : `Total esperado: ${formatCLP(expected)}. Incluye efectivo, transferencias y Transbank externo según la conciliación del sistema. El cierre es definitivo y registra cualquier diferencia.`
        }
        label={dialog === "open" ? "Abrir turno" : "Confirmar cierre"}
        destructive={dialog === "close"}
        busy={busy}
        onConfirm={() => void submit()}
      >
        <div>
          <Label htmlFor="cash-amount">
            {dialog === "open" ? "Monto de apertura (CLP)" : "Monto declarado al cierre (CLP)"}
          </Label>
          <Input
            id="cash-amount"
            type="number"
            step="1"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          {dialog === "close" && amount.trim() && (
            <p className="mt-3 text-sm">
              Diferencia: <strong>{formatCLP(Number(amount) - expected)}</strong>
            </p>
          )}
        </div>
      </Confirm>
    </section>
  );
}
