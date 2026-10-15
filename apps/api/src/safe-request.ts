/** Authentication secrets never belong in request logs, including legacy GET links. */
export function safeRequest(request: { method: string; url: string }) {
  return {
    method: request.method,
    url: request.url
      .split("?")[0]!
      .replace(/(\/api\/auth\/reset-password\/)[^/]+/g, "$1[REDACTED]"),
  };
}
