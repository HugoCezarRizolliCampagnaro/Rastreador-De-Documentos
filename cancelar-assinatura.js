// api/cancelar-assinatura.js
//
// Cancela a cobrança mensal no Asaas. O plano continua valendo até o fim do período já pago
// (plano_valido_ate), depois volta sozinho pro Grátis.

const { asaas, usuarioDaRequisicao, lerPerfil, salvarPerfil } = require('./_comum');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ erro: 'Método não permitido.' });
    return;
  }

  try {
    const usuario = await usuarioDaRequisicao(req);
    if (!usuario) {
      res.status(401).json({ erro: 'Sessão inválida. Entre de novo na sua conta.' });
      return;
    }

    const perfil = await lerPerfil(usuario.id);
    if (!perfil || !perfil.asaas_subscription_id) {
      res.status(400).json({ erro: 'Você não tem assinatura ativa.' });
      return;
    }

    try {
      await asaas('/subscriptions/' + perfil.asaas_subscription_id, { method: 'DELETE' });
    } catch (e) {
      if (e.status !== 404) throw e;
    }

    await salvarPerfil(usuario.id, { asaas_subscription_id: null });

    res.status(200).json({ ok: true, validoAte: perfil.plano_valido_ate });
  } catch (erro) {
    console.error('Erro em cancelar-assinatura:', erro.message);
    res.status(500).json({ erro: 'Não foi possível cancelar agora. Tenta de novo.' });
  }
};
