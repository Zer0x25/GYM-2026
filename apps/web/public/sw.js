// Only cache the public app shell. API, cookies and tenant data never enter Cache Storage.
const CACHE = "gym-shell-v2";
const SHELL = ["/index.html", "/manifest.webmanifest", "/icon.svg"];
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const response = await fetch("/index.html", { cache: "reload" });
      if (!response.ok) throw new Error("No se pudo preparar la app offline");
      const html = await response.clone().text();
      await cache.put("/index.html", response);
      const assets = [...html.matchAll(/(?:src|href)="([^"\s]+)"/g)]
        .map((match) => match[1])
        .filter((path) => path.startsWith("/assets/"));
      await cache.addAll([...SHELL.filter((path) => path !== "/index.html"), ...assets]);
    })(),
  );
  self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
      ),
  );
  self.clients.claim();
});
self.addEventListener("fetch", (event) => {
  const request = event.request,
    url = new URL(request.url);
  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/")
  )
    return;
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            event.waitUntil(caches.open(CACHE).then((cache) => cache.put("/index.html", copy)));
          }
          return response;
        })
        .catch(() => caches.match("/index.html").then((cached) => cached ?? Response.error())),
    );
    return;
  }
  if (!url.pathname.startsWith("/assets/") && !SHELL.includes(url.pathname)) return;
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ??
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            event.waitUntil(caches.open(CACHE).then((cache) => cache.put(request, copy)));
          }
          return response;
        }),
    ),
  );
});
