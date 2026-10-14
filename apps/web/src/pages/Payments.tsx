import { useCallback, useState } from "react";
import { toast } from "sonner";
import { Check, X } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { api, formatCLP, type Payment, type PaymentState } from "../api.js";
import { useSession } from "../session.js";
import { useResource } from "../hooks/use-resource.js";
import { PageHead, ErrorNotice, Loading } from "../components/ui/page.js";
import { DataTable } from "../components/ui/data-table.js";
import { PaymentStateBadge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
import { Input, Label } from "../components/ui/input.js";
import { Confirm } from "../components/ui/confirm.js";
export function Payments() {
  const { session } = useSession();
  const [tab, setTab] = useState<PaymentState>("provisional"),
    [query, setQuery] = useState(""),
    [decision, setDecision] = useState<{ payment: Payment; type: "validate" | "reject" } | null>(
      null,
    ),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false);
  const loader = useCallback(async () => {
    const [payments, members] = await Promise.all([api.listPayments(tab), api.listMembers()]);
    return { payments, members: new Map(members.map((m) => [m.id, m.fullName])) };
  }, [tab]);
  const { data, error, loading, reload } = useResource(loader);
  async function decide() {
    if (!decision || busy) return;
    if (decision.type === "reject" && !reason.trim()) {
      toast.error("Indica el motivo del rechazo");
      return;
    }
    setBusy(true);
    try {
      if (decision.type === "validate") await api.validatePayment(decision.payment.id);
      else await api.rejectPayment(decision.payment.id, reason.trim());
      toast.success(
        decision.type === "validate"
          ? "Pago validado. Membresía y caja actualizadas."
          : "Pago rechazado",
      );
      setDecision(null);
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo decidir el pago");
    } finally {
      setBusy(false);
    }
  }
  const admin = session?.role === "admin";
  const columns: ColumnDef<Payment>[] = [
    {
      id: "member",
      header: "Socio",
      accessorFn: (p) => data?.members.get(p.memberId) ?? "Socio",
      cell: ({ getValue }) => <span className="font-medium">{getValue() as string}</span>,
    },
    {
      accessorKey: "amountCents",
      header: "Monto",
      cell: ({ getValue }) => formatCLP(getValue() as number),
    },
    {
      accessorKey: "method",
      header: "Método",
      cell: ({ getValue }) => (getValue() === "cash" ? "Efectivo" : "Transferencia"),
    },
    {
      accessorKey: "reference",
      header: "Referencia",
      cell: ({ getValue }) => String(getValue() ?? "—"),
    },
    {
      accessorKey: "state",
      header: "Estado",
      cell: ({ row }) => <PaymentStateBadge state={row.original.state} />,
    },
    {
      accessorKey: "createdAt",
      header: "Registro",
      cell: ({ getValue }) => new Date(getValue() as string).toLocaleDateString("es-CL"),
    },
    ...(admin && tab === "provisional"
      ? [
          {
            id: "actions",
            header: "Decisión",
            cell: ({ row }: { row: { original: Payment } }) =>
              row.original.registeredBy === session.user.id ? (
                <span className="text-xs text-muted-foreground">Requiere otro administrador</span>
              ) : (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setDecision({ payment: row.original, type: "validate" })}
                  >
                    <Check className="h-3 w-3" />
                    Validar
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setReason("");
                      setDecision({ payment: row.original, type: "reject" });
                    }}
                  >
                    <X className="h-3 w-3" />
                    Rechazar
                  </Button>
                </div>
              ),
          },
        ]
      : []),
  ];
  return (
    <section>
      <PageHead
        eyebrow="Finanzas"
        title="Pagos"
        description="Revisa los cobros registrados. Solo un administrador distinto de quien cobró puede confirmar o rechazar."
      />
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <div className="inline-flex rounded-lg border bg-card p-1">
          {(["provisional", "validated", "rejected"] as PaymentState[]).map((t) => (
            <Button
              key={t}
              size="sm"
              variant={tab === t ? "default" : "ghost"}
              onClick={() => setTab(t)}
            >
              {t === "provisional" ? "Pendientes" : t === "validated" ? "Validados" : "Rechazados"}
            </Button>
          ))}
        </div>
        <Input
          type="search"
          aria-label="Buscar pagos"
          className="max-w-xs"
          placeholder="Socio o referencia…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <ErrorNotice message={error} retry={() => void reload()} />
      {loading && !data ? (
        <Loading />
      ) : (
        <DataTable
          data={(data?.payments ?? []).filter((p) =>
            `${data?.members.get(p.memberId) ?? ""} ${p.reference ?? ""}`
              .toLowerCase()
              .includes(query.toLowerCase()),
          )}
          columns={columns}
          empty="No hay pagos en esta selección."
        />
      )}
      {!admin && (
        <p className="mt-4 text-xs text-muted-foreground">
          Los pagos registrados permanecen pendientes hasta la revisión de administración.
        </p>
      )}
      <Confirm
        open={decision !== null}
        onOpenChange={(o) => !o && setDecision(null)}
        title={decision?.type === "validate" ? "Validar pago" : "Rechazar pago"}
        description={
          decision?.type === "validate"
            ? `Confirmar ${formatCLP(decision.payment.amountCents)} para ${data?.members.get(decision.payment.memberId) ?? "este socio"} activará el período correspondiente y registrará el movimiento en el turno abierto. Esta decisión es definitiva.`
            : "El pago quedará rechazado sin activar derechos ni generar un movimiento de caja. Registra un motivo para la auditoría."
        }
        label={decision?.type === "validate" ? "Confirmar validación" : "Confirmar rechazo"}
        destructive={decision?.type === "reject"}
        busy={busy}
        onConfirm={() => void decide()}
      >
        {decision?.type === "reject" && (
          <div>
            <Label htmlFor="reject-reason">Motivo del rechazo</Label>
            <Input
              id="reject-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
            />
          </div>
        )}
      </Confirm>
    </section>
  );
}
