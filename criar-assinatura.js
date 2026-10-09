// api/criar-assinatura.js
//
// Começa o teste grátis de 30 dias do plano pago e cria a assinatura mensal no Asaas.
// A primeira cobrança vence daqui a 30 dias; quem paga (Pix, boleto ou cartão — a pessoa
// escolhe na página de pagamento do Asaas) continua com o plano. Quem não paga volta pro Grátis.

const {
  PLANOS, DIAS_TESTE_GRATIS, DIAS_TOLERANCIA,
  dataISO, somarDias, asaas, usuarioDaRequisicao, lerPerfil, salvarPerfil,
} = require('./_comum');

function cpfValido(cpf) {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  for (let t = 9; t < 11; t++) {
    let soma = 0;
    for (let i = 0; i < t; i++) soma += Number(cpf[i]) * (t + 1 - i);
    const digito = ((soma * 10) % 11) % 10;
    if (digito !== Number(cpf[t])) return false;
  }
  return true;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ erro: 'Método não permitido.' });
    return;
  }

  if (!process.env.ASAAS_API_KEY || !process.env.ASAAS_BASE_URL || !process.env.SUPABASE_SECRET_KEY) {
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

    if (!plano) {
      res.status(400).json({ erro: 'Plano inválido.' });
      return;
    }
    if (nome.length < 3) {
      res.status(400).json({ erro: 'Digite seu nome completo.' });
      return;
    }
    if (!cpfValido(cpf)) {
      res.status(400).json({ erro: 'CPF inválido. Confira os números.' });
      return;
    }

    const perfil = await lerPerfil(usuario.id);

    // cliente no Asaas (reaproveita se já existir)
    let clienteId = perfil && perfil.asaas_customer_id;
    if (!clienteId) {
      const cliente = await asaas('/customers', {
        method: 'POST',
        body: { name: nome, cpfCnpj: cpf, email: usuario.email, externalReference: usuario.id, notificationDisabled: false },
      });
      clienteId = cliente.id;
    }

    // se já tinha uma assinatura antiga, cancela antes de criar a nova
    if (perfil && perfil.asaas_subscription_id) {
      try { await asaas('/subscriptions/' + perfil.asaas_subscription_id, { method: 'DELETE' }); } catch (e) { /* já cancelada */ }
    }

    const hoje = new Date();
    const primeiroVencimento = dataISO(somarDias(hoje, DIAS_TESTE_GRATIS));

    const assinatura = await asaas('/subscriptions', {
      method: 'POST',
      body: {
        customer: clienteId,
        billingType: 'UNDEFINED', // a pessoa escolhe Pix, boleto ou cartão na página de pagamento
        value: plano.valor,
        nextDueDate: primeiroVencimento,
        cycle: 'MONTHLY',
        description: 'DocTrack ' + plano.nome + ' — assinatura mensal',
        externalReference: usuario.id + ':' + corpo.plano,
      },
    });

    const validoAte = dataISO(somarDias(hoje, DIAS_TESTE_GRATIS + DIAS_TOLERANCIA));

    await salvarPerfil(usuario.id, {
      plano: corpo.plano,
      plano_valido_ate: validoAte,
      asaas_customer_id: clienteId,
      asaas_subscription_id: assinatura.id,
    });

    // link pra pagar já (opcional) — a primeira cobrança pode demorar a aparecer
    let linkPagamento = null;
    try {
      const cobrancas = await asaas('/subscriptions/' + assinatura.id + '/payments');
      linkPagamento = cobrancas && cobrancas.data && cobrancas.data[0] ? cobrancas.data[0].invoiceUrl : null;
    } catch (e) { /* sem link por enquanto */ }

    res.status(200).json({ ok: true, plano: corpo.plano, validoAte: validoAte, primeiroVencimento: primeiroVencimento, linkPagamento: linkPagamento });
  } catch (erro) {
    console.error('Erro em criar-assinatura:', erro.message, JSON.stringify(erro.detalhes || {}));
    res.status(500).json({ erro: erro.message || 'Não foi possível iniciar a assinatura agora.' });
  }
};
