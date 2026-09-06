/* FirstBrix Infratech — Service Worker
   Purpose: (1) satisfies Android/Chrome's PWA installability requirement
   (a fetch handler must exist), and (2) caches the app shell so the app
   opens instantly on repeat visits and shows something reasonable if
   opened with no signal for a moment.

   IMPORTANT: this deliberately never caches Firebase/Firestore/Google API
   calls — this app is a live, real-time system, so those must always hit
   the network. Only the static shell (this HTML file + CDN libraries) is
   cached. If you are offline, you can look at cached data already loaded
   into the page, but new logins, writes and live updates still need a
   connection — this worker does not change that. */

const CACHE_NAME = 'firstbrix-shell-v1';
const SHELL_URLS = [
  self.registration.scope // the app's own root/index page
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL_URLS))
      .catch(()=>{}) // never let a caching hiccup block install
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

/* Never intercept anything Firebase/Google-related, or any non-GET
   request — those must always go straight to the network untouched. */
function shouldBypass(url, request){
  if(request.method !== 'GET') return true;
  const bypassHosts = [
    'firestore.googleapis.com',
    'firebaseio.com',
    'firebasestorage.googleapis.com',
    'identitytoolkit.googleapis.com',
    'securetoken.googleapis.com',
    'googleapis.com'
  ];
  return bypassHosts.some(h => url.hostname.includes(h));
}

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if(shouldBypass(url, event.request)) return; // let it go straight through

  // Navigation requests (the app shell itself): network first, so people
  // always get the latest deployed version; fall back to cache only if
  // there's truly no connection.
  if(event.request.mode === 'navigate'){
    event.respondWith(
      fetch(event.request)
        .then(resp => {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy)).catch(()=>{});
          return resp;
        })
        .catch(() => caches.match(event.request).then(r => r || caches.match(self.registration.scope)))
    );
    return;
  }

  // Static CDN assets (fonts, libraries): cache-first, since these rarely
  // change and this saves real bandwidth/time on repeat opens.
  event.respondWith(
    caches.match(event.request).then(cached => {
      if(cached) return cached;
      return fetch(event.request).then(resp => {
        if(resp && resp.status === 200){
          const copy = resp.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy)).catch(()=>{});
        }
        return resp;
      }).catch(() => cached);
    })
  );
});
