/* FilaFácil — service worker mínimo: só mostra o aviso "É a sua vez!"
   e, ao tocar nele, volta para a página da senha. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "app.html", self.registration.scope).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const page = list.find((c) => c.url === url);
      return page ? page.focus() : self.clients.openWindow(url);
    })
  );
});
