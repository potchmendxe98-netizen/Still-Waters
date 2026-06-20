// Still Waters — Service Worker
// Handles offline caching and daily reminder notifications via Periodic Background Sync
// (where supported) and a fallback Background Sync / message-based scheduler.

const CACHE_NAME = 'still-waters-v1';
const APP_SHELL = ['./index.html', './manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(()=>{})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Serve cached app shell when offline
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request).catch(() => cached))
  );
});

// ── Daily reminder via Periodic Background Sync ──
// Only fires on browsers/devices that support this (mainly installed PWAs on Android/Chrome).
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'still-waters-daily-reminder') {
    event.waitUntil(checkAndNotify());
  }
});

// ── Fallback: regular Background Sync, triggered when connectivity returns ──
self.addEventListener('sync', (event) => {
  if (event.tag === 'still-waters-reminder-check') {
    event.waitUntil(checkAndNotify());
  }
});

// ── Listen for messages from the page to schedule / cancel reminders ──
let reminderTimer = null;

self.addEventListener('message', (event) => {
  const { type, time } = event.data || {};
  if (type === 'SCHEDULE_REMINDER') {
    scheduleReminder(time);
  } else if (type === 'CANCEL_REMINDER') {
    if (reminderTimer) { clearTimeout(reminderTimer); reminderTimer = null; }
  }
});

function scheduleReminder(time) {
  if (reminderTimer) clearTimeout(reminderTimer);
  if (!time) return;
  const [h, m] = time.split(':').map(Number);
  const now = new Date();
  const next = new Date();
  next.setHours(h, m, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  const delay = next.getTime() - now.getTime();

  // setTimeout inside a Service Worker only survives while the worker
  // is active. Browsers may terminate idle workers, so we also register
  // for Periodic Background Sync as a more durable backup where available.
  reminderTimer = setTimeout(() => {
    fireNotification();
    scheduleReminder(time); // reschedule for the following day
  }, delay);
}

function fireNotification() {
  self.registration.showNotification('Still Waters 🌿', {
    body: 'Your mindfulness practice is waiting. Even two minutes counts.',
    icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='20' fill='%23f4efe5'/%3E%3Ctext x='50' y='65' font-size='55' text-anchor='middle'%3E%F0%9F%8C%BF%3C/text%3E%3C/svg%3E",
    badge: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext x='50' y='65' font-size='55' text-anchor='middle'%3E%F0%9F%8C%BF%3C/text%3E%3C/svg%3E",
    tag: 'still-waters-daily',
    renotify: true,
    silent: false,
    requireInteraction: false,
  });
}

async function checkAndNotify() {
  // Used by periodic/background sync — fires once if it's time, then
  // the page-side scheduler re-arms the next one when it next opens.
  fireNotification();
}

// Clicking the notification opens (or focuses) the app
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsArr) => {
      const existing = clientsArr.find((c) => c.url.includes(self.registration.scope));
      if (existing) return existing.focus();
      return self.clients.openWindow('./index.html');
    })
  );
});
