// api/webhook-asaas.js
//
// O Asaas avisa esta rota quando uma cobrança é paga. Aqui renovamos o plano da pessoa.
// Só confiamos no aviso se o cabeçalho "asaas-access-token" bater com ASAAS_WEBHOOK_TOKEN.

const { DIAS_TOLERANCIA, dataISO, somarDias, asaas, salvarPerfil } = require('./_comum');

function somarUmMes(dataStr) {
  const [a, m, d] = dataStr.split('-').map(Number);
  const nova = new Date(Date.UTC(a, m, d)); // mês seguinte (m já é base 1)
  return nova;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ erro: 'Método não permitido.' });
    return;
  }

  const esperado = process.env.ASAAS_WEBHOOK_TOKEN;
  if (!esperado || req.headers['asaas-access-token'] !== esperado) {
    res.status(401).json({ erro: 'Não autorizado.' });
    return;
  }

  try {
    const evento = req.body || {};
    const pagamento = evento.payment;

    const eventosDePagamento = ['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED'];
    if (!eventosDePagamento.includes(evento.event) || !pagamento || !pagamento.subscription) {
      res.status(200).json({ ok: true, ignorado: true });
      return;
    }

    const assinatura = await asaas('/subscriptions/' + pagamento.subscription);
    const referencia = String(assinatura.externalReference || '');
    const [userId, plano] = referencia.split(':');
    if (!userId || !plano) {
      res.status(200).json({ ok: true, ignorado: true });
      return;
    }

    // vale até 1 mês depois do vencimento desta cobrança (+ tolerância)
    const vencimento = pagamento.dueDate || dataISO(new Date());
    const validoAte = dataISO(somarDias(somarUmMes(vencimento), DIAS_TOLERANCIA));

    await salvarPerfil(userId, { plano: plano, plano_valido_ate: validoAte });

    res.status(200).json({ ok: true });
  } catch (erro) {
    console.error('Erro em webhook-asaas:', erro.message);
    res.status(500).json({ erro: 'Erro ao processar.' }); // o Asaas tenta de novo
  }
};
