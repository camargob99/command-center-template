// Lets Chrome/Edge install Command Center as a desktop app. It caches nothing:
// every request goes straight to the network, so data is always live.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
