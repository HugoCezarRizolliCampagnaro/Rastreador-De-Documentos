// api/testar-notificacao.js
//
// Botão "Enviar notificação de teste" do Perfil: manda uma notificação agora para os
// aparelhos da própria pessoa, pra ela ver se está tudo certo.

const { supabaseAdmin, usuarioDaRequisicao } = require('./_comum');
const push = require('./_push');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ erro: 'Método não permitido.' });
    return;
  }

  if (!push.configurar() || !process.env.SUPABASE_SECRET_KEY) {
    res.status(500).json({ erro: 'Notificações ainda não configuradas no servidor.' });
    return;
  }

  try {
    const usuario = await usuarioDaRequisicao(req);
    if (!usuario) {
      res.status(401).json({ erro: 'Sessão inválida. Entre de novo na sua conta.' });
      return;
    }

    const inscricoes = (await supabaseAdmin('push_inscricoes?user_id=eq.' + usuario.id + '&select=*')) || [];
    if (inscricoes.length === 0) {
      res.status(400).json({ erro: 'Ative as notificações neste aparelho primeiro.' });
      return;
    }

    let enviadas = 0;
    for (const insc of inscricoes) {
      try {
        const r = await push.enviar(insc, { title: 'DocTrack', body: 'Tudo certo! Você vai receber os avisos de vencimento aqui.', url: '/perfil.html' });
        if (r === 'ok') enviadas++;
        else await supabaseAdmin('push_inscricoes?id=eq.' + insc.id, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
      } catch (e) {
        console.error('Falha no teste de push:', e.statusCode || '', e.message);
      }
    }

    if (enviadas === 0) {
      res.status(502).json({ erro: 'Não consegui entregar no seu aparelho. Desative e ative as notificações de novo.' });
      return;
    }
    res.status(200).json({ ok: true, enviadas: enviadas });
  } catch (erro) {
    console.error('Erro em testar-notificacao:', erro.message);
    res.status(500).json({ erro: 'Erro ao enviar o teste.' });
  }
};
