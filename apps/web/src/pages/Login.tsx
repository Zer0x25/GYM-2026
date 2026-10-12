/**
 * Login screen: email + password against Better Auth. On success the guard
 * redirects to the role's home. Errors come back as stable API codes.
 */
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "../api.js";
import { useSession } from "../session.js";

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
    <section className="card" aria-labelledby="login-title">
      <h1 id="login-title">Ingresar</h1>
      <form onSubmit={onSubmit} noValidate>
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <label htmlFor="password">Contraseña</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error ? (
          <p role="alert" className="error">
            {error}
          </p>
        ) : null}
        <button type="submit" disabled={busy || !email || !password}>
          {busy ? "Ingresando…" : "Ingresar"}
        </button>
      </form>
    </section>
  );
}
