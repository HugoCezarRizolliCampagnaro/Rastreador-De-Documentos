// api/excluir-conta.js
//
// Exclui DE VEZ a conta de quem está logado: assinatura, arquivos, documentos, gastos,
// pessoas, perfil e o próprio login. Não tem volta. Só funciona se o usuário digitou
// a confirmação certa na tela de Perfil.

const { SUPABASE_URL, asaas, usuarioDaRequisicao, supabaseAdmin, lerPerfil } = require('./_comum');

const BUCKET = 'documentos-arquivos';

async function apagarArquivos(userId) {
  const chave = process.env.SUPABASE_SECRET_KEY;
  const cab = { apikey: chave, 'Content-Type': 'application/json' };

  for (let rodada = 0; rodada < 20; rodada++) {
    const lista = await fetch(SUPABASE_URL + '/storage/v1/object/list/' + BUCKET, {
      method: 'POST',
      headers: cab,
      body: JSON.stringify({ prefix: userId, limit: 100, offset: 0 }),
    });
    if (!lista.ok) throw new Error('listar arquivos: ' + (await lista.text()));
    const itens = (await lista.json()).filter(function (i) { return i && i.name; });
    if (itens.length === 0) return;

    const apagar = await fetch(SUPABASE_URL + '/storage/v1/object/' + BUCKET, {
      method: 'DELETE',
      headers: cab,
      body: JSON.stringify({ prefixes: itens.map(function (i) { return userId + '/' + i.name; }) }),
    });
    if (!apagar.ok) throw new Error('apagar arquivos: ' + (await apagar.text()));
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ erro: 'Método não permitido.' });
    return;
  }

  if (!process.env.SUPABASE_SECRET_KEY) {
    res.status(500).json({ erro: 'Exclusão ainda não configurada no servidor.' });
    return;
  }

  let etapa = 'início';
  try {
    const usuario = await usuarioDaRequisicao(req);
    if (!usuario) {
      res.status(401).json({ erro: 'Sessão inválida. Entre de novo na sua conta.' });
      return;
    }

    if (!req.body || req.body.confirmacao !== 'EXCLUIR') {
      res.status(400).json({ erro: 'Confirmação inválida.' });
      return;
    }

    const id = usuario.id;

    etapa = 'assinatura';
    try {
      const perfil = await lerPerfil(id);
      if (perfil && perfil.asaas_subscription_id && process.env.ASAAS_API_KEY) {
        await asaas('/subscriptions/' + perfil.asaas_subscription_id, { method: 'DELETE' });
      }
    } catch (e) { /* já cancelada ou sem pagamento configurado: segue */ }

    etapa = 'arquivos';
    await apagarArquivos(id);

    // ordem: o que depende de documentos primeiro
    for (const tabela of ['gastos', 'checklist_items', 'historico_documentos', 'documentos', 'pessoas', 'perfis', 'push_inscricoes']) {
      etapa = tabela;
      try {
        await supabaseAdmin(tabela + '?user_id=eq.' + id, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
      } catch (e) {
        // tabela que ainda não existe (ex.: push_inscricoes) não impede a exclusão
        if (!/PGRST205|does not exist|42P01/.test(String(e.message))) throw e;
      }
    }

    etapa = 'login';
    const r = await fetch(SUPABASE_URL + '/auth/v1/admin/users/' + id, {
      method: 'DELETE',
      headers: { apikey: process.env.SUPABASE_SECRET_KEY },
    });
    if (!r.ok) throw new Error('apagar login: ' + (await r.text()));

    res.status(200).json({ ok: true });
  } catch (erro) {
    console.error('Erro em excluir-conta (etapa ' + etapa + '):', erro.message);
    res.status(500).json({ erro: 'Não foi possível excluir tudo agora (etapa: ' + etapa + '). Tente de novo; se continuar, fale com o suporte.' });
  }
};
