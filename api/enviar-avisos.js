// api/enviar-avisos.js
//
// Roda todo dia de manhã (agendado em vercel.json). Para cada pessoa com notificações ativas,
// junta os documentos que merecem aviso hoje e manda UMA notificação resumindo.
// Só aceita chamadas da Vercel (cabeçalho Authorization com CRON_SECRET).

const { supabaseAdmin } = require('./_comum');
const push = require('./_push');

const ENVIOS_AO_MESMO_TEMPO = 10;

// O Supabase devolve no máximo ~1000 linhas por consulta. Aqui lemos em páginas até acabar,
// pra ninguém ficar sem aviso quando houver muita gente.
async function buscarTudo(caminho) {
  const separador = caminho.indexOf('?') === -1 ? '?' : '&';
  const todos = [];
  let inicio = 0;
  for (let pagina = 0; pagina < 500; pagina++) {
    const lote = (await supabaseAdmin(caminho + separador + 'order=id&limit=1000&offset=' + inicio)) || [];
    if (lote.length === 0) break;
    todos.push.apply(todos, lote);
    inicio += lote.length;
  }
  return todos;
}

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

    const inscricoes = await buscarTudo('push_inscricoes?select=*');
    if (inscricoes.length === 0) {
      res.status(200).json({ ok: true, inscricoes: 0, enviadas: 0 });
      return;
    }

    const documentos = await buscarTudo('documentos?select=id,user_id,nome,data_vencimento,avisos_dias&data_vencimento=not.is.null');

    const porUsuario = {};
    documentos.forEach(function (d) {
      const dias = push.diasAte(d.data_vencimento, hoje);
      if (!push.deveAvisar(dias, d.avisos_dias)) return;
      (porUsuario[d.user_id] = porUsuario[d.user_id] || []).push({ nome: d.nome, dias: dias });
    });

    let enviadas = 0;
    let removidas = 0;
    let falhas = 0;

    const alvos = inscricoes.filter(function (insc) {
      const docs = porUsuario[insc.user_id];
      return docs && docs.length > 0;
    });

    // manda em grupos, pra não estourar o tempo da função quando houver muitos aparelhos
    for (let i = 0; i < alvos.length; i += ENVIOS_AO_MESMO_TEMPO) {
      await Promise.all(alvos.slice(i, i + ENVIOS_AO_MESMO_TEMPO).map(async function (insc) {
        const docs = porUsuario[insc.user_id].slice().sort(function (a, b) { return a.dias - b.dias; });
        try {
          const r = await push.enviar(insc, push.montarMensagem(docs));
          if (r === 'ok') {
            enviadas++;
          } else {
            removidas++;
            await supabaseAdmin('push_inscricoes?id=eq.' + insc.id, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
          }
        } catch (e) {
          falhas++;
          console.error('Falha ao enviar push:', e.statusCode || '', e.message);
        }
      }));
    }

    res.status(200).json({ ok: true, inscricoes: inscricoes.length, enviadas: enviadas, removidas: removidas, falhas: falhas });
  } catch (erro) {
    console.error('Erro em enviar-avisos:', erro.message);
    res.status(500).json({ erro: 'Erro ao enviar avisos.' });
  }
};
