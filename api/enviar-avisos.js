// api/enviar-avisos.js
//
// Roda todo dia de manhã (agendado em vercel.json). Para cada pessoa com notificações ativas,
// junta os documentos que merecem aviso hoje e manda UMA notificação resumindo.
// Só aceita chamadas da Vercel (cabeçalho Authorization com CRON_SECRET).

const { supabaseAdmin } = require('./_comum');
const push = require('./_push');

module.exports = async function handler(req, res) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo || req.headers.authorization !== 'Bearer ' + segredo) {
    res.status(401).json({ erro: 'Não autorizado.' });
    return;
  }

  if (!push.configurar() || !process.env.SUPABASE_SECRET_KEY) {
    res.status(500).json({ erro: 'Notificações ainda não configuradas no servidor.' });
    return;
  }

  try {
    const hoje = push.hojeBrasilia();

    const inscricoes = (await supabaseAdmin('push_inscricoes?select=*')) || [];
    if (inscricoes.length === 0) {
      res.status(200).json({ ok: true, inscricoes: 0, enviadas: 0 });
      return;
    }

    const documentos = (await supabaseAdmin('documentos?select=user_id,nome,data_vencimento,avisos_dias&data_vencimento=not.is.null&limit=5000')) || [];

    const porUsuario = {};
    documentos.forEach(function (d) {
      const dias = push.diasAte(d.data_vencimento, hoje);
      if (!push.deveAvisar(dias, d.avisos_dias)) return;
      (porUsuario[d.user_id] = porUsuario[d.user_id] || []).push({ nome: d.nome, dias: dias });
    });

    let enviadas = 0;
    let removidas = 0;
    let falhas = 0;

    for (const insc of inscricoes) {
      const docs = porUsuario[insc.user_id];
      if (!docs || docs.length === 0) continue;
      docs.sort(function (a, b) { return a.dias - b.dias; });
      try {
        const r = await push.enviar(insc, push.montarMensagem(docs));
        if (r === 'ok') enviadas++;
        else {
          removidas++;
          await supabaseAdmin('push_inscricoes?id=eq.' + insc.id, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
        }
      } catch (e) {
        falhas++;
        console.error('Falha ao enviar push:', e.statusCode || '', e.message);
      }
    }

    res.status(200).json({ ok: true, inscricoes: inscricoes.length, enviadas: enviadas, removidas: removidas, falhas: falhas });
  } catch (erro) {
    console.error('Erro em enviar-avisos:', erro.message);
    res.status(500).json({ erro: 'Erro ao enviar avisos.' });
  }
};
