// api/pix.js
//
// Mensalidade por Pix (ZuckPay). Duas ações, numa rota só:
//   { acao: 'gerar' }     cria o Pix da mensalidade (ou devolve o mesmo, se ainda estiver pendente)
//   { acao: 'verificar' } confere se o último Pix foi pago; se foi, o plano ganha +1 mês
//
// O plano só é estendido depois que a própria ZuckPay confirma o pagamento (GET /v3/pix/status).

const crypto = require('crypto');
const {
  PLANOS, zuckpayConfigurado, zuckpay, confirmarPagamento,
  usuarioDaRequisicao, supabaseAdmin, lerPerfil,
} = require('./_comum');

const URL_WEBHOOK = 'https://rastreador-de-documentos.vercel.app/api/webhook-zuckpay';
const MINUTOS_REAPROVEITAR = 30; // Pix pendente mais novo que isso é reaproveitado (evita cobrança duplicada)

async function ultimoPagamento(userId, soValidos) {
  const filtro = soValidos ? '&status=in.(PENDING,PAID)' : '';
  const linhas = await supabaseAdmin('pagamentos?user_id=eq.' + userId + filtro + '&select=*&order=criado_em.desc&limit=1');
  return linhas && linhas[0] ? linhas[0] : null;
}

function respostaPix(p) {
  return {
    status: p.status,
    valor: Number(p.valor),
    qrcode: p.qrcode,
    qrcodeImagem: p.qrcode_image,
    checkoutUrl: p.checkout_url,
    criadoEm: p.criado_em,
  };
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

  try {
    const usuario = await usuarioDaRequisicao(req);
    if (!usuario) {
      res.status(401).json({ erro: 'Sessão inválida. Entre de novo na sua conta.' });
      return;
    }

    const acao = (req.body || {}).acao;
    const planoPedido = (req.body || {}).plano;

    if (acao === 'verificar') {
      const ultimo = await ultimoPagamento(usuario.id, true);
      if (!ultimo) {
        res.status(200).json({ status: 'NENHUM' });
        return;
      }
      const resultado = await confirmarPagamento(ultimo.external_id);
      res.status(200).json({ status: resultado.status, validoAte: resultado.validoAte || null });
      return;
    }

    if (acao !== 'gerar') {
      res.status(400).json({ erro: 'Ação inválida.' });
      return;
    }

    const perfil = await lerPerfil(usuario.id);
    if (!perfil || !perfil.cobranca_cpf || !perfil.cobranca_nome || !perfil.cobranca_telefone) {
      res.status(400).json({ erro: 'Preencha seus dados de cobrança primeiro.', precisaDados: true });
      return;
    }
    // plano escolhido na tela; se não vier, o plano atual da pessoa
    const chavePlano = planoPedido && PLANOS[planoPedido]
      ? planoPedido
      : (perfil.plano && PLANOS[perfil.plano] ? perfil.plano : 'premium');
    const plano = PLANOS[chavePlano];

    // reaproveita o Pix pendente recente, em vez de criar outro
    const ultimo = await ultimoPagamento(usuario.id);
    if (ultimo && ultimo.status === 'PENDING' && ultimo.qrcode && ultimo.plano === chavePlano &&
        Date.now() - new Date(ultimo.criado_em).getTime() < MINUTOS_REAPROVEITAR * 60000) {
      res.status(200).json(respostaPix(ultimo));
      return;
    }

    const externalId = 'dt-' + usuario.id.replace(/-/g, '') + '-' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex');

    // registra antes de cobrar: se a resposta da ZuckPay se perder, o webhook ainda acha a cobrança
    await supabaseAdmin('pagamentos', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: { user_id: usuario.id, plano: chavePlano, valor: plano.valor, external_id: externalId },
    });

    let cobranca;
    try {
      cobranca = await zuckpay('/v3/pix/qrcode', {
        method: 'POST',
        body: {
          nome: perfil.cobranca_nome,
          cpf: perfil.cobranca_cpf,
          email: usuario.email,
          telefone: perfil.cobranca_telefone,
          valor: plano.valor,
          descricao: 'DocTrack ' + plano.nome + ' — mensalidade',
          external_id_client: externalId,
          urlnoty: URL_WEBHOOK,
        },
      });
    } catch (erroZuck) {
      await supabaseAdmin('pagamentos?external_id=eq.' + externalId, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: { status: 'FAILED' },
      });
      console.error('Erro ZuckPay ao gerar Pix:', erroZuck.status || '', erroZuck.message, JSON.stringify(erroZuck.detalhes || {}).slice(0, 500));
      res.status(502).json({ erro: 'Não foi possível gerar o Pix agora: ' + erroZuck.message });
      return;
    }

    const dados = cobranca.data && typeof cobranca.data === 'object' ? Object.assign({}, cobranca, cobranca.data) : cobranca;
    const atualizado = await supabaseAdmin('pagamentos?external_id=eq.' + externalId, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: {
        transaction_id: String(dados.transactionId || dados.id || '') || null,
        qrcode: dados.qrcode || dados.pix_copia_cola || null,
        qrcode_image: dados.qrcode_image || null,
        checkout_url: dados.checkout_url || null,
      },
    });

    res.status(200).json(respostaPix(atualizado[0]));
  } catch (erro) {
    console.error('Erro em pix:', erro.message);
    res.status(500).json({ erro: 'Erro ao processar o pagamento. Tente de novo.' });
  }
};
