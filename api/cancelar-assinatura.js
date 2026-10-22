// api/cancelar-assinatura.js
//
// Cancela a renovação mensal: o app para de pedir o Pix do próximo mês e de mandar o aviso de
// mensalidade. O plano continua valendo até o fim do período já pago (plano_valido_ate) e
// depois volta sozinho pro Grátis.

const { usuarioDaRequisicao, lerPerfil, salvarPerfil } = require('./_comum');

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
    if (!perfil || !perfil.assinatura_ativa) {
      res.status(400).json({ erro: 'Você não tem assinatura ativa.' });
      return;
    }

    await salvarPerfil(usuario.id, { assinatura_ativa: false });
    res.status(200).json({ ok: true, validoAte: perfil.plano_valido_ate });
  } catch (erro) {
    console.error('Erro em cancelar-assinatura:', erro.message);
    res.status(500).json({ erro: 'Não foi possível cancelar agora. Tenta de novo.' });
  }
};
