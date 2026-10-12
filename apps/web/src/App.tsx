import { NavLink, Route, Routes } from "react-router-dom";
import type { Role } from "@gym/contracts";

const ROLES: Role[] = ["admin", "recepcion", "instructor", "socio"];

/**
 * App shell scaffold: role-aware routing skeleton for the MVP.
 * Real panels (N: admin/recepción, C: clases, P: portal) arrive with their units.
 * Sauna is excluded from v1.0 by decision MVP-SAUNA-01/B — no route for it here.
 */
export function App() {
  return (
    <div>
      <header>
        <h1>App GYM</h1>
        <nav aria-label="Principal">
          <NavLink to="/">Inicio</NavLink>
          <NavLink to="/panel">Panel</NavLink>
          <NavLink to="/portal">Portal socio</NavLink>
        </nav>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/panel" element={<Panel />} />
          <Route path="/portal" element={<Portal />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
    </div>
  );
}

function Home() {
  return (
    <section>
      <h2>Andamiaje listo</h2>
      <p>
        Monorepo GYM-2026: React SPA/PWA (apps/web) + Fastify (apps/api) + contratos compartidos
        (packages/contracts) + Drizzle (packages/db).
      </p>
    </section>
  );
}

function Panel() {
  return (
    <section>
      <h2>Panel (N + C)</h2>
      <p>Roles previstos: {ROLES.join(", ")}. Pendiente de la Entrega 1 (auth/tenant/roles).</p>
    </section>
  );
}

function Portal() {
  return (
    <section>
      <h2>Portal del socio (P)</h2>
      <p>Consulta propia, reservas y QR. Pendiente de implementación.</p>
    </section>
  );
}

function NotFound() {
  return (
    <section>
      <h2>No encontrado</h2>
    </section>
  );
}
