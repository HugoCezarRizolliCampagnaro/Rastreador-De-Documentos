// api/_comum.js
//
// Funções compartilhadas pelas rotas de pagamento. O "_" no começo do nome faz a Vercel
// NÃO expor este arquivo como uma rota pública.
//
// Variáveis de ambiente (Vercel):
//   ZUCKPAY_CLIENT_ID      client_id da ZuckPay (painel > Desenvolvedores > Credenciais API)
//   ZUCKPAY_CLIENT_SECRET  client_secret da ZuckPay (mesmo lugar)
//   SUPABASE_SECRET_KEY    chave sb_secret_... do Supabase (só no servidor, nunca no navegador)

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

const ZUCKPAY_BASE_URL = 'https://www.zuckpay.com.br/conta'; // com "www": sem ele o POST vira GET num redirecionamento

function zuckpayConfigurado() {
  return !!(process.env.ZUCKPAY_CLIENT_ID && process.env.ZUCKPAY_CLIENT_SECRET);
}

async function zuckpay(caminho, opcoes) {
  const metodo = (opcoes && opcoes.method) || 'GET';
  const url = new URL(ZUCKPAY_BASE_URL + caminho);
  if (opcoes && opcoes.query) {
    Object.keys(opcoes.query).forEach(function (k) { url.searchParams.set(k, opcoes.query[k]); });
  }
  const credencial = Buffer.from(
    String(process.env.ZUCKPAY_CLIENT_ID).trim() + ':' + String(process.env.ZUCKPAY_CLIENT_SECRET).trim(),
    'utf8'
  ).toString('base64');
  const controle = new AbortController();
  const timer = setTimeout(function () { controle.abort(); }, 30000);
  let resp;
  try {
    resp = await fetch(url.toString(), {
      method: metodo,
      redirect: 'error',
      signal: controle.signal,
      headers: Object.assign(
        { Authorization: 'Basic ' + credencial, Accept: 'application/json', 'User-Agent': 'DocTrack' },
        opcoes && opcoes.body ? { 'Content-Type': 'application/json' } : {}
      ),
      body: opcoes && opcoes.body ? JSON.stringify(opcoes.body) : undefined,
    });
  } finally {
    clearTimeout(timer);
  }
  const dados = await resp.json().catch(function () { return {}; });
  if (!resp.ok || dados.success === false || dados.status === 'error') {
    const msg = dados.message || dados.mensagem || dados.error || dados.erro;
    const erro = new Error(typeof msg === 'string' ? msg : 'Erro na ZuckPay (' + resp.status + ')');
    erro.status = resp.status;
    erro.detalhes = dados;
    throw erro;
  }
  return dados;
}

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

// soma N meses a uma data AAAA-MM-DD (31/01 + 1 mês = 28/02 ou 29/02)
function somarMeses(dataStr, meses) {
  const [a, m, d] = dataStr.split('-').map(Number);
  const ultimoDia = new Date(Date.UTC(a, m - 1 + meses + 1, 0)).getUTCDate();
  const nova = new Date(Date.UTC(a, m - 1 + meses, Math.min(d, ultimoDia), 12));
  return nova.toISOString().slice(0, 10);
}

function statusPago(status) {
  return ['PAID', 'APPROVED', 'COMPLETED', 'PAGO'].includes(String(status || '').toUpperCase());
}

// Confere na ZuckPay se a cobrança foi paga e, se foi, estende o plano 1 mês.
// Pode ser chamada várias vezes (webhook + botão "Já paguei"): o plano só é estendido uma vez.
async function confirmarPagamento(externalId) {
  const linhas = await supabaseAdmin('pagamentos?external_id=eq.' + encodeURIComponent(externalId) + '&select=*');
  const pagamento = linhas && linhas[0];
  if (!pagamento) return { status: 'DESCONHECIDO' };
  if (pagamento.status === 'PAID') return { status: 'PAID', jaProcessado: true };

  const consulta = await zuckpay('/v3/pix/status', { query: { external_id_client: externalId } });
  const status = String(consulta.status || (consulta.data && consulta.data.status) || '').toUpperCase();

  if (!statusPago(status)) {
    if (['EXPIRED', 'EXPIRADO', 'FAILED', 'REFUSED', 'CANCELED', 'CANCELLED'].includes(status)) {
      await supabaseAdmin('pagamentos?id=eq.' + pagamento.id + '&status=eq.PENDING', {
        method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: { status: status },
      });
    }
    return { status: status || 'PENDING' };
  }

  // marca como pago só se ainda não estava (evita estender o plano duas vezes)
  const marcados = await supabaseAdmin('pagamentos?id=eq.' + pagamento.id + '&status=neq.PAID', {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: { status: 'PAID', pago_em: new Date().toISOString() },
  });
  if (!marcados || marcados.length === 0) return { status: 'PAID', jaProcessado: true };

  const perfil = await lerPerfil(pagamento.user_id);
  const hoje = dataISO(new Date());
  const base = perfil && perfil.plano === pagamento.plano && perfil.plano_valido_ate && perfil.plano_valido_ate > hoje
    ? perfil.plano_valido_ate
    : hoje;
  const validoAte = somarMeses(base, 1);
  await salvarPerfil(pagamento.user_id, { plano: pagamento.plano, plano_valido_ate: validoAte, assinatura_ativa: true });
  return { status: 'PAID', validoAte: validoAte };
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
  ZUCKPAY_BASE_URL,
  zuckpayConfigurado,
  zuckpay,
  cpfValido,
  somarMeses,
  confirmarPagamento,
  usuarioDaRequisicao,
  supabaseAdmin,
  lerPerfil,
  salvarPerfil,
};
