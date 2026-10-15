import type { CreditPeriod } from "../api.js";
const labels = { grupal: "Grupales", fija: "Personalizadas fijas", cita: "Citas" };
export function CreditPeriods({ periods }: { periods: CreditPeriod[] }) {
  return (
    <article className="min-w-0 rounded-2xl border bg-card p-5">
      <h2 className="font-semibold">Períodos y créditos</h2>
      {!periods.length && (
        <p className="mt-3 text-sm text-muted-foreground">
          No hay períodos confirmados para mostrar.
        </p>
      )}
      {periods.map((period) => {
        const expired = new Date(period.endsAt).getTime() <= Date.now();
        const future = new Date(period.startsAt).getTime() > Date.now();
        return (
          <section
            key={period.id}
            data-testid="credit-period"
            className="mt-4 space-y-3 border-t pt-4"
          >
            <p className="break-words text-sm font-medium">
              {period.planName} · {expired ? "Vencido" : future ? "Próximo" : "Vigente"}
            </p>
            <p className="text-xs text-muted-foreground">
              {new Date(period.startsAt).toLocaleDateString("es-CL")} —{" "}
              {new Date(period.endsAt).toLocaleDateString("es-CL")}
            </p>
            {period.coverage === "limited" ? (
              <dl className="space-y-2 text-sm">
                {(["grupal", "fija", "cita"] as const).map((key) => (
                  <div key={key} className="flex flex-wrap justify-between gap-1">
                    <dt>{labels[key]}</dt>
                    <dd>
                      {period.credits[key].quota === null
                        ? "Sin configurar"
                        : `${period.credits[key].available} de ${period.credits[key].quota} ${expired ? "sin trasladar" : "disponibles"}`}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-sm">
                {period.coverage === "unlimited"
                  ? "Clases sin límite de créditos"
                  : "Sin cobertura de clases"}
              </p>
            )}
            {period.coverage === "limited" && (
              <p className="text-xs text-muted-foreground">
                El saldo pertenece a este período y modalidad; no se acumula.
              </p>
            )}
            {period.reviewCount > 0 && (
              <p role="status" className="rounded-md bg-muted p-3 text-sm">
                {period.reviewCount} devolución(es) de crédito pendientes de revisión
                administrativa. Sin prórroga ni traslado automático.
              </p>
            )}
          </section>
        );
      })}
    </article>
  );
}
