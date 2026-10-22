// api/webhook-zuckpay.js
//
// A ZuckPay chama esta rota quando um Pix muda de status. Não confiamos no conteúdo do aviso:
// pegamos só o ID da cobrança e perguntamos pra própria ZuckPay (com as nossas credenciais)
// se ela foi paga. Assim, um aviso falso nunca libera plano de graça.

const { zuckpayConfigurado, confirmarPagamento, supabaseAdmin } = require('./_comum');

function acharExternalId(corpo) {
  if (!corpo || typeof corpo !== 'object') return null;
  const fontes = [corpo, corpo.data, corpo.transaction, corpo.payment].filter(function (o) { return o && typeof o === 'object'; });
  for (const o of fontes) {
    const id = o.external_id_client || o.externalIdClient || o.external_id || o.externalId || o.external_reference;
    if (typeof id === 'string' && /^dt-[A-Za-z0-9]+-[A-Za-z0-9]+$/.test(id)) return id;
  }
  return null;
}

// se o aviso só trouxer o ID da transação da ZuckPay, procura a cobrança por ele
async function externalIdPelaTransacao(corpo) {
  if (!corpo || typeof corpo !== 'object') return null;
  const fontes = [corpo, corpo.data, corpo.transaction, corpo.payment].filter(function (o) { return o && typeof o === 'object'; });
  for (const o of fontes) {
    const id = o.transactionId || o.transaction_id || o.id;
    if ((typeof id === 'string' || typeof id === 'number') && /^[A-Za-z0-9._:-]{1,100}$/.test(String(id))) {
      const linhas = await supabaseAdmin('pagamentos?transaction_id=eq.' + encodeURIComponent(String(id)) + '&select=external_id&limit=1');
      if (linhas && linhas[0]) return linhas[0].external_id;
    }
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ erro: 'Método não permitido.' });
    return;
  }
  if (!zuckpayConfigurado()) {
    res.status(500).json({ erro: 'Pagamento não configurado.' });
    return;
  }

  try {
    let corpo = req.body;
    if (typeof corpo === 'string') {
      try { corpo = JSON.parse(corpo); } catch (e) { corpo = null; }
    }
    const externalId = acharExternalId(corpo) || await externalIdPelaTransacao(corpo);
    if (!externalId) {
      res.status(200).json({ ok: true, ignorado: true });
      return;
    }
    const resultado = await confirmarPagamento(externalId);
    res.status(200).json({ ok: true, status: resultado.status });
  } catch (erro) {
    console.error('Erro em webhook-zuckpay:', erro.message);
    res.status(500).json({ erro: 'Erro ao processar.' }); // a ZuckPay pode tentar de novo
  }
};
