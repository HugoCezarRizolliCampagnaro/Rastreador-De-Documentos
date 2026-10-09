// api/registrar-push.js
//
// Grava (ou atualiza) a inscrição de notificações do aparelho da pessoa logada.
// Feito no servidor para funcionar mesmo se o aparelho já estava ligado a outra conta.

const { supabaseAdmin, usuarioDaRequisicao } = require('./_comum');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ erro: 'Método não permitido.' });
    return;
  }

  if (!process.env.SUPABASE_SECRET_KEY) {
    res.status(500).json({ erro: 'Servidor sem a chave do Supabase.' });
    return;
  }

  try {
    const usuario = await usuarioDaRequisicao(req);
    if (!usuario) {
      res.status(401).json({ erro: 'Sessão inválida. Entre de novo na sua conta.' });
      return;
    }

    const corpo = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const { endpoint, p256dh, auth } = corpo;
    if (!endpoint || !p256dh || !auth || String(endpoint).indexOf('https://') !== 0) {
      res.status(400).json({ erro: 'Dados da inscrição incompletos.' });
      return;
    }

    await supabaseAdmin('push_inscricoes?on_conflict=endpoint', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: { user_id: usuario.id, endpoint: endpoint, p256dh: p256dh, auth: auth },
    });

    res.status(200).json({ ok: true });
  } catch (erro) {
    console.error('Erro em registrar-push:', erro.message);
    res.status(500).json({ erro: 'Não consegui gravar a inscrição.', detalhe: String(erro.message).slice(0, 160) });
  }
};
