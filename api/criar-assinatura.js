// api/criar-assinatura.js
//
// Começa a assinatura do plano pago. Guarda os dados de cobrança (nome, CPF e telefone, que
// a ZuckPay exige pra gerar o Pix) e:
//   - se a pessoa ainda não testou o Premium: libera 30 dias grátis, sem cobrar nada agora;
//   - se já testou: devolve precisaPagar = true, e a tela gera o primeiro Pix na sequência.
// Depois disso, todo mês a pessoa paga um Pix novo pelo app (api/pix.js).

const {
  PLANOS, DIAS_TESTE_GRATIS, dataISO, somarDias, cpfValido,
  usuarioDaRequisicao, lerPerfil, salvarPerfil,
} = require('./_comum');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ erro: 'Método não permitido.' });
    return;
  }

  if (!process.env.SUPABASE_SECRET_KEY) {
    res.status(500).json({ erro: 'Pagamento ainda não configurado no servidor.' });
    return;
  }

  try {
    const usuario = await usuarioDaRequisicao(req);
    if (!usuario) {
      res.status(401).json({ erro: 'Sessão inválida. Entre de novo na sua conta.' });
      return;
    }

    const corpo = req.body || {};
    const plano = PLANOS[corpo.plano];
    const nome = String(corpo.nome || '').trim();
    const cpf = String(corpo.cpf || '').replace(/\D/g, '');
    const telefone = String(corpo.telefone || '').replace(/\D/g, '');

    if (!plano) {
      res.status(400).json({ erro: 'Plano inválido.' });
      return;
    }
    if (nome.length < 3 || nome.indexOf(' ') === -1) {
      res.status(400).json({ erro: 'Digite seu nome completo.' });
      return;
    }
    if (!cpfValido(cpf)) {
      res.status(400).json({ erro: 'CPF inválido. Confira os números.' });
      return;
    }
    if (telefone.length < 10 || telefone.length > 11) {
      res.status(400).json({ erro: 'Telefone inválido. Use DDD + número, ex.: (51) 99999-8888.' });
      return;
    }

    const perfil = await lerPerfil(usuario.id);
    const dadosCobranca = { cobranca_nome: nome, cobranca_cpf: cpf, cobranca_telefone: telefone };

    if (perfil && perfil.teste_usado) {
      await salvarPerfil(usuario.id, dadosCobranca);
      res.status(200).json({ ok: true, precisaPagar: true });
      return;
    }

    const validoAte = dataISO(somarDias(new Date(), DIAS_TESTE_GRATIS));
    await salvarPerfil(usuario.id, Object.assign(dadosCobranca, {
      plano: corpo.plano,
      plano_valido_ate: validoAte,
      teste_usado: true,
      assinatura_ativa: true,
    }));

    res.status(200).json({ ok: true, plano: corpo.plano, validoAte: validoAte, primeiroVencimento: validoAte });
  } catch (erro) {
    console.error('Erro em criar-assinatura:', erro.message);
    res.status(500).json({ erro: 'Não foi possível iniciar a assinatura agora.' });
  }
};
