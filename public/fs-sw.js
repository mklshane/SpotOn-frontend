/**
 * Serves the web build's virtual filesystem (src/lib/fs.web.ts) over real URLs.
 *
 * expo-file-system has no web implementation, so the web replica stores captured photos and
 * generated reports in OPFS instead. OPFS handles aren't URLs, though, and the app hands file
 * URIs straight to <Image>, expo-image-manipulator and the report renderer - all of which need
 * something fetchable.
 *
 * So: fs.web.ts writes bytes into OPFS under `doc/` and `cache/`, and this worker serves them
 * back at `/_fs/doc/...` and `/_fs/cache/...`. Consumers keep treating the URI as an opaque
 * string that renders, exactly as they do on device, and image-paths.ts's relative-path
 * rebasing keeps working untouched.
 *
 * Nothing outside /_fs/ is intercepted.
 */
const PREFIX = '/_fs/';

const TYPES = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  pdf: 'application/pdf', json: 'application/json', txt: 'text/plain',
  html: 'text/html', tflite: 'application/octet-stream',
};

self.addEventListener('install', (e) => e.waitUntil(self.skipWaiting()));
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

async function read(path) {
  const segs = path.split('/').filter(Boolean);
  const name = segs.pop();
  if (!name) return null;
  let dir = await navigator.storage.getDirectory();
  for (const s of segs) {
    dir = await dir.getDirectoryHandle(s, { create: false });
  }
  const fh = await dir.getFileHandle(name, { create: false });
  return await fh.getFile();
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(PREFIX)) return;

  event.respondWith((async () => {
    try {
      const file = await read(decodeURIComponent(url.pathname.slice(PREFIX.length)));
      if (!file) return new Response('not found', { status: 404 });
      const ext = url.pathname.split('.').pop().toLowerCase();
      return new Response(file, {
        status: 200,
        headers: {
          'Content-Type': TYPES[ext] || 'application/octet-stream',
          'Content-Length': String(file.size),
          // The page may be cross-origin isolated (COEP require-corp); without this the
          // browser refuses to render our own images.
          'Cross-Origin-Resource-Policy': 'same-origin',
          'Cache-Control': 'no-store',
        },
      });
    } catch (e) {
      // NotFoundError from OPFS is the common, expected case (a deleted or never-written file).
      return new Response(String(e && e.message), { status: 404 });
    }
  })());
});
