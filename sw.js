// Service Worker — Rastreador de Documentos
// Cache básico dos arquivos estáticos (permite instalar como app de verdade).
// Chamadas ao Supabase e CDNs passam direto pela rede, nunca são cacheadas.

const CACHE_NAME = 'rastreador-v1';

const ARQUIVOS_ESSENCIAIS = [
  'index.html',
  'login.html',
  'manifest.json',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/favicon-32.png',
  'icons/favicon-16.png',
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(ARQUIVOS_ESSENCIAIS).catch(function () {
        // Se algum arquivo não existir ainda, não trava a instalação do service worker
      });
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

  // Só lida com o próprio site. Supabase, fontes e CDNs passam direto.
  if (url.origin !== self.location.origin) return;
  if (event.request.method !== 'GET') return;

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
