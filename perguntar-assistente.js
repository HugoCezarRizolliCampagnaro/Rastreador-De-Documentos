// api/perguntar-assistente.js
//
// Recebe a pergunta do usuário + um resumo dos documentos reais dele (já filtrados
// pelo RLS do Supabase no navegador) e devolve uma resposta de uma IA de verdade
// (Mistral), respondendo só com base nesses documentos.
//
// Env var necessária na Vercel: MISTRAL_API_KEY

const MODELO_IA = 'mistral-small-latest';

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
    const dataHoje = corpo.dataHoje || new Date().toISOString().slice(0, 10);

    if (!pergunta || typeof pergunta !== 'string' || !pergunta.trim()) {
      res.status(400).json({ erro: 'Pergunta inválida.' });
      return;
    }

    const resumoDocumentos = documentos.map(function (doc) {
      return (
        `- nome: ${doc.nome} | tipo: ${doc.tipo} | categoria: ${doc.categoria} | ` +
        `cliente/pessoa: ${doc.cliente || '-'} | número: ${doc.numero_documento || '-'} | ` +
        `vencimento: ${doc.data_vencimento} (${doc.dias_restantes} dia(s) a partir de hoje) | ` +
        `custo: ${doc.custo_valor != null ? 'R$ ' + doc.custo_valor : '-'} | pagamento: ${doc.proximo_pagamento_status || '-'}`
      );
    }).join('\n');

    const instrucoes = `Você é o assistente do DocTrack, um app brasileiro de controle de vencimento de documentos (ASO, NR, alvará, contratos, certificações e outros).

Regras importantes:
- Responda SOMENTE com base nos documentos reais listados abaixo.
- Nunca invente documentos, datas, nomes ou valores que não estejam na lista.
- Se a pergunta não puder ser respondida com esses dados, diga isso claramente.
- Responda em português do Brasil, direto e curto (uma frase ou uma lista curta). Sem saudação, sem se apresentar.
- "dias_restantes" negativo significa que o documento já venceu há esse tanto de dias.

Data de hoje: ${dataHoje}

Documentos do usuário:
${resumoDocumentos || '(nenhum documento cadastrado ainda)'}`;

    const resposta = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODELO_IA,
        temperature: 0.3,
        max_tokens: 500,
        messages: [
          { role: 'system', content: instrucoes },
          { role: 'user', content: pergunta.trim() },
        ],
      }),
    });

    const dados = await resposta.json();

    if (!resposta.ok) {
      console.error('Erro Mistral (texto):', JSON.stringify(dados));
      res.status(502).json({ erro: 'A IA não respondeu agora. Tenta de novo em alguns segundos.' });
      return;
    }

    const texto = (dados.choices && dados.choices[0] && dados.choices[0].message && dados.choices[0].message.content) || '';

    res.status(200).json({ resposta: String(texto).trim() || 'Não consegui pensar numa resposta agora. Tenta reformular a pergunta.' });
  } catch (erro) {
    console.error('Erro inesperado em perguntar-assistente:', erro);
    res.status(500).json({ erro: 'Erro interno ao falar com a IA.' });
  }
};
