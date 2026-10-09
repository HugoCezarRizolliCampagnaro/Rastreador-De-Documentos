// api/_push.js
//
// Ajudantes das notificações push. O "_" no começo do nome impede a Vercel de expor
// este arquivo como rota.
//
// Variáveis de ambiente (Vercel):
//   VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY   par de chaves das notificações
//   VAPID_SUBJECT                          (opcional) contato; por padrão usa o endereço do site
//   CRON_SECRET                            texto secreto; a Vercel o envia sozinha ao agendador

const webpush = require('web-push');

function configurado() {
  return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

function configurar() {
  if (!configurado()) return false;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'https://rastreador-de-documentos.vercel.app',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
  return true;
}

// 'ok' | 'expirada' (o aparelho cancelou: apague a inscrição) | lança erro nos demais casos
async function enviar(inscricao, mensagem) {
  try {
    await webpush.sendNotification(
      { endpoint: inscricao.endpoint, keys: { p256dh: inscricao.p256dh, auth: inscricao.auth } },
      JSON.stringify(mensagem),
      { TTL: 60 * 60 * 12, urgency: 'normal' }
    );
    return 'ok';
  } catch (e) {
    if (e.statusCode === 404 || e.statusCode === 410) return 'expirada';
    throw e;
  }
}

function hojeBrasilia(agora) {
  return (agora || new Date()).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
}

function diasAte(vencimentoISO, hojeISO) {
  const a = vencimentoISO.split('-').map(Number);
  const b = hojeISO.split('-').map(Number);
  return Math.round((Date.UTC(a[0], a[1] - 1, a[2]) - Date.UTC(b[0], b[1] - 1, b[2])) / 86400000);
}

// Frequência por urgência: nos dias que a pessoa escolheu (ex.: 30 e 7), todo dia nos últimos
// 3 dias e no dia do vencimento, e depois de vencido só 1, 3 e 7 dias depois.
function deveAvisar(dias, avisosDias) {
  const escolhidos = Array.isArray(avisosDias) ? avisosDias : [30, 7];
  if (escolhidos.indexOf(dias) !== -1) return true;
  if (dias >= 0 && dias <= 3) return true;
  return dias === -1 || dias === -3 || dias === -7;
}

function frase(doc) {
  if (doc.dias < 0) return doc.nome + ' venceu há ' + (-doc.dias) + (doc.dias === -1 ? ' dia' : ' dias');
  if (doc.dias === 0) return doc.nome + ' vence hoje';
  if (doc.dias === 1) return doc.nome + ' vence amanhã';
  return doc.nome + ' vence em ' + doc.dias + ' dias';
}

// docs: [{ nome, dias }] já filtrados e ordenados do mais urgente
function montarMensagem(docs) {
  if (docs.length === 1) {
    const d = docs[0];
    return { title: d.dias < 0 ? 'Documento vencido' : 'Vencimento próximo', body: frase(d) + '.', url: '/index.html' };
  }
  const lista = docs.slice(0, 3).map(frase).join('; ');
  const resto = docs.length > 3 ? ' e mais ' + (docs.length - 3) : '';
  return { title: docs.length + ' documentos pedem atenção', body: lista + resto + '.', url: '/index.html' };
}

module.exports = { configurado, configurar, enviar, hojeBrasilia, diasAte, deveAvisar, montarMensagem };
