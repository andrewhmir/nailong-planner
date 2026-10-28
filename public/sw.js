/* Nailong Planner service worker. See docs/COMPONENTS/pwa.md.
 *
 * Policy:
 * - navigations: network-first, cached document fallback, then /offline.html;
 *   a /login navigation clears the authenticated pages cache and is not cached;
 * - hashed static assets/icons/fonts: cache-first with runtime fill;
 * - /api/*: never intercepted and never cached;
 * - skipWaiting only on the explicit SKIP_WAITING message from the update prompt.
 */
const SW_VERSION = "v0.3.0-1";
const PAGES_CACHE = `pages-${SW_VERSION}`;
const ASSETS_CACHE = `assets-${SW_VERSION}`;
const OFFLINE_URL = "/offline.html";
const PRECACHE_URLS = [
  OFFLINE_URL,
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(ASSETS_CACHE).then((cache) => cache.addAll(PRECACHE_URLS)),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      const stale = names.filter((name) => name !== PAGES_CACHE && name !== ASSETS_CACHE);
      await Promise.all(stale.map((name) => caches.delete(name)));
      await self.clients.claim();
    })(),
  );
});

function isStaticAsset(url) {
  return url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/");
}

async function handleNavigation(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const pathname = new URL(request.url).pathname;
      if (pathname === "/login") {
        // A sign-in page means the session is gone: never replay authenticated HTML.
        await caches.delete(PAGES_CACHE);
      } else {
        const cache = await caches.open(PAGES_CACHE);
        await cache.put(request, response.clone());
      }
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) {
      return cached;
    }
    const offline = await caches.match(OFFLINE_URL);
    if (offline) {
      return offline;
    }
    throw error;
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) {
    return cached;
  }
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(ASSETS_CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") {
    return;
  }
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }
  if (url.pathname.startsWith("/api/")) {
    return;
  }
  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(request));
    return;
  }
  const destination = request.destination;
  if (
    isStaticAsset(url) ||
    destination === "font" ||
    destination === "image" ||
    destination === "style" ||
    destination === "script"
  ) {
    event.respondWith(cacheFirst(request));
  }
});

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
  if (data.type === "CLEAR_OFFLINE") {
    event.waitUntil(caches.delete(PAGES_CACHE));
  }
});
