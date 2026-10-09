// api/analisar-documento.js
//
// Recebe a foto de um documento em base64 e devolve os campos extraídos
// por uma IA com visão (Mistral), pra preencher o formulário de cadastro automaticamente.
// O usuário sempre revisa os campos antes de salvar — essa função nunca salva nada.
//
// Env var necessária na Vercel: MISTRAL_API_KEY

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
    const imagemBase64 = corpo.imagemBase64;
    const mimeType = corpo.mimeType;

    if (!imagemBase64 || !mimeType) {
      res.status(400).json({ erro: 'Envie a imagem (imagemBase64) e o tipo do arquivo (mimeType).' });
      return;
    }

    if (!String(mimeType).startsWith('image/')) {
      res.status(400).json({ erro: 'A leitura automática funciona com foto (JPG ou PNG). Para PDF, preencha manualmente.' });
      return;
    }

    const prompt = `Você está analisando a foto de um documento real: pode ser ASO, NR, alvará, contrato, certificação, RG, CNH ou outro documento com data de validade.

Extraia as informações que conseguir identificar COM CLAREZA na imagem e devolva ESTRITAMENTE um JSON (sem markdown, sem texto fora do JSON) no formato:

{
  "nome": "nome curto e descritivo pro documento (ex: 'ASO - João Silva' ou 'Alvará de Funcionamento')",
  "tipo": "um destes valores exatos: aso, nr, alvara, contrato, certificacao, outro",
  "numero_documento": "número ou código do documento, ou null se não encontrar",
  "data_emissao": "no formato AAAA-MM-DD, ou null se não encontrar",
  "data_vencimento": "no formato AAAA-MM-DD, ou null se não encontrar",
  "categoria_sugerida": "um destes valores exatos: pessoal, veiculo, trabalho, casa, outro",
  "observacoes": "outras informações relevantes visíveis no documento, ou null"
}

Datas no documento costumam estar no formato brasileiro DD/MM/AAAA — converta para AAAA-MM-DD.
Se não tiver certeza de um campo, use null nele em vez de chutar. Nunca invente datas ou números.`;

    const resposta = await chamarMistral(apiKey, {
        model: MODELO_IA,
        temperature: 0.1,
        max_tokens: 700,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: `data:${mimeType};base64,${imagemBase64}` },
            ],
          },
        ],
      });

    const dados = await resposta.json();

    if (!resposta.ok) {
      console.error('Erro Mistral (visão):', JSON.stringify(dados));
      res.status(502).json({ erro: 'A IA não conseguiu analisar a foto agora. (erro '+resposta.status+': '+String((dados && (dados.message || (dados.error && dados.error.message) || dados.detail)) || 'sem detalhe').slice(0,200)+')' });
      return;
    }

    const textoJson = (dados.choices && dados.choices[0] && dados.choices[0].message && dados.choices[0].message.content) || '';

    let extraido;
    try {
      extraido = JSON.parse(String(textoJson).trim());
    } catch (erroParse) {
      console.error('JSON inválido da IA (visão):', textoJson);
      res.status(502).json({ erro: 'A IA devolveu um formato inesperado. Tenta de novo ou preenche manualmente.' });
      return;
    }

    res.status(200).json({ extraido: extraido });
  } catch (erro) {
    console.error('Erro inesperado em analisar-documento:', erro);
    res.status(500).json({ erro: 'Erro interno ao analisar a foto.' });
  }
};
