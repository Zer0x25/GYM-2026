/**
 * Login screen: email + password against Better Auth. On success the guard
 * redirects to the role's home. Errors come back as stable API codes.
 *
 * Design (ADR-0003): Tailwind utilities + the CSS-variable tokens from
 * index.css (bg-card, text-foreground, border-input…). The old semantic
 * classes (.card/.error) predate the design system and style nothing.
 */
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Dumbbell } from "lucide-react";
import { ApiError } from "../api.js";
import { useSession } from "../session.js";
import { Button } from "../components/ui/button.js";
import { Input } from "../components/ui/input.js";

export function Login() {
  const { signIn } = useSession();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signIn(email, password);
      navigate("/", { replace: true });
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.status === 401
            ? "Credenciales inválidas."
            : e.message
          : "No se pudo contactar al servidor.";
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-background p-4">
      <section
        aria-labelledby="login-title"
        className="w-full max-w-sm rounded-xl border bg-card p-8 shadow-sm"
      >
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <span className="grid h-11 w-11 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Dumbbell className="h-6 w-6" aria-hidden />
          </span>
          <h1 id="login-title" className="text-xl font-semibold tracking-tight">
            Ingresar
          </h1>
          <p className="text-sm text-muted-foreground">Panel del gimnasio</p>
        </div>
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="email" className="text-sm font-medium">
              Email
            </label>
            <Input
              id="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="password" className="text-sm font-medium">
              Contraseña
            </label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error ? (
            <p
              role="alert"
              className="rounded-md bg-destructive/10 p-3 text-sm text-destructive"
            >
              {error}
            </p>
          ) : null}
          <Button
            type="submit"
            className="w-full"
            disabled={busy || !email || !password}
          >
            {busy ? "Ingresando…" : "Ingresar"}
          </Button>
        </form>
      </section>
    </div>
  );
}
