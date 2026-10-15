import { expect, it } from "vitest";
import { safeRequest } from "./safe-request.js";
it("SPEC015 CA-5 request logs omit reset tokens, query strings and headers", () => {
  const request = {
    method: "GET",
    url: "/api/auth/reset-password/secret?callbackURL=secret2",
    headers: { cookie: "secret3" },
  };
  expect(safeRequest(request)).toEqual({
    method: "GET",
    url: "/api/auth/reset-password/[REDACTED]",
  });
  expect(safeRequest({ method: "POST", url: "/api/auth/reset-password?token=secret" }).url).toBe(
    "/api/auth/reset-password",
  );
});
