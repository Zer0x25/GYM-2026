import { useCallback, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, UserCheck } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { api, type Booking } from "../api.js";
import { useSession } from "../session.js";
import { useResource } from "../hooks/use-resource.js";
import { PageHead, ErrorNotice, Loading, Select, Stat } from "../components/ui/page.js";
import { DataTable } from "../components/ui/data-table.js";
import { Button } from "../components/ui/button.js";
import { BookingStateBadge } from "../components/ui/badge.js";
export function SessionDetail() {
  const { id = "" } = useParams(),
    { session } = useSession();
  const loader = useCallback(async () => {
    const [session, bookings, members, schedule] = await Promise.all([
      api.getSession(id),
      api.roster(id),
      api.listMembers(),
      api.schedule(),
    ]);
    return { session, bookings, members, description: schedule.find((s) => s.id === id) };
  }, [id]);
  const { data, error, loading, reload } = useResource(loader);
  const [memberId, setMemberId] = useState(""),
    [busy, setBusy] = useState<string | null>(null);
  async function attendance(id: string, outcome: "asistio" | "ausencia") {
    setBusy(id);
    try {
      await api.markAttendance(id, outcome);
      toast.success(outcome === "asistio" ? "Asistencia registrada" : "Ausencia registrada");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo marcar asistencia");
    } finally {
      await reload();
      setBusy(null);
    }
  }
  async function enroll() {
    if (!memberId) return;
    setBusy("enroll");
    try {
      await api.createBooking({ sessionId: id, memberId });
      toast.success("Reserva confirmada");
      setMemberId("");
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo reservar");
    } finally {
      setBusy(null);
    }
  }
  const names = new Map(data?.members.map((m) => [m.id, m.fullName]));
  const columns: ColumnDef<Booking>[] = [
    { id: "name", header: "Socio", accessorFn: (b) => names.get(b.memberId) ?? "Socio" },
    {
      accessorKey: "state",
      header: "Estado",
      cell: ({ row }) => <BookingStateBadge state={row.original.state} />,
    },
    {
      accessorKey: "createdAt",
      header: "Reservada",
      cell: ({ getValue }) => new Date(getValue() as string).toLocaleDateString("es-CL"),
    },
    {
      id: "attendance",
      header: "Asistencia",
      cell: ({ row }) =>
        row.original.state === "confirmada" && data?.session.state === "programada" ? (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy !== null || row.original.attendance === "asistio"}
              onClick={() => void attendance(row.original.id, "asistio")}
            >
              <UserCheck className="h-3 w-3" />
              {row.original.attendance === "asistio" ? "Registrada" : "Asistió"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy !== null}
              onClick={() => void attendance(row.original.id, "ausencia")}
            >
              Ausencia
            </Button>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
  ];
  if (loading && !data) return <Loading />;
  if (!data) return <ErrorNotice message={error} retry={() => void reload()} />;
  const booked = data.bookings.filter((b) => b.state === "confirmada").length;
  return (
    <section>
      <Link
        to="/clases"
        className="mb-5 inline-flex items-center gap-2 text-sm text-muted-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Volver a la agenda
      </Link>
      <PageHead
        eyebrow="Sesión"
        title={data.description?.title ?? "Detalle de sesión"}
        description={`${data.description?.instructorName ?? "Instructor"} · ${new Date(data.session.startsAt).toLocaleString("es-CL", { dateStyle: "medium", timeStyle: "short" })}`}
      />
      <ErrorNotice message={error} />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label="Reservas confirmadas" value={booked} note="Incluye asistencia registrada" />
        <Stat label="Capacidad" value={data.session.capacity} note="Cupo publicado" />
        <Stat
          label="Plazas disponibles"
          value={Math.max(0, data.session.capacity - booked)}
          note="El servidor confirma la última plaza"
        />
      </div>
      {session?.role !== "instructor" &&
        data.session.state === "programada" &&
        data.session.type !== "bloqueo" && (
          <div className="mb-6 flex items-end gap-3 rounded-xl border bg-card p-5">
            <div className="flex-1">
              <Select
                id="enroll-member"
                label="Reservar para un socio"
                value={memberId}
                onChange={(e) => setMemberId(e.target.value)}
              >
                <option value="">Selecciona socio</option>
                {data.members
                  .filter(
                    (m) =>
                      !data.bookings.some((b) => b.memberId === m.id && b.state === "confirmada"),
                  )
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.fullName}
                    </option>
                  ))}
              </Select>
            </div>
            <Button disabled={busy !== null || !memberId} onClick={() => void enroll()}>
              Confirmar reserva
            </Button>
          </div>
        )}
      <DataTable
        data={data.bookings}
        columns={columns}
        empty="Aún no hay reservas para esta sesión."
      />
    </section>
  );
}
