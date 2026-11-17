/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

/**
 * Answers `/media/...` (covers, page thumbnails and pages) by asking the page that wants the
 * image, which asks the engine. Images then load like any other: lazily, in the background, with
 * the browser deciding when.
 */
const worker = self as unknown as ServiceWorkerGlobalScope;

worker.addEventListener('install', () => void worker.skipWaiting());
worker.addEventListener('activate', (event) => event.waitUntil(worker.clients.claim()));

// A page opened with a hard reload isn't controlled; it asks to be taken over
worker.addEventListener('message', (event) => {
  if (event.data === 'claim') event.waitUntil(worker.clients.claim());
});

worker.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== worker.location.origin || !url.pathname.startsWith('/media/')) return;
  event.respondWith(fromPage(event.clientId, url.pathname + url.search));
});

/** How long an image may take: the first page of a large archive can need a few seconds */
const TIMEOUT_MS = 60_000;

async function fromPage(clientId: string, path: string) {
  const client = clientId ? await worker.clients.get(clientId) : undefined;
  if (!client) return new Response(null, { status: 503 });
  const channel = new MessageChannel();
  const body = await new Promise<Blob | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), TIMEOUT_MS);
    channel.port1.onmessage = ({ data }) => {
      clearTimeout(timer);
      resolve(data instanceof Blob ? data : null);
    };
    client.postMessage({ type: 'media', url: path }, [channel.port2]);
  });
  channel.port1.close();
  if (!body) return new Response(null, { status: 404 });
  return new Response(body, {
    headers: {
      'Content-Type': body.type || 'application/octet-stream',
      'Content-Length': String(body.size),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
