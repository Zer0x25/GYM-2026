/**
 * Cash page — shift management and reconciliation (ADR-0003, REQ-3).
 *
 * Opens/closes the cash shift and shows the live movement feed + daily
 * consolidation. Close is idempotent (the backend returns 409 on a double
 * close); the UI just surfaces it. Discrepancy (declared − expected) is
 * recorded, never blocking — shown here for the cashier.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Wallet, Lock, Unlock } from "lucide-react";
import { ApiError, api, formatCLP, type CashMovement, type CashSession } from "../api.js";
import { Button } from "../components/ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table.js";
import { Input, Label } from "../components/ui/input.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog.js";

export function Cash() {
  const [session, setSession] = useState<CashSession | null>(null);
  const [movements, setMovements] = useState<CashMovement[]>([]);
  const [error, setError] = useState<string | null>(null);

  // open dialog
  const [openDialog, setOpenDialog] = useState(false);
  const [opening, setOpening] = useState("");
  // close dialog
  const [closeDialog, setCloseDialog] = useState(false);
  const [declared, setDeclared] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const current = await api.currentCashSession();
      setSession(current);
      if (current) {
        const detail = await api.getCashSession(current.id);
        setMovements(detail.movements);
      } else {
        setMovements([]);
      }
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Error al cargar caja");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const expected = session
    ? session.openingCents + movements.reduce((s, m) => s + m.amountCents, 0)
    : 0;

  async function onOpen() {
    setBusy(true);
    try {
      await api.openCashSession(Number(opening) || 0);
      toast.success("Turno de caja abierto");
      setOpenDialog(false);
      setOpening("");
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "No se pudo abrir el turno");
    } finally {
      setBusy(false);
    }
  }

  async function onClose() {
    if (!session) return;
    setBusy(true);
    try {
      const closed = await api.closeCashSession(session.id, Number(declared) || 0);
      toast.success("Turno cerrado");
      if (closed.discrepancyCents && closed.discrepancyCents !== 0) {
        toast.warning(`Discrepancia registrada: ${formatCLP(closed.discrepancyCents)}`);
      }
      setCloseDialog(false);
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "No se pudo cerrar el turno");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="cash-title">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 id="cash-title" className="text-2xl font-bold">
            Caja
          </h1>
          <p className="text-sm text-muted-foreground">
            Turno, movimientos y conciliación del día.
          </p>
        </div>
        {session ? (
          <Button variant="destructive" onClick={() => { setDeclared(""); setCloseDialog(true); }}>
            <Lock className="h-4 w-4" /> Cerrar turno
          </Button>
        ) : (
          <Button variant="success" onClick={() => { setOpening(""); setOpenDialog(true); }}>
            <Unlock className="h-4 w-4" /> Abrir turno
          </Button>
        )}
      </div>

      {error ? (
        <p role="alert" className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader><CardTitle className="text-sm text-muted-foreground">Estado</CardTitle></CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 text-lg font-semibold">
              <Wallet className="h-5 w-5" />
              {session ? "Abierto" : "Cerrado"}
            </div>
            {session ? (
              <p className="mt-1 text-sm text-muted-foreground">Apertura {formatCLP(session.openingCents)}</p>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">Sin turno activo</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm text-muted-foreground">Movimientos</CardTitle></CardHeader>
          <CardContent>
            <p className="text-lg font-semibold">{movements.length}</p>
            <p className="mt-1 text-sm text-muted-foreground">pagos validados del turno</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm text-muted-foreground">Esperado en caja</CardTitle></CardHeader>
          <CardContent>
            <p className="text-lg font-semibold">{formatCLP(expected)}</p>
            <p className="mt-1 text-sm text-muted-foreground">apertura + movimientos</p>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader><CardTitle>Movimientos del turno</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Hora</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Método</TableHead>
                <TableHead className="text-right">Monto</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {movements.map((m) => (
                <TableRow key={m.id}>
                  <TableCell>{new Date(m.createdAt).toLocaleTimeString("es-CL")}</TableCell>
                  <TableCell>{m.type === "income" ? "Ingreso" : m.type}</TableCell>
                  <TableCell>{m.method === "cash" ? "Efectivo" : "Transferencia"}</TableCell>
                  <TableCell className="text-right font-medium">{formatCLP(m.amountCents)}</TableCell>
                </TableRow>
              ))}
              {movements.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                    {session ? "Sin movimientos todavía." : "Abrí un turno para empezar."}
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Open dialog */}
      <Dialog open={openDialog} onOpenChange={setOpenDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Abrir turno de caja</DialogTitle>
            <DialogDescription>Ingresá el monto de apertura en pesos (ej: 20000).</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="opening">Monto de apertura (CLP)</Label>
            <Input id="opening" type="number" value={opening} onChange={(e) => setOpening(e.target.value)} placeholder="20000" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenDialog(false)}>Cancelar</Button>
            <Button disabled={busy} onClick={() => void onOpen()}>Abrir turno</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Close dialog — expected shown, discrepancy recorded not blocking */}
      <Dialog open={closeDialog} onOpenChange={setCloseDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cerrar turno</DialogTitle>
            <DialogDescription>
              Esperado en caja: <strong>{formatCLP(expected)}</strong>. La diferencia contra lo
              declarado se registra como discrepancia.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="declared">Monto contado (CLP)</Label>
            <Input id="declared" type="number" value={declared} onChange={(e) => setDeclared(e.target.value)} placeholder={String(expected)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloseDialog(false)}>Cancelar</Button>
            <Button variant="destructive" disabled={busy} onClick={() => void onClose()}>Cerrar turno</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
