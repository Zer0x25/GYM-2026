import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("SPEC 021 CA-5 — sincronización de documentación de contratos CAL-3", () => {
  it("docs/api/README.md documenta el 100% de las rutas /api/v1/* de app.ts", () => {
    const root = resolve(__dirname, "../../..");
    const appSource = readFileSync(resolve(__dirname, "app.ts"), "utf8");
    const docSource = readFileSync(resolve(root, "docs/api/README.md"), "utf8");

    const routeRegex = /app\.(get|post|patch|delete|put)(?:<[^>]+>)?\(\s*["']([^"']+)["']/g;
    const routes: { method: string; path: string }[] = [];
    let match: RegExpExecArray | null;

    while ((match = routeRegex.exec(appSource)) !== null) {
      const method = match[1]!.toUpperCase();
      const path = match[2]!;
      if (path.startsWith("/api/v1/")) {
        routes.push({ method, path });
      }
    }

    expect(routes.length).toBeGreaterThan(0);

    const missing: string[] = [];
    for (const r of routes) {
      // Must document the route method and path in docs
      if (!docSource.includes(`${r.method} ${r.path}`)) {
        missing.push(`${r.method} ${r.path}`);
      }
    }

    expect(missing).toEqual([]);
  });
});
