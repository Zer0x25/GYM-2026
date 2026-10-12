import { NavLink, Route, Routes } from "react-router-dom";
import { SessionProvider, useSession } from "./session.js";
import { RequireAuth, RequireStaff } from "./guards.jsx";
import { Login } from "./pages/Login.js";
import { Panel } from "./pages/Panel.js";
import { Portal } from "./pages/Portal.js";

/**
 * App shell with session-aware routing.
 * - /login: email+password (Better Auth, ADR-0002 §2.2)
 * - /panel: staff only (admin/recepción/instructor) — members CRUD
 * - /portal: socio self-service (own profile, own contact)
 * Sauna stays out of v1.0 (MVP-SAUNA-01/B) — no route.
 * Client-side guards are UX; the API re-validates every request.
 */
export function App() {
  return (
    <SessionProvider>
      <Shell />
    </SessionProvider>
  );
}

function Shell() {
  const { session, signOut } = useSession();
  const isStaff = session && session.role !== "socio";

  return (
    <div>
      <header>
        <h1>App GYM</h1>
        <nav aria-label="Principal">
          {session ? (
            <>
              {isStaff ? <NavLink to="/panel">Panel</NavLink> : null}
              {session.role === "socio" ? <NavLink to="/portal">Mi perfil</NavLink> : null}
              <button type="button" className="link" onClick={() => void signOut()}>
                Salir
              </button>
            </>
          ) : (
            <NavLink to="/login">Ingresar</NavLink>
          )}
        </nav>
      </header>
      <main>
        <Routes>
          <Route
            path="/"
            element={
              <section>
                <h2>Inicio</h2>
                {session ? (
                  <p>
                    Hola {session.user.email} — organización:{" "}
                    <strong>{session.organization.name}</strong> ({session.role}).
                  </p>
                ) : (
                  <p>Monorepo GYM-2026 listo. Iniciá sesión para continuar.</p>
                )}
              </section>
            }
          />
          <Route path="/login" element={<Login />} />
          <Route
            path="/panel"
            element={
              <RequireStaff>
                <Panel />
              </RequireStaff>
            }
          />
          <Route
            path="/portal"
            element={
              <RequireAuth roles={["socio"]}>
                <Portal />
              </RequireAuth>
            }
          />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
    </div>
  );
}

function NotFound() {
  return (
    <section>
      <h2>No encontrado</h2>
    </section>
  );
}
