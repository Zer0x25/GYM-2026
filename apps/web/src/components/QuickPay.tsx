/**
 * Quick-pay drawer (ADR-0003 reception UX): 2-step flow to register a
 * PROVISIONAL payment on a member's membership. Pick the membership, pick
 * the method, done — the payment lands in the admin's validation tray.
 *
 * The backend enforces every money invariant (provisional grants no rights,
 * transfer needs a reference, etc.); this is just the fast counter flow.
 */
import { useState } from "react";
import { toast } from "sonner";
import { Banknote, CreditCard } from "lucide-react";
import { ApiError, api, formatCLP, type Membership, type Plan } from "../api.js";
import { Button } from "../components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog.js";
import { Input, Label } from "../components/ui/input.js";
import { cn } from "../lib/cn.js";

export function QuickPay({
  open,
  onOpenChange,
  memberName,
  memberships,
  plans,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  memberName: string;
  memberships: Membership[];
  plans: Plan[];
  onDone: () => void;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [membershipId, setMembershipId] = useState<string>("");
  const [method, setMethod] = useState<"cash" | "transfer" | "transbank">("cash");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  function pickMembership(id: string) {
    setMembershipId(id);
    const m = memberships.find((item) => item.id === id);
    const plan = plans.find((p) => p.id === m?.planId);
    if (m && m.cycleRemainingCents !== undefined && m.cycleRemainingCents > 0) {
      setAmount(String(m.cycleRemainingCents));
    } else if (plan) {
      setAmount(String(plan.priceCents));
    }
    setStep(2);
  }

  function reset() {
    setStep(1);
    setMembershipId("");
    setAmount("");
    setReference("");
    setComment("");
    setMethod("cash");
  }

  async function onSubmit() {
    setBusy(true);
    try {
      await api.registerPayment({
        membershipId,
        amountCents: Number(amount),
        method,
        reference: method !== "cash" ? reference.trim() : undefined,
        comment: method === "transbank" ? comment.trim() : undefined,
      });
      toast.success("Pago registrado — queda provisional hasta validación");
      reset();
      onOpenChange(false);
      onDone();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "No se pudo registrar el pago");
    } finally {
      setBusy(false);
    }
  }

  const canSubmit =
    Number.isSafeInteger(Number(amount)) &&
    Number(amount) > 0 &&
    (method === "cash" || reference.trim().length > 0) &&
    (method !== "transbank" ||
      (reference.trim().length <= 200 &&
        comment.trim().length > 0 &&
        comment.trim().length <= 1000));

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cobro rápido — {memberName}</DialogTitle>
          <DialogDescription>
            Paso {step} de 2 · {step === 1 ? "selecciona la membresía" : "método y monto"}. El pago
            queda provisional hasta que un admin lo valide.
          </DialogDescription>
        </DialogHeader>

        {step === 1 ? (
          <div className="space-y-2">
            {memberships.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                Este socio no tiene membresías. Asigna un plan primero.
              </p>
            ) : (
              memberships.map((m) => {
                const plan = plans.find((p) => p.id === m.planId);
                const hasPartial = (m.cyclePaidCents ?? 0) > 0;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => pickMembership(m.id)}
                    className="flex w-full items-center justify-between rounded-md border p-3 text-left hover:bg-accent"
                  >
                    <div>
                      <span className="font-medium">{plan?.name ?? "Plan"}</span>
                      {hasPartial && (
                        <p className="text-xs text-amber-600 font-medium">
                          {formatCLP(m.cyclePaidCents!)} pagado / {formatCLP(m.cycleRemainingCents ?? (plan?.priceCents ?? 0) - m.cyclePaidCents!)} pendiente
                        </p>
                      )}
                    </div>
                    <span className="text-sm text-muted-foreground">
                      {formatCLP(hasPartial ? (m.cycleRemainingCents ?? (plan?.priceCents ?? 0) - m.cyclePaidCents!) : (plan?.priceCents ?? 0))}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <button
                type="button"
                onClick={() => setMethod("cash")}
                className={cn(
                  "flex items-center justify-center gap-2 rounded-md border p-3 text-sm font-medium",
                  method === "cash"
                    ? "border-primary bg-primary/10 text-primary"
                    : "hover:bg-accent",
                )}
              >
                <Banknote className="h-4 w-4" /> Efectivo
              </button>
              <button
                type="button"
                onClick={() => setMethod("transfer")}
                className={cn(
                  "flex items-center justify-center gap-2 rounded-md border p-3 text-sm font-medium",
                  method === "transfer"
                    ? "border-primary bg-primary/10 text-primary"
                    : "hover:bg-accent",
                )}
              >
                <CreditCard className="h-4 w-4" /> Transferencia
              </button>
              <button
                type="button"
                onClick={() => setMethod("transbank")}
                className={cn(
                  "flex items-center justify-center gap-2 rounded-md border p-3 text-sm font-medium",
                  method === "transbank"
                    ? "border-primary bg-primary/10 text-primary"
                    : "hover:bg-accent",
                )}
              >
                <CreditCard className="h-4 w-4" /> Transbank externo
              </button>
            </div>
            <div className="space-y-2">
              <Label htmlFor="amount">Monto (CLP)</Label>
              <Input
                id="amount"
                type="number"
                min="1"
                step="1"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            {method !== "cash" ? (
              <div className="space-y-2">
                <Label htmlFor="ref">
                  {method === "transbank"
                    ? "Número de operación (obligatorio)"
                    : "Referencia bancaria (obligatoria)"}
                </Label>
                <Input
                  id="ref"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="TRX-..."
                />
              </div>
            ) : null}
            {method === "transbank" && (
              <div className="space-y-2">
                <Label htmlFor="payment-comment">Comentario (obligatorio)</Label>
                <Input
                  id="payment-comment"
                  maxLength={1000}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Identifica el cobro externo, sin datos de tarjeta"
                />
                <p className="text-xs text-muted-foreground">
                  Registra un cobro ya realizado fuera de la app. No ingreses números de tarjeta ni
                  códigos de seguridad.
                </p>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {step === 2 ? (
            <Button variant="outline" onClick={() => setStep(1)}>
              Atrás
            </Button>
          ) : null}
          {step === 2 ? (
            <Button disabled={busy || !canSubmit} onClick={() => void onSubmit()}>
              {busy ? "Registrando…" : "Registrar pago"}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
