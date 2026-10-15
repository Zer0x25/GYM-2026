import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { Button } from "../components/ui/button.js";
import { Input } from "../components/ui/input.js";

export function AccountRecovery() {
  const location = useLocation(),
    navigate = useNavigate();
  const [token] = useState(() => location.hash.slice(1));
  const [enabled, setEnabled] = useState(false),
    [checked, setChecked] = useState(false);
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  useEffect(() => {
    if (location.hash) navigate(location.pathname, { replace: true });
  }, [location.hash, location.pathname, navigate]);
  useEffect(() => {
    let alive = true;
    void api
      .emailCapabilities()
      .then((cap) => {
        if (alive) setEnabled(cap.passwordReset);
      })
      .catch(() => {
        if (alive) setError("No se pudo comprobar la disponibilidad del correo.");
      })
      .finally(() => {
        if (alive) setChecked(true);
      });
    return () => {
      alive = false;
    };
  }, []);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (token && (password.length < 10 || password !== repeat)) {
      setError(
        password !== repeat ? "Las contraseñas no coinciden." : "Usa al menos 10 caracteres.",
      );
      return;
    }
    if (!token && !enabled) return;
    setBusy(true);
    try {
      if (token) {
        await api.resetPassword(token, password);
        setPassword("");
        setRepeat("");
        window.dispatchEvent(new Event("gym:session-expired"));
        setMessage("Contraseña actualizada. Ingresa con tu nueva contraseña.");
      } else {
        await api.requestPasswordReset(email.trim());
        setMessage(
          "Si existe una cuenta con ese correo, recibirás instrucciones para recuperar el acceso.",
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo completar la solicitud.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="grid min-h-screen place-items-center bg-background p-4">
      <section className="w-full max-w-md rounded-xl border bg-card p-6 sm:p-8">
        <h1 className="text-xl font-semibold">
          {token ? "Cambiar contraseña" : "Recuperar acceso"}
        </h1>
        {!token && checked && !enabled && (
          <p role="status" className="mt-4 rounded-md bg-muted p-3 text-sm">
            El envío de correos está pendiente de habilitación. La recuperación por email todavía no
            está disponible.
          </p>
        )}
        {message ? (
          <p role="status" className="mt-4 text-sm">
            {message}
          </p>
        ) : (
          <form onSubmit={submit} className="mt-5 space-y-4">
            {token ? (
              <>
                <div className="space-y-2">
                  <label htmlFor="new-password">Nueva contraseña</label>
                  <Input
                    id="new-password"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={10}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="repeat-password">Repetir contraseña</label>
                  <Input
                    id="repeat-password"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={10}
                    value={repeat}
                    onChange={(e) => setRepeat(e.target.value)}
                  />
                </div>
              </>
            ) : (
              <div className="space-y-2">
                <label htmlFor="recovery-email">Email de ingreso</label>
                <Input
                  id="recovery-email"
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            )}
            <Button className="w-full" disabled={busy || (!token && !enabled)} type="submit">
              {busy ? "Procesando…" : token ? "Guardar contraseña" : "Solicitar recuperación"}
            </Button>
          </form>
        )}
        {error && (
          <p role="alert" className="mt-4 text-sm text-destructive">
            {error}
          </p>
        )}
        <Link to="/login" className="mt-6 block text-sm text-primary hover:underline">
          Volver al ingreso
        </Link>
      </section>
    </main>
  );
}
