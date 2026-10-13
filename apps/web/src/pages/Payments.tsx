/**
 * Payments page — the reception validation tray (ADR-0003, REQ-2).
 *
 * Shows provisional payments awaiting a human decision, with validate/reject
 * actions (admin only). The backend is the authority: it enforces that only
 * an admin decides, never their own registration, and that a validated
 * payment is immutable. The UI just reflects those rules and surfaces the
 * API errors (403/409) as toasts.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, X, Receipt as ReceiptIcon } from "lucide-react";
import { ApiError, api, formatCLP, type Payment } from "../api.js";
import { useSession } from "../session.js";
import { Button } from "../components/ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.js";
import { Badge, PaymentStateBadge } from "../components/ui/badge.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog.js";
import { Input, Label } from "../components/ui/input.js";
import { Tabs, TabsList, TabsTrigger } from "../components/ui/tabs.js";
import { canDecidePayments } from "../permissions.js";

export function Payments() {
  const { session } = useSession();
  const isAdmin = canDecidePayments(session?.role);
  const [tab, setTab] = useState<"provisional" | "validated" | "rejected">("provisional");
  const [payments, setPayments] = useState<Payment[]>([]);
  const [members, setMembers] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Reject dialog state
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    try {
      const [rows, memberRows] = await Promise.all([api.listPayments(tab), api.listMembers()]);
      setPayments(rows);
      setMembers(new Map(memberRows.map((m) => [m.id, m.fullName])));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Error al cargar pagos");
    }
  }, [tab]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onValidate(id: string) {
    setBusyId(id);
    try {
      await api.validatePayment(id);
      toast.success("Pago validado — derechos y movimiento de caja registrados");
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "No se pudo validar");
    } finally {
      setBusyId(null);
    }
  }

  async function onReject() {
    if (!rejectId) return;
    setBusyId(rejectId);
    try {
      await api.rejectPayment(rejectId, reason.trim());
      toast.success("Pago rechazado");
      setRejectId(null);
      setReason("");
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "No se pudo rechazar");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section aria-labelledby="payments-title">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 id="payments-title" className="text-2xl font-bold">
            Pagos
          </h1>
          <p className="text-sm text-muted-foreground">
            Validación humana de cobros — el backend aplica las invariantes de dinero.
          </p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v: string) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="provisional">Provisionales</TabsTrigger>
          <TabsTrigger value="validated">Validados</TabsTrigger>
          <TabsTrigger value="rejected">Rechazados</TabsTrigger>
        </TabsList>
      </Tabs>

      {error ? (
        <p role="alert" className="mt-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ReceiptIcon className="h-5 w-5" />
            {tab === "provisional" ? "Esperando decisión" : "Historial"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Socio</TableHead>
                <TableHead>Monto</TableHead>
                <TableHead>Método</TableHead>
                <TableHead>Referencia</TableHead>
                <TableHead>Estado</TableHead>
                {isAdmin && tab === "provisional" ? <TableHead className="text-right">Acciones</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {payments.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{members.get(p.memberId) ?? p.memberId.slice(0, 8)}</TableCell>
                  <TableCell>{formatCLP(p.amountCents)}</TableCell>
                  <TableCell>{p.method === "cash" ? "Efectivo" : "Transferencia"}</TableCell>
                  <TableCell className="text-muted-foreground">{p.reference ?? "—"}</TableCell>
                  <TableCell><PaymentStateBadge state={p.state} /></TableCell>
                  {isAdmin && tab === "provisional" ? (
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="success"
                          disabled={busyId === p.id}
                          onClick={() => void onValidate(p.id)}
                        >
                          <Check className="h-4 w-4" /> Validar
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={busyId === p.id}
                          onClick={() => { setRejectId(p.id); setReason(""); }}
                        >
                          <X className="h-4 w-4" /> Rechazar
                        </Button>
                      </div>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
              {payments.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    Sin pagos en este estado.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
          {!isAdmin && tab === "provisional" ? (
            <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline">Solo admin</Badge>
              La validación y el rechazo los decide un administrador.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* Reject dialog — reason is mandatory and auditable */}
      <Dialog open={rejectId !== null} onOpenChange={(open) => !open && setRejectId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rechazar pago</DialogTitle>
            <DialogDescription>
              El rechazo es terminal e inmutable. El motivo queda en la auditoría.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="reason">Motivo (obligatorio)</Label>
            <Input
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ej: referencia bancaria no coincide"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectId(null)}>
              Cancelar
            </Button>
            <Button variant="destructive" disabled={!reason.trim() || busyId === rejectId} onClick={() => void onReject()}>
              Rechazar pago
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
