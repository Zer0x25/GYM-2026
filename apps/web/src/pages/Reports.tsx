import { useCallback, useState } from "react";
import { Download } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { api, formatCLP, type CashSession } from "../api.js";
import { useResource } from "../hooks/use-resource.js";
import { PageHead, ErrorNotice, Loading, Stat } from "../components/ui/page.js";
import { DataTable } from "../components/ui/data-table.js";
import { Button } from "../components/ui/button.js";
import { Input, Label } from "../components/ui/input.js";
export function Reports() {
  const [date, setDate] = useState(() =>
    new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" }),
  );
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
      "Fecha,Efectivo CLP,Transferencias CLP,Total CLP,Movimientos",
      `${data.date},${data.cash},${data.transfer},${data.income},${data.movements}`,
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
  return (
    <section>
      <PageHead
        eyebrow="Administración"
        title="Reporte diario"
        description="Ingresos confirmados y cierres de turno por fecha de Santiago. Los cobros provisionales se excluyen."
        actions={
          <Button variant="outline" disabled={!data || !!error} onClick={exportCsv}>
            <Download className="h-4 w-4" />
            Exportar CSV
          </Button>
        }
      />
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
            <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
                label="Movimientos"
                value={data.movements}
                note="Sin duplicados de pagos validados"
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
