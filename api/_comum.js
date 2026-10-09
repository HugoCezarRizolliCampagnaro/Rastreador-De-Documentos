// api/_comum.js
//
// Funções compartilhadas pelas rotas de pagamento. O "_" no começo do nome faz a Vercel
// NÃO expor este arquivo como uma rota pública.
//
// Variáveis de ambiente (Vercel):
//   ASAAS_API_KEY        chave de API do Asaas (sandbox ou produção)
//   ASAAS_BASE_URL       https://api-sandbox.asaas.com/v3  (testes)  ou  https://api.asaas.com/v3  (valendo)
//   ASAAS_WEBHOOK_TOKEN  texto secreto qualquer; o mesmo vai no cadastro do webhook no Asaas
//   SUPABASE_SECRET_KEY  chave sb_secret_... do Supabase (só no servidor, nunca no navegador)

const SUPABASE_URL = 'https://qybgrfdvpptnauyqtdxu.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_brDnSPSCu4ry9QTe-pYwag_zRqB6hkL';

const PLANOS = {
  premium: { nome: 'Premium', valor: 9.9 },
};

const DIAS_TESTE_GRATIS = 30;
const DIAS_TOLERANCIA = 3;

function dataISO(data) {
  // AAAA-MM-DD no horário de Brasília
  return data.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
}

function somarDias(data, dias) {
  const nova = new Date(data.getTime());
  nova.setUTCDate(nova.getUTCDate() + dias);
  return nova;
}

async function asaas(caminho, opcoes) {
  const resp = await fetch(process.env.ASAAS_BASE_URL + caminho, {
    method: (opcoes && opcoes.method) || 'GET',
    headers: {
      'Content-Type': 'application/json',
      access_token: process.env.ASAAS_API_KEY,
      'User-Agent': 'DocTrack',
    },
    body: opcoes && opcoes.body ? JSON.stringify(opcoes.body) : undefined,
  });
  const dados = await resp.json().catch(function () { return {}; });
  if (!resp.ok) {
    const msg = dados && dados.errors && dados.errors[0] && dados.errors[0].description;
    const erro = new Error(msg || 'Erro no Asaas (' + resp.status + ')');
    erro.status = resp.status;
    erro.detalhes = dados;
    throw erro;
  }
  return dados;
}

// confirma quem é o usuário a partir do token de login enviado pelo navegador
async function usuarioDaRequisicao(req) {
  const cabecalho = req.headers.authorization || '';
  const token = cabecalho.startsWith('Bearer ') ? cabecalho.slice(7) : null;
  if (!token) return null;
  const resp = await fetch(SUPABASE_URL + '/auth/v1/user', {
    headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: 'Bearer ' + token },
  });
  if (!resp.ok) return null;
  const usuario = await resp.json();
  return usuario && usuario.id ? usuario : null;
}

// acesso ao banco com a chave secreta (ignora o RLS — por isso só roda no servidor)
function chaveAdmin() {
  const chave = (process.env.SUPABASE_SECRET_KEY || '').trim();
  // erros comuns: colar a chave pública no lugar da secreta (ela não ignora o RLS)
  if (chave.indexOf('sb_publishable_') === 0) {
    throw new Error('SUPABASE_SECRET_KEY está com a chave PUBLICÁVEL (sb_publishable_...). Troque pela chave SECRETA (sb_secret_...).');
  }
  if (chave.indexOf('eyJ') === 0) {
    try {
      const papel = JSON.parse(Buffer.from(chave.split('.')[1], 'base64').toString('utf8')).role;
      if (papel !== 'service_role') throw new Error('SUPABASE_SECRET_KEY está com a chave "' + papel + '". Use a chave secreta (sb_secret_...) ou a service_role.');
    } catch (e) {
      if (e.message.indexOf('SUPABASE_SECRET_KEY') === 0) throw e;
    }
  }
  return chave;
}

async function supabaseAdmin(caminho, opcoes) {
  const resp = await fetch(SUPABASE_URL + '/rest/v1/' + caminho, {
    method: (opcoes && opcoes.method) || 'GET',
    headers: Object.assign(
      {
        apikey: chaveAdmin(),
        'Content-Type': 'application/json',
      },
      (opcoes && opcoes.headers) || {}
    ),
    body: opcoes && opcoes.body ? JSON.stringify(opcoes.body) : undefined,
  });
  const texto = await resp.text();
  if (!resp.ok) throw new Error('Erro no Supabase: ' + texto);
  return texto ? JSON.parse(texto) : null;
}

async function lerPerfil(userId) {
  const linhas = await supabaseAdmin('perfis?user_id=eq.' + userId + '&select=*');
  return linhas && linhas[0] ? linhas[0] : null;
}

async function salvarPerfil(userId, campos) {
  await supabaseAdmin('perfis?on_conflict=user_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: Object.assign({ user_id: userId }, campos),
  });
}

module.exports = {
  SUPABASE_URL,
  PLANOS,
  DIAS_TESTE_GRATIS,
  DIAS_TOLERANCIA,
  dataISO,
  somarDias,
  asaas,
  usuarioDaRequisicao,
  supabaseAdmin,
  lerPerfil,
  salvarPerfil,
};
