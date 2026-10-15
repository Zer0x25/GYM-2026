import { useEffect, useRef, useState } from "react";
import { api, formatCLP, type Payment, type FinancialAdjustment } from "../api.js";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog.js";
import { Button } from "./ui/button.js";
import { Input, Label } from "./ui/input.js";
import { Confirm } from "./ui/confirm.js";

export function PaymentAdjustmentDialog({
  payment,
  onClose,
  onDone,
}: {
  payment: Payment;
  onClose: () => void;
  onDone: () => void;
}) {
  const key = useRef(crypto.randomUUID());
  const [kind, setKind] = useState<"refund" | "adjustment">("refund");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [data, setData] = useState<{ items: FinancialAdjustment[]; remainingCents: number } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(false);
  useEffect(() => {
    let current = true;
    api
      .getFinancialAdjustments(payment.id)
      .then((value) => {
        if (current) setData(value);
      })
      .catch(() => {
        if (current) setError("No se pudo consultar el saldo compensable");
      });
    return () => {
      current = false;
    };
  }, [payment.id]);
  async function submit() {
    if (busy) return;
    setBusy(true);
    setAttempted(true);
    setError(null);
    try {
      await api.adjustPayment(payment.id, {
        idempotencyKey: key.current,
        kind,
        amountCents: Number(amount),
        reason: reason.trim(),
      });
      onDone();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo confirmar la compensación");
    } finally {
      setBusy(false);
    }
  }
  const valid =
    data &&
    Number.isSafeInteger(Number(amount)) &&
    Number(amount) > 0 &&
    Number(amount) <= data.remainingCents &&
    reason.trim().length > 0;
  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open && !busy) onClose();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Compensar pago validado</DialogTitle>
            <DialogDescription>
              Registra una salida manual en el turno abierto. El pago original y la vigencia de la
              membresía se conservan.
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm">
            Disponible: {data ? formatCLP(data.remainingCents) : "Consultando…"}
          </p>
          {error && !confirm && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <label className="text-sm">
            Tipo
            <select
              aria-label="Tipo de compensación"
              className="ml-3 rounded-md border p-2"
              disabled={attempted}
              value={kind}
              onChange={(e) => setKind(e.target.value as typeof kind)}
            >
              <option value="refund">Devolución</option>
              <option value="adjustment">Ajuste de salida</option>
            </select>
          </label>
          <div>
            <Label htmlFor="adjustment-amount">Importe a compensar (CLP)</Label>
            <Input
              id="adjustment-amount"
              type="number"
              min="1"
              max={data?.remainingCents}
              step="1"
              value={amount}
              disabled={attempted}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="adjustment-reason">Motivo de la compensación</Label>
            <Input
              id="adjustment-reason"
              maxLength={1000}
              value={reason}
              disabled={attempted}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <Button disabled={!valid || busy} onClick={() => setConfirm(true)}>
            Revisar compensación
          </Button>
          <p className="text-xs text-muted-foreground">
            La app registra la salida; realiza y comprueba la devolución fuera de la app. Si falla
            la respuesta, reintenta esta misma intención sin cambiar sus datos.
          </p>
          {data?.items.map((item) => (
            <p key={item.id} className="break-words text-sm">
              {item.kind === "refund" ? "Devolución" : "Ajuste"}: {formatCLP(item.amountCents)} ·{" "}
              {item.reason}
            </p>
          ))}
        </DialogContent>
      </Dialog>
      <Confirm
        open={confirm}
        onOpenChange={setConfirm}
        title="Confirmar compensación"
        description={`Se registrará una salida de ${formatCLP(Number(amount))}. Motivo: ${reason.trim()}. El registro es definitivo y no cambia la membresía.`}
        label={kind === "refund" ? "Confirmar devolución" : "Confirmar ajuste"}
        busy={busy}
        destructive
        onConfirm={() => void submit()}
      >
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </Confirm>
    </>
  );
}
