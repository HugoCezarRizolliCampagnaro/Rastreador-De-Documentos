// api/perguntar-assistente.js
//
// Recebe a pergunta do usuário + um resumo dos documentos reais dele (já filtrados
// pelo RLS do Supabase no navegador) + as últimas mensagens da conversa, e devolve
// a resposta de uma IA de verdade (Mistral).
//
// Env vars na Vercel: MISTRAL_API_KEY (obrigatória), MISTRAL_MODEL (opcional)

// Modelo com limites bem mais altos na conta grátis. Dá pra trocar sem mexer no código: variável MISTRAL_MODEL na Vercel.
const MODELO_IA = process.env.MISTRAL_MODEL || 'ministral-8b-2512';

// A Mistral grátis limita quantas chamadas por segundo/minuto. Se der 429, espera um pouco e tenta de novo.
async function chamarMistral(apiKey, corpo) {
  const esperas = [1500, 3000];
  let resposta;
  for (let tentativa = 0; tentativa <= esperas.length; tentativa++) {
    resposta = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(corpo),
    });
    if (resposta.status !== 429 || tentativa === esperas.length) break;
    await new Promise(function (r) { setTimeout(r, esperas[tentativa]); });
  }
  return resposta;
}

function ehDataISO(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function paraMs(dataISO) {
  const p = dataISO.split('-').map(Number);
  return Date.UTC(p[0], p[1] - 1, p[2]);
}

function dataBR(dataISO) {
  const p = dataISO.split('-');
  return p[2] + '/' + p[1] + '/' + p[0];
}

// Calcula aqui no servidor, a partir da data de hoje do usuário, pra IA nunca errar a conta.
function situacao(vencimentoISO, hojeISO) {
  if (!ehDataISO(vencimentoISO)) return 'sem data de vencimento';
  const dias = Math.round((paraMs(vencimentoISO) - paraMs(hojeISO)) / 86400000);
  const quando = dataBR(vencimentoISO);
  if (dias < 0) return 'VENCIDO há ' + (-dias) + (dias === -1 ? ' dia' : ' dias') + ' (venceu em ' + quando + ')';
  if (dias === 0) return 'vence HOJE (' + quando + ')';
  if (dias === 1) return 'vence AMANHÃ (' + quando + ')';
  return 'vence em ' + dias + ' dias (' + quando + ')';
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ erro: 'Método não permitido.' });
    return;
  }

  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    res.status(500).json({ erro: 'IA não configurada no servidor (falta a variável MISTRAL_API_KEY na Vercel).' });
    return;
  }

  try {
    const corpo = req.body || {};
    const pergunta = corpo.pergunta;
    const documentos = Array.isArray(corpo.documentos) ? corpo.documentos : [];
    const dataHoje = ehDataISO(corpo.dataHoje) ? corpo.dataHoje : new Date().toISOString().slice(0, 10);

    if (!pergunta || typeof pergunta !== 'string' || !pergunta.trim()) {
      res.status(400).json({ erro: 'Pergunta inválida.' });
      return;
    }

    // últimas mensagens da conversa, pra IA lembrar do assunto
    const historico = (Array.isArray(corpo.historico) ? corpo.historico : [])
      .filter(function (m) { return m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim(); })
      .slice(-6)
      .map(function (m) { return { role: m.role, content: m.content.slice(0, 600) }; });

    const ordenados = documentos.slice().sort(function (a, b) {
      return String(a.data_vencimento).localeCompare(String(b.data_vencimento));
    });

    const resumoDocumentos = ordenados.map(function (doc) {
      const extras = [];
      if (doc.cliente) extras.push('pessoa/empresa: ' + doc.cliente);
      if (doc.numero_documento) extras.push('número: ' + doc.numero_documento);
      if (doc.custo_valor != null) extras.push('custo: R$ ' + doc.custo_valor);
      if (doc.proximo_pagamento_status) extras.push('pagamento: ' + doc.proximo_pagamento_status);
      return '- ' + doc.nome + ' (' + (doc.tipo || 'documento') + ', categoria ' + (doc.categoria || 'outro') + ') — ' +
        situacao(doc.data_vencimento, dataHoje) + (extras.length ? ' — ' + extras.join(', ') : '');
    }).join('\n');

    const instrucoes = `Você é o assistente do DocTrack, um app brasileiro que controla o vencimento de documentos (ASO, NR, alvará, contratos, certificações, etc.). Você conversa de verdade com a pessoa: simpático, natural e direto, em português do Brasil, tratando por "você". No máximo um emoji de vez em quando.

COMO RESPONDER:
1. Cumprimentos, agradecimentos, despedidas e conversa leve ("oi", "valeu", "obrigado", "tudo bem?"): responda de forma natural e calorosa em 1 ou 2 frases. NÃO liste os documentos nesses casos. Num "oi", cumprimente e pergunte como pode ajudar, sugerindo no máximo uma ou duas coisas (ex.: ver o que vence primeiro).
2. Perguntas sobre os documentos DA PESSOA: use SOMENTE a lista abaixo. Nunca invente documentos, datas, números ou valores. Se a informação não estiver na lista, diga isso com simplicidade.
3. Perguntas gerais sobre documentos (o que é um ASO ou uma NR, como renovar, o que fazer com documento vencido): pode explicar de forma breve com conhecimento geral. Deixe claro que é orientação geral e que as regras podem variar, então vale confirmar com o órgão ou a empresa responsável. Não dê aconselhamento jurídico.
4. Assuntos fora do tema do app: diga gentilmente que seu foco é ajudar com documentos e prazos, e ofereça ajuda nisso.

FORMATO:
- Curto: no máximo uns 4 ou 5 linhas. Use lista com "- " só quando listar vários documentos, do mais urgente para o menos urgente.
- Use **negrito** apenas no nome do documento.
- Use a "situação" de cada documento exatamente como está na lista (ela já foi calculada). Não refaça contas de dias. Diga "venceu há 5 dias", "vence hoje", "vence amanhã".
- Nunca mostre nomes técnicos de campos (como dias_restantes) nem formato de data 2026-10-03; use dd/mm/aaaa.
- Documento vencido merece um aviso de atenção, sem dramatizar.

Data de hoje: ${dataBR(dataHoje)}

Documentos da pessoa (já em ordem de vencimento):
${resumoDocumentos || '(nenhum documento cadastrado ainda)'}`;

    const resposta = await chamarMistral(apiKey, {
      model: MODELO_IA,
      temperature: 0.5,
      max_tokens: 450,
      messages: [{ role: 'system', content: instrucoes }].concat(historico, [{ role: 'user', content: pergunta.trim() }]),
    });

    const dados = await resposta.json();

    if (!resposta.ok) {
      console.error('Erro Mistral (texto):', JSON.stringify(dados));
      res.status(502).json({ erro: 'A IA não respondeu agora. (erro ' + resposta.status + ': ' + String((dados && (dados.message || (dados.error && dados.error.message) || dados.detail)) || 'sem detalhe').slice(0, 200) + ')' });
      return;
    }

    const texto = (dados.choices && dados.choices[0] && dados.choices[0].message && dados.choices[0].message.content) || '';

    res.status(200).json({ resposta: String(texto).trim() || 'Não consegui pensar numa resposta agora. Tenta reformular a pergunta.' });
  } catch (erro) {
    console.error('Erro inesperado em perguntar-assistente:', erro);
    res.status(500).json({ erro: 'Erro interno ao falar com a IA.' });
  }
};
