/**
 * Guards unit tests: role routing is UX-level defense, but it must match the
 * server matrix (docs/api/README.md) so staff never land on the socio portal
 * and vice versa.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { SessionProvider, useSession } from "./session";
import { RequireAuth, RequireStaff } from "./guards";
import { api, type SessionData } from "./api";

const staffSession: SessionData = {
  user: { id: "u1", email: "admin@a.cl", name: "admin@a.cl" },
  organization: { id: "org-a", name: "Gimnasio A" },
  role: "admin",
};

const socioSession: SessionData = {
  user: { id: "u2", email: "socio@a.cl", name: "socio@a.cl" },
  organization: { id: "org-a", name: "Gimnasio A" },
  role: "socio",
};

function mockSession(session: SessionData) {
  vi.spyOn(api, "session").mockResolvedValue(session);
}

function mockNoSession() {
  vi.spyOn(api, "session").mockRejectedValue(new Error("401"));
}

function renderApp(initial: string) {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <SessionProvider>
        <Routes>
          <Route path="/" element={<p>HOME</p>} />
          <Route path="/login" element={<p>LOGIN_PAGE</p>} />
          <Route path="/portal" element={<p>PORTAL_PAGE</p>} />
          <Route
            path="/staff-area"
            element={
              <RequireStaff>
                <p>STAFF_ONLY</p>
              </RequireStaff>
            }
          />
          <Route
            path="/socio-area"
            element={
              <RequireAuth roles={["socio"]}>
                <p>SOCIO_ONLY</p>
              </RequireAuth>
            }
          />
        </Routes>
      </SessionProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => vi.restoreAllMocks());

describe("RequireStaff", () => {
  it("lets admin through", async () => {
    mockSession(staffSession);
    renderApp("/staff-area");
    await waitFor(() => expect(screen.getByText("STAFF_ONLY")).toBeTruthy());
  });

  it("redirects socio to /portal", async () => {
    mockSession(socioSession);
    renderApp("/staff-area");
    await waitFor(() => expect(screen.getByText("PORTAL_PAGE")).toBeTruthy());
  });

  it("redirects anonymous to /login", async () => {
    mockNoSession();
    renderApp("/staff-area");
    await waitFor(() => expect(screen.getByText("LOGIN_PAGE")).toBeTruthy());
  });
});

describe("RequireAuth with roles", () => {
  it("lets socio through", async () => {
    mockSession(socioSession);
    renderApp("/socio-area");
    await waitFor(() => expect(screen.getByText("SOCIO_ONLY")).toBeTruthy());
  });

  it("redirects staff to home", async () => {
    mockSession(staffSession);
    renderApp("/socio-area");
    await waitFor(() => expect(screen.queryByText("SOCIO_ONLY")).toBeNull());
    expect(screen.getByText("HOME")).toBeTruthy();
  });
});

describe("session flow", () => {
  it("signIn calls the API then reloads the session", async () => {
    const signInSpy = vi.spyOn(api, "signIn").mockResolvedValue(undefined);
    const sessionSpy = vi.spyOn(api, "session").mockResolvedValue(staffSession);

    function Harness() {
      const { signIn } = useSession();
      return <button onClick={() => void signIn("admin@a.cl", "pw")}>go</button>;
    }

    render(
      <MemoryRouter>
        <SessionProvider>
          <Harness />
        </SessionProvider>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByText("go"));
    await waitFor(() => expect(signInSpy).toHaveBeenCalledWith("admin@a.cl", "pw"));
    expect(sessionSpy).toHaveBeenCalled();
  });
});
