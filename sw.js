// Service Worker — DocTrack
// 1) Cache dos arquivos do próprio site (instalar como app e abrir mesmo sem internet).
// 2) Notificações push (avisos de vencimento).
// Chamadas ao Supabase, às rotas /api e a CDNs passam direto pela rede, nunca são cacheadas.

const CACHE_NAME = 'doctrack-v2';

const ARQUIVOS_ESSENCIAIS = [
  'index.html', 'login.html', 'calendario.html', 'assistente.html', 'gastos.html',
  'perfil.html', 'planos.html', 'relatorio.html', 'novo-documento.html',
  'termos.html', 'privacidade.html', 'manifest.json',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/favicon-32.png', 'icons/favicon-16.png',
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      // um por um: se algum falhar, os outros continuam
      return Promise.all(ARQUIVOS_ESSENCIAIS.map(function (arq) { return cache.add(arq).catch(function () {}); }));
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (nomes) {
      return Promise.all(
        nomes.filter(function (nome) { return nome !== CACHE_NAME; })
             .map(function (nome) { return caches.delete(nome); })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function (event) {
  const url = new URL(event.request.url);

  if (url.origin !== self.location.origin) return;
  if (event.request.method !== 'GET') return;
  if (url.pathname.indexOf('/api/') === 0) return;

  event.respondWith(
    fetch(event.request)
      .then(function (resposta) {
        const copia = resposta.clone();
        caches.open(CACHE_NAME).then(function (cache) { cache.put(event.request, copia); });
        return resposta;
      })
      .catch(function () {
        return caches.match(event.request);
      })
  );
});

/* ---------- notificações push ---------- */

self.addEventListener('push', function (event) {
  let dados = { title: 'DocTrack', body: 'Você tem documentos pedindo atenção.', url: '/index.html' };
  try { if (event.data) dados = Object.assign(dados, event.data.json()); } catch (e) {}

  event.waitUntil(
    self.registration.showNotification(dados.title, {
      body: dados.body,
      icon: 'icons/icon-192.png',
      badge: 'icons/favicon-32.png',
      tag: 'doctrack-avisos',
      renotify: true,
      data: { url: dados.url || '/index.html' },
    })
  );
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  const destino = (event.notification.data && event.notification.data.url) || '/index.html';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (janelas) {
      for (const janela of janelas) {
        if ('focus' in janela) {
          janela.navigate(destino).catch(function () {});
          return janela.focus();
        }
      }
      return self.clients.openWindow(destino);
    })
  );
});
