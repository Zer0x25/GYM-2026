/**
 * Staff panel: list of members in the current organization (server-filtered
 * by tenant — the UI cannot widen the scope). Admin/recepción can also
 * create members; socio (shouldn't reach here — RequireStaff bounces) never.
 */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ApiError, api, type Member } from "../api.js";
import { useSession } from "../session.js";

export function Panel() {
  const { session } = useSession();
  const [members, setMembers] = useState<Member[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fullName, setFullName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (q?: string) => {
    try {
      setMembers(await api.listMembers(q));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Error al cargar socios");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const canCreate = session?.role === "admin" || session?.role === "recepcion";

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.createMember({
        fullName: fullName.trim(),
        contactEmail: contactEmail.trim() || null,
      });
      setFullName("");
      setContactEmail("");
      await load(query);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Error al crear socio");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="panel-title">
      <h1 id="panel-title">Panel</h1>
      <p className="muted">
        {session?.organization.name} — sesión: {session?.user.email} ({session?.role})
      </p>

      <input
        type="search"
        placeholder="Buscar socio…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          void load(e.target.value);
        }}
      />

      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}

      {canCreate ? (
        <form className="card" onSubmit={onCreate}>
          <h2>Nuevo socio</h2>
          <label htmlFor="fullName">Nombre completo</label>
          <input
            id="fullName"
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
          <label htmlFor="contactEmail">Email de contacto (opcional)</label>
          <input
            id="contactEmail"
            type="email"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
          />
          <button type="submit" disabled={busy || !fullName.trim()}>
            {busy ? "Creando…" : "Crear socio"}
          </button>
        </form>
      ) : null}

      <table aria-label="Socios">
        <thead>
          <tr>
            <th>Nombre</th>
            <th>Email</th>
            <th>Alta</th>
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.id}>
              <td>{m.fullName}</td>
              <td>{m.contactEmail ?? "—"}</td>
              <td>{new Date(m.createdAt).toLocaleDateString("es-CL")}</td>
            </tr>
          ))}
          {members.length === 0 ? (
            <tr>
              <td colSpan={3} className="muted">
                Sin socios registrados.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </section>
  );
}
