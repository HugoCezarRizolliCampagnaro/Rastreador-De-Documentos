// Service Worker — DocTrack
// 1) Cache dos arquivos do próprio site (instalar como app e abrir mesmo sem internet).
// 2) Notificações push (avisos de vencimento).
// Chamadas ao Supabase, às rotas /api e a CDNs passam direto pela rede, nunca são cacheadas.

const CACHE_NAME = 'doctrack-v61';

const ARQUIVOS_ESSENCIAIS = [
  'index.html', 'login.html', 'calendario.html', 'assistente.html', 'gastos.html',
  'perfil.html', 'planos.html', 'relatorio.html', 'novo-documento.html', 'pessoas.html', 'compartilhados.html', 'convite.html',
  'termos.html', 'privacidade.html', 'manifest.json', 'barra-inferior.js', 'dialogos.js', 'recorrencia.js', 'tour.js', 'anexos.js', 'navegador-app.js',
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
      actions: Array.isArray(dados.actions) ? dados.actions : [],
      data: { url: dados.url || '/index.html', docId: dados.docId || null, token: dados.token || null },
    })
  );
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  const info = event.notification.data || {};

  // "Lembrar amanhã": marca no servidor e confirma, sem abrir o app
  if (event.action === 'amanha' && info.docId) {
    event.waitUntil(
      fetch('/api/registrar-push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao: 'adiar', doc: info.docId, t: info.token }),
      }).then(function (r) {
        return self.registration.showNotification(r.ok ? 'Combinado!' : 'Não deu certo', {
          body: r.ok ? 'Amanhã a gente te lembra de novo.' : 'Abra o DocTrack pra ver o documento.',
          icon: 'icons/icon-192.png', badge: 'icons/favicon-32.png', tag: 'doctrack-avisos',
        });
      }).catch(function () {})
    );
    return;
  }

  // "Já renovei": abre o documento pra trocar a data
  const destino = event.action === 'renovei' && info.docId
    ? '/novo-documento.html?id=' + encodeURIComponent(info.docId)
    : (info.url || '/index.html');

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
