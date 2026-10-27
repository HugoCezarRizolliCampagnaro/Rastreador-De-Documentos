// api/cartao.js
//
// Mensalidade no cartão de crédito (ZuckPay, fluxo nacional em BRL).
//
// SEGURANÇA DO CARTÃO — leia antes de mexer aqui:
// - O número, a validade e o CVV chegam do navegador e são repassados DIRETO pra ZuckPay.
// - Nunca gravamos nada disso no banco, nunca colocamos em log (nem em erro) e nunca
//   devolvemos de volta pro navegador. No banco fica só "cartão" + os 4 últimos dígitos.
// - Contra teste de cartão roubado: só usuário logado com e-mail confirmado, e no máximo
//   TENTATIVAS_POR_DIA tentativas de cartão por conta a cada 24h.
// - O plano só é estendido depois que a própria ZuckPay confirma o pagamento.

const crypto = require('crypto');
const {
  PLANOS, zuckpayConfigurado, zuckpay, confirmarPagamento,
  usuarioDaRequisicao, supabaseAdmin, lerPerfil,
} = require('./_comum');

const URL_SITE = 'https://rastreador-de-documentos.vercel.app';
const URL_WEBHOOK = URL_SITE + '/api/webhook-zuckpay';
const TENTATIVAS_POR_DIA = 5;

function soDigitos(v) {
  return String(v == null ? '' : v).replace(/\D/g, '');
}

// algoritmo de Luhn: pega número digitado errado antes de mandar pra operadora
function numeroValido(numero) {
  if (!/^\d{13,19}$/.test(numero)) return false;
  let soma = 0;
  let dobrar = false;
  for (let i = numero.length - 1; i >= 0; i--) {
    let d = Number(numero[i]);
    if (dobrar) { d *= 2; if (d > 9) d -= 9; }
    soma += d;
    dobrar = !dobrar;
  }
  return soma % 10 === 0;
}

function validadeOk(mes, ano) {
  if (!(mes >= 1 && mes <= 12) || !(ano >= 2000 && ano <= 2100)) return false;
  const agora = new Date();
  const anoAtual = agora.getUTCFullYear();
  const mesAtual = agora.getUTCMonth() + 1;
  return ano > anoAtual || (ano === anoAtual && mes >= mesAtual);
}

function mensagemAmigavel(texto) {
  const t = String(texto || '').toLowerCase();
  if (/saldo|insufficient|funds|limite/.test(t)) return 'Cartão sem limite disponível. Tente outro cartão ou pague com Pix.';
  if (/expir|vencid/.test(t)) return 'Cartão vencido. Confira a validade.';
  if (/cvv|cvc|security code|código de segurança/.test(t)) return 'Código de segurança (CVV) incorreto.';
  if (/number|número|invalid card|cartão inválido/.test(t)) return 'Número do cartão inválido. Confira os dígitos.';
  return 'O pagamento não foi aprovado pela operadora do cartão. Confira os dados, tente outro cartão ou pague com Pix.';
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ erro: 'Método não permitido.' });
    return;
  }
  if (!zuckpayConfigurado() || !process.env.SUPABASE_SECRET_KEY) {
    res.status(500).json({ erro: 'Pagamento ainda não configurado no servidor.' });
    return;
  }

  let externalId = null;
  let cobrancaEnviada = false;
  try {
    const usuario = await usuarioDaRequisicao(req);
    if (!usuario) {
      res.status(401).json({ erro: 'Sessão inválida. Entre de novo na sua conta.' });
      return;
    }
    if (!usuario.email_confirmed_at && !usuario.confirmed_at) {
      res.status(403).json({ erro: 'Confirme seu e-mail antes de pagar com cartão.' });
      return;
    }

    // ---- dados do cartão (só em memória, nunca gravados) ----
    const corpo = req.body || {};
    const numero = soDigitos(corpo.numero);
    const titular = String(corpo.titular || '').replace(/\s+/g, ' ').trim().toUpperCase();
    const mes = Number(soDigitos(corpo.mes));
    let ano = Number(soDigitos(corpo.ano));
    if (ano > 0 && ano < 100) ano += 2000;
    const cvv = soDigitos(corpo.cvv);

    if (!numeroValido(numero)) {
      res.status(400).json({ erro: 'Número do cartão inválido. Confira os dígitos.' });
      return;
    }
    if (titular.length < 3 || titular.length > 60 || !/^[A-ZÀ-Ý' .-]+$/.test(titular)) {
      res.status(400).json({ erro: 'Digite o nome como está impresso no cartão.' });
      return;
    }
    if (!validadeOk(mes, ano)) {
      res.status(400).json({ erro: 'Validade inválida ou cartão vencido.' });
      return;
    }
    if (!/^\d{3,4}$/.test(cvv)) {
      res.status(400).json({ erro: 'Código de segurança (CVV) inválido.' });
      return;
    }

    // ---- dados de cobrança e plano ----
    const perfil = await lerPerfil(usuario.id);
    if (!perfil || !perfil.cobranca_cpf || !perfil.cobranca_nome || !perfil.cobranca_telefone) {
      res.status(400).json({ erro: 'Preencha seus dados de cobrança primeiro.', precisaDados: true });
      return;
    }
    const chavePlano = corpo.plano && PLANOS[corpo.plano]
      ? corpo.plano
      : (perfil.plano && PLANOS[perfil.plano] ? perfil.plano : 'premium');
    const plano = PLANOS[chavePlano];

    // ---- limite de tentativas (proteção contra teste de cartão roubado) ----
    const desde = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const tentativas = await supabaseAdmin(
      'pagamentos?user_id=eq.' + usuario.id + '&metodo=eq.cartao&criado_em=gte.' + encodeURIComponent(desde) + '&select=id'
    );
    if (tentativas && tentativas.length >= TENTATIVAS_POR_DIA) {
      res.status(429).json({ erro: 'Muitas tentativas com cartão hoje. Tente de novo amanhã ou pague com Pix.' });
      return;
    }

    externalId = 'dt-' + usuario.id.replace(/-/g, '') + '-' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex');

    // registra antes de cobrar (sem nenhum dado do cartão além dos 4 últimos dígitos)
    await supabaseAdmin('pagamentos', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: {
        user_id: usuario.id,
        plano: chavePlano,
        valor: plano.valor,
        external_id: externalId,
        metodo: 'cartao',
        cartao_final: numero.slice(-4),
      },
    });

    let cobranca;
    try {
      cobrancaEnviada = true;
      cobranca = await zuckpay('/v3/card/charge', {
        method: 'POST',
        body: {
          nome: perfil.cobranca_nome,
          email: usuario.email,
          cpf: perfil.cobranca_cpf,
          phone: perfil.cobranca_telefone,
          valor: plano.valor,
          currency: 'BRL',
          country: 'BR',
          installments: 1,
          card_raw: {
            number: numero,
            holder_name: titular,
            exp_month: String(mes).padStart(2, '0'),
            exp_year: String(ano),
            cvv: cvv,
          },
          descricao: 'DocTrack ' + plano.nome + ' — mensalidade',
          external_id_client: externalId,
          urlnoty: URL_WEBHOOK,
          return_url: URL_SITE + '/planos.html?cartao=retorno',
        },
      });
    } catch (erroZuck) {
      // só status e mensagem; NUNCA o corpo enviado (tem o cartão)
      const msg = erroZuck && erroZuck.message ? String(erroZuck.message).slice(0, 200) : 'erro';
      const httpStatus = erroZuck && erroZuck.status;
      console.error('Cartão recusado/erro ZuckPay:', httpStatus, msg);
      // sem resposta (queda/timeout) ou erro 5xx: a cobrança pode ter passado. Não marca como
      // recusada; o webhook ou a verificação da tela confirmam se foi paga.
      if (!httpStatus || httpStatus >= 500) {
        res.status(502).json({
          erro: 'Não conseguimos confirmar o pagamento agora. Se a cobrança aparecer no seu cartão, o plano é liberado sozinho em alguns minutos. Não tente de novo antes de conferir.',
          verificar: true,
        });
        return;
      }
      await supabaseAdmin('pagamentos?external_id=eq.' + externalId, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: { status: 'FAILED', erro_mensagem: msg },
      });
      res.status(402).json({ erro: mensagemAmigavel(msg) });
      return;
    }

    const status = String(cobranca.status || '').toUpperCase();
    await supabaseAdmin('pagamentos?external_id=eq.' + externalId, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: { transaction_id: String(cobranca.transactionId || cobranca.id || '') || null },
    });

    if (status === 'FAILED' || status === 'REFUSED') {
      const msg = String(cobranca.failureMessage || cobranca.failureCode || 'recusado').slice(0, 200);
      await supabaseAdmin('pagamentos?external_id=eq.' + externalId, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: { status: 'FAILED', erro_mensagem: msg },
      });
      res.status(402).json({ erro: mensagemAmigavel(msg) });
      return;
    }

    if (status === 'PENDING_3DS' && cobranca.threeDSecureUrl) {
      res.status(200).json({ status: 'PENDING_3DS', redirecionar: String(cobranca.threeDSecureUrl) });
      return;
    }

    if (status === 'PAID' || cobranca.isPaid === true) {
      // confere com a ZuckPay e estende o plano (mesmo caminho do Pix e do webhook)
      let resultado = await confirmarPagamento(externalId).catch(function () { return null; });
      if (!resultado || resultado.status !== 'PAID') {
        await new Promise(function (r) { setTimeout(r, 2000); });
        resultado = await confirmarPagamento(externalId).catch(function () { return { status: 'PENDING' }; });
      }
      res.status(200).json({ status: resultado.status, validoAte: resultado.validoAte || null });
      return;
    }

    // PENDING: a confirmação chega pelo webhook; a tela fica verificando
    res.status(200).json({ status: 'PENDING' });
  } catch (erro) {
    console.error('Erro em cartao:', erro && erro.message ? String(erro.message).slice(0, 200) : 'erro');
    if (externalId && !cobrancaEnviada) {
      await supabaseAdmin('pagamentos?external_id=eq.' + externalId + '&status=eq.PENDING', {
        method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: { status: 'FAILED', erro_mensagem: 'erro interno' },
      }).catch(function () {});
    }
    res.status(500).json({
      erro: cobrancaEnviada
        ? 'Não conseguimos confirmar o pagamento agora. Se a cobrança aparecer no seu cartão, o plano é liberado sozinho em alguns minutos. Não tente de novo antes de conferir.'
        : 'Não foi possível processar o cartão agora. Nada foi cobrado. Tente de novo ou pague com Pix.',
      verificar: cobrancaEnviada,
    });
  }
};
