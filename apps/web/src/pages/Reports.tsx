import { useCallback, useState } from "react";
import { Download } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { api, formatCLP, type CashSession } from "../api.js";
import { useResource } from "../hooks/use-resource.js";
import { PageHead, ErrorNotice, Loading, Stat } from "../components/ui/page.js";
import { DataTable } from "../components/ui/data-table.js";
import { Button } from "../components/ui/button.js";
import { Input, Label } from "../components/ui/input.js";
import { Badge } from "../components/ui/badge.js";
function getRangeError(from: string, to: string): string | null {
  if (!from || !to) return null;
  if (from > to) {
    return "Rango inválido: la fecha desde debe ser menor o igual a la fecha hasta.";
  }
  const fromDate = new Date(from);
  const toDate = new Date(to);
  const diffDays = Math.ceil((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays > 93) {
    return "Rango inválido: el rango no puede superar los 93 días.";
  }
  return null;
}

export function Reports() {
  const [date, setDate] = useState(() =>
    new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" }),
  );
  const [attendanceFrom, setAttendanceFrom] = useState(() =>
    new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" }),
  );
  const [attendanceTo, setAttendanceTo] = useState(() =>
    new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" }),
  );
  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);

  const loader = useCallback(() => api.dailyReport(date), [date]);
  const { data, error, loading, reload } = useResource(loader);
  const columns: ColumnDef<CashSession>[] = [
    {
      accessorKey: "openedAt",
      header: "Apertura",
      cell: ({ getValue }) =>
        new Date(getValue() as string).toLocaleTimeString("es-CL", {
          timeZone: "America/Santiago",
        }),
    },
    {
      accessorKey: "state",
      header: "Estado",
      cell: ({ getValue }) => (getValue() === "open" ? "Abierto" : "Cerrado"),
    },
    {
      accessorKey: "reconciliationState",
      header: "Conciliación",
      cell: ({ row }) => {
        const s = row.original;
        const rec =
          s.reconciliationState ??
          (s.state === "open"
            ? "abierta"
            : (s.discrepancyCents ?? 0) === 0
              ? "cuadrada"
              : "con_diferencia");
        const map = {
          abierta: { label: "Abierta", variant: "secondary" as const },
          cuadrada: { label: "Cuadrada", variant: "success" as const },
          con_diferencia: { label: "Con diferencia", variant: "destructive" as const },
        };
        const item = map[rec] ?? { label: rec, variant: "secondary" as const };
        return <Badge variant={item.variant}>{item.label}</Badge>;
      },
    },
    {
      accessorKey: "openingCents",
      header: "Fondo inicial",
      cell: ({ getValue }) => formatCLP(getValue() as number),
    },
    {
      accessorKey: "expectedClosingCents",
      header: "Esperado al cierre",
      cell: ({ getValue }) => (getValue() == null ? "—" : formatCLP(getValue() as number)),
    },
    {
      accessorKey: "declaredClosingCents",
      header: "Declarado",
      cell: ({ getValue }) => (getValue() == null ? "—" : formatCLP(getValue() as number)),
    },
    {
      accessorKey: "discrepancyCents",
      header: "Diferencia",
      cell: ({ getValue }) => (getValue() == null ? "—" : formatCLP(getValue() as number)),
    },
  ];
  function exportCsv() {
    if (!data) return;
    const csv = [
      "Fecha,Efectivo CLP,Transferencias CLP,Transbank externo CLP,Total CLP,Movimientos,Devoluciones CLP,Ajustes CLP,Neto CLP",
      `${data.date},${data.cash},${data.transfer},${data.transbank ?? 0},${data.income},${data.movements},${data.refunds ?? 0},${data.adjustments ?? 0},${data.net ?? data.income}`,
    ].join("\r\n");
    const url = URL.createObjectURL(
        new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" }),
      ),
      link = document.createElement("a");
    link.href = url;
    link.download = `gym-${data.date}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const attendanceError = getRangeError(attendanceFrom, attendanceTo);

  async function handleExportMembers() {
    try {
      setExportError(null);
      setExporting("members");
      await api.downloadMembersCsv();
    } catch (e) {
      setExportError(e instanceof Error ? e.message : "Error al exportar socios");
    } finally {
      setExporting(null);
    }
  }

  async function handleExportMemberships() {
    try {
      setExportError(null);
      setExporting("memberships");
      await api.downloadMembershipsCsv();
    } catch (e) {
      setExportError(e instanceof Error ? e.message : "Error al exportar vigencias");
    } finally {
      setExporting(null);
    }
  }

  async function handleExportAttendance() {
    if (attendanceError) return;
    try {
      setExportError(null);
      setExporting("attendance");
      await api.downloadAttendanceCsv(attendanceFrom, attendanceTo);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : "Error al exportar asistencia");
    } finally {
      setExporting(null);
    }
  }

  return (
    <section>
      <PageHead
        eyebrow="Administración"
        title="Reporte diario y exportaciones"
        description="Ingresos confirmados y cierres de turno por fecha de Santiago. Descarga de padrones y registros operativos."
        actions={
          <Button variant="outline" disabled={!data || !!error} onClick={exportCsv}>
            <Download className="h-4 w-4" />
            Exportar CSV financiero
          </Button>
        }
      />

      <div className="mb-8 rounded-lg border bg-card p-6 shadow-sm">
        <h2 className="mb-1 text-lg font-semibold">Exportaciones operativas CSV</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Descarga de padrones y registros acotados a la organización según la matriz de aceptación operativa.
        </p>

        {exportError && (
          <div className="mb-4 rounded-md bg-destructive/15 p-3 text-sm text-destructive">
            {exportError}
          </div>
        )}

        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-3 rounded-md border p-4">
            <h3 className="font-medium">Padrones de socios y vigencias</h3>
            <p className="text-sm text-muted-foreground">
              Exportación completa de socios (sin tokens QR) y vigencias con saldos de créditos por modalidad.
            </p>
            <div className="flex flex-wrap gap-2 pt-2">
              <Button
                variant="outline"
                disabled={exporting === "members"}
                onClick={() => void handleExportMembers()}
              >
                <Download className="h-4 w-4" />
                Exportar socios CSV
              </Button>
              <Button
                variant="outline"
                disabled={exporting === "memberships"}
                onClick={() => void handleExportMemberships()}
              >
                <Download className="h-4 w-4" />
                Exportar vigencias CSV
              </Button>
            </div>
          </div>

          <div className="space-y-3 rounded-md border p-4">
            <h3 className="font-medium">Reservas y asistencia</h3>
            <p className="text-sm text-muted-foreground">
              Historial de reservas, asistencias y cancelaciones por rango de fechas (máximo 93 días).
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="attendance-from">Fecha desde</Label>
                <Input
                  id="attendance-from"
                  type="date"
                  required
                  value={attendanceFrom}
                  onChange={(e) => setAttendanceFrom(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="attendance-to">Fecha hasta</Label>
                <Input
                  id="attendance-to"
                  type="date"
                  required
                  value={attendanceTo}
                  onChange={(e) => setAttendanceTo(e.target.value)}
                />
              </div>
            </div>
            {attendanceError && (
              <p className="text-xs font-medium text-destructive">{attendanceError}</p>
            )}
            <div className="pt-2">
              <Button
                variant="outline"
                disabled={!!attendanceError || exporting === "attendance"}
                onClick={() => void handleExportAttendance()}
              >
                <Download className="h-4 w-4" />
                Exportar asistencia CSV
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="mb-6 max-w-xs">
        <Label htmlFor="report-date">Fecha del reporte</Label>
        <Input
          id="report-date"
          type="date"
          required
          value={date}
          onChange={(e) => {
            if (e.target.value) setDate(e.target.value);
          }}
        />
      </div>
      <ErrorNotice message={error} retry={() => void reload()} />
      {loading ? (
        <Loading />
      ) : (
        data && (
          <>
            <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
              <Stat
                label="Ingresos confirmados"
                value={formatCLP(data.income)}
                note="Pagos validados del día"
              />
              <Stat label="Efectivo" value={formatCLP(data.cash)} note="Ingresos en efectivo" />
              <Stat
                label="Transferencias"
                value={formatCLP(data.transfer)}
                note="Ingresos por transferencia"
              />
              <Stat
                label="Transbank externo"
                value={formatCLP(data.transbank ?? 0)}
                note="Cobros externos validados manualmente"
              />
              <Stat
                label="Movimientos"
                value={data.movements}
                note="Sin duplicados de pagos validados"
              />
            </div>
            <div className="mb-6 grid gap-4 sm:grid-cols-3">
              <Stat
                label="Salidas compensatorias"
                value={formatCLP(data.outflow ?? 0)}
                note="Devoluciones y ajustes registrados"
              />
              <Stat
                label="Neto del día"
                value={formatCLP(data.net ?? data.income)}
                note="Ingresos confirmados menos salidas compensatorias"
              />
              <Stat
                label="Ciclos en abono"
                value={formatCLP(data.partialCyclesPendingCents ?? 0)}
                note={`${data.partialCyclesCount ?? 0} membresías con saldo pendiente`}
              />
            </div>
            <h2 className="mb-4 font-semibold">Turnos abiertos en esta fecha</h2>
            <DataTable
              data={data.shifts}
              columns={columns}
              empty="Sin turnos abiertos en esta fecha."
            />
          </>
        )
      )}
    </section>
  );
}
