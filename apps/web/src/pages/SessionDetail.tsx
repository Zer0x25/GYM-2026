/**
 * Session detail for staff — the booking roster (spec 004).
 *
 * Shows confirmed count vs capacity (the last-slot story, TX-01), the
 * member roster, and attendance marking (asistio / ausencia). The backend
 * is the authority: capacity, the credit policy (TX-04) and role checks are
 * enforced server-side; the UI only reflects them.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { UserCheck, ArrowLeft } from "lucide-react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ApiError, api, type Booking, type Session } from "../api.js";
import { Button } from "../components/ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.js";
import { BookingStateBadge, SessionStateBadge } from "../components/ui/badge.js";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table.js";

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" });

export function SessionDetail() {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [members, setMembers] = useState<Map<string, string>>(new Map());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, b, memberRows] = await Promise.all([
        api.getSession(id),
        api.listBookings(id),
        api.listMembers(),
      ]);
      setSession(s);
      setBookings(b);
      setMembers(new Map(memberRows.map((m) => [m.id, m.fullName])));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Error al cargar la sesión");
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const confirmed = bookings.filter((b) => b.state === "confirmada");
  const remaining = session ? Math.max(0, session.capacity - confirmed.length) : 0;

  async function onAttendance(bookingId: string, outcome: "asistio" | "ausencia") {
    setBusyId(bookingId);
    try {
      await api.markAttendance(bookingId, outcome);
      toast.success(outcome === "asistio" ? "Asistencia registrada" : "Ausencia registrada");
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "No se pudo marcar asistencia");
    } finally {
      setBusyId(null);
    }
  }

  if (!session) {
    return (
      <section className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => navigate("/clases")}>
          <ArrowLeft className="h-4 w-4" /> Volver
        </Button>
        <p className="text-sm text-muted-foreground">{error ?? "Cargando sesión…"}</p>
      </section>
    );
  }

  return (
    <section aria-labelledby="session-title" className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 id="session-title" className="text-2xl font-bold">Sesión</h1>
          <p className="text-sm text-muted-foreground">
            {session.instructorId} · {fmtDateTime(session.startsAt)} — {fmtDateTime(session.endsAt)}
          </p>
        </div>
        <SessionStateBadge state={session.state} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cupo</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-6 text-sm">
          <span>Confirmados: <strong>{confirmed.length}</strong></span>
          <span>Cupo: <strong>{session.capacity}</strong></span>
          <span className={remaining === 0 ? "font-medium text-destructive" : "text-muted-foreground"}>
            {remaining === 0 ? "Sin plazas" : `Quedan ${remaining}`}
          </span>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Reservas</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Socio</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Beneficio</TableHead>
                <TableHead>Reservada</TableHead>
                <TableHead className="text-right">Asistencia</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bookings.map((b) => (
                <TableRow key={b.id}>
                  <TableCell className="font-medium">{members.get(b.memberId) ?? b.memberId.slice(0, 8)}</TableCell>
                  <TableCell><BookingStateBadge state={b.state} /></TableCell>
                  <TableCell>
                    {b.beneficioComprometido ? (
                      <span className="text-xs text-success">comprometido</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{new Date(b.createdAt).toLocaleString("es-CL")}</TableCell>
                  <TableCell className="text-right">
                    {b.state === "confirmada" ? (
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="success" disabled={busyId === b.id} onClick={() => void onAttendance(b.id, "asistio")}>
                          <UserCheck className="h-4 w-4" /> Asistió
                        </Button>
                        <Button size="sm" variant="warning" disabled={busyId === b.id} onClick={() => void onAttendance(b.id, "ausencia")}>
                          Ausencia
                        </Button>
                      </div>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
              {bookings.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">Sin reservas.</TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Link to="/clases" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline">
        <ArrowLeft className="h-4 w-4" /> Volver a clases
      </Link>
    </section>
  );
}
