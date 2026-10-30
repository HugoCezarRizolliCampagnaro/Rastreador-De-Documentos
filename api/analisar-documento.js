// api/analisar-documento.js
//
// Recebe a foto (ou PDF) de um documento em base64 e devolve os campos extraídos
// por uma IA com visão (Mistral), pra preencher o formulário de cadastro automaticamente.
// O usuário sempre revisa os campos antes de salvar — essa função nunca salva nada.
//
// Env var necessária na Vercel: MISTRAL_API_KEY

// Modelo com limites bem mais altos na conta grátis. Dá pra trocar sem mexer no código: variável MISTRAL_MODEL na Vercel.
const { usuarioDaRequisicao } = require('./_comum');

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

  // só quem está logado no DocTrack pode usar a IA (senão qualquer pessoa gastaria a sua cota da Mistral)
  const usuario = await usuarioDaRequisicao(req).catch(function () { return null; });
  if (!usuario) {
    res.status(401).json({ erro: 'Sessão inválida. Entre de novo na sua conta.' });
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
    // várias fotos do mesmo documento (frente, verso...): até 3
    const imagens = (Array.isArray(corpo.imagens) ? corpo.imagens : [])
      .filter(function (b) { return typeof b === 'string' && b.length > 100; })
      .slice(0, 3);

    if ((!imagemBase64 && !imagens.length) || !mimeType) {
      res.status(400).json({ erro: 'Envie a imagem (imagemBase64) e o tipo do arquivo (mimeType).' });
      return;
    }

    const ehPdf = mimeType === 'application/pdf';
    if (!ehPdf && !String(mimeType).startsWith('image/')) {
      res.status(400).json({ erro: 'A leitura automática funciona com foto (JPG ou PNG) ou PDF.' });
      return;
    }

    // PDF: primeiro o OCR da Mistral transforma as páginas em texto
    let textoPdf = null;
    if (ehPdf) {
      const respOcr = await fetch('https://api.mistral.ai/v1/ocr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: process.env.MISTRAL_OCR_MODEL || 'mistral-ocr-latest',
          document: { type: 'document_url', document_url: `data:application/pdf;base64,${imagemBase64}` },
          pages: [0, 1, 2],
        }),
      });
      const dadosOcr = await respOcr.json().catch(function () { return {}; });
      if (!respOcr.ok) {
        console.error('Erro Mistral (OCR):', JSON.stringify(dadosOcr));
        res.status(502).json({ erro: 'A IA não conseguiu ler esse PDF agora. Tente uma foto do documento ou preencha manualmente.' });
        return;
      }
      textoPdf = (dadosOcr.pages || []).map(function (pg) { return pg.markdown || ''; }).join('\n\n').slice(0, 12000);
      if (!textoPdf.trim()) {
        res.status(422).json({ erro: 'Não encontrei texto nesse PDF. Tente uma foto do documento ou preencha manualmente.' });
        return;
      }
    }

    const prompt = `Você está analisando a foto de um documento real: pode ser ASO, NR, alvará, contrato, certificação, conta/boleto (aluguel, luz, mensalidade), imposto/taxa (DAS, IPTU, IPVA), RG, CNH ou outro documento com data de validade ou vencimento.

Extraia as informações que conseguir identificar COM CLAREZA na imagem e devolva ESTRITAMENTE um JSON (sem markdown, sem texto fora do JSON) no formato:

{
  "nome": "nome curto e comum pro documento, como as pessoas falam (ex: 'RG', 'CNH', 'ASO - João Silva', 'Alvará de Funcionamento', 'DAS - outubro')",
  "tipo": "um destes valores exatos: aso, nr, alvara, contrato, certificacao, conta, imposto, outro (conta = boleto ou fatura; imposto = guia de imposto ou taxa)",
  "numero_documento": "número ou código do documento, ou null se não encontrar",
  "data_emissao": "data de EMISSÃO ou EXPEDIÇÃO do documento, no formato AAAA-MM-DD, ou null se não estiver escrita como emissão/expedição",
  "data_vencimento": "no formato AAAA-MM-DD, ou null se não encontrar",
  "categoria_sugerida": "um destes valores exatos: pessoal, veiculo, trabalho, casa, outro",
  "observacoes": "UM texto curto (string, até 200 caracteres) com algo útil pra renovação, como órgão emissor ou categoria da CNH, ou null"
}

Datas no documento costumam estar no formato brasileiro DD/MM/AAAA — converta para AAAA-MM-DD.
Se não tiver certeza de um campo, use null nele em vez de chutar. Nunca invente datas ou números.
NUNCA use a data de nascimento como data de emissão ou de vencimento. Data de nascimento, nome dos pais, naturalidade e CPF não vão em observacoes.
Na carteira de identidade (RG/CIN), a validade costuma aparecer como "Validade" e a emissão como "Data de expedição"; se só tiver data de nascimento e validade, data_emissao é null.`;

    // pergunta pra IA com um conteúdo (texto do PDF ou 1 foto) e devolve o JSON lido
    async function perguntar(conteudo) {
      const resposta = await chamarMistral(apiKey, {
        model: MODELO_IA,
        temperature: 0.1,
        max_tokens: 700,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: conteudo }],
      });
      const dados = await resposta.json().catch(function () { return {}; });
      if (!resposta.ok) {
        console.error('Erro Mistral (visão):', JSON.stringify(dados));
        return { erro: 'A IA não conseguiu analisar a foto agora. (erro ' + resposta.status + ': ' + String((dados && (dados.message || (dados.error && dados.error.message) || dados.detail)) || 'sem detalhe').slice(0, 200) + ')' };
      }
      const textoJson = (dados.choices && dados.choices[0] && dados.choices[0].message && dados.choices[0].message.content) || '';
      try {
        return { extraido: JSON.parse(String(textoJson).trim()) };
      } catch (erroParse) {
        console.error('JSON inválido da IA (visão):', textoJson);
        return { erro: 'A IA devolveu um formato inesperado. Tenta de novo ou preenche manualmente.' };
      }
    }

    let extraido;
    if (ehPdf) {
      const r = await perguntar([{ type: 'text', text: prompt.replace('a foto de um documento real', 'o texto extraído de um PDF de documento real').replace('na imagem', 'no texto') + '\n\nTEXTO DO DOCUMENTO:\n' + textoPdf }]);
      if (r.erro) { res.status(502).json({ erro: r.erro }); return; }
      extraido = r.extraido;
    } else {
      // uma foto por vez (a IA lê melhor assim) e junta: o que a 1ª (frente) achou vale primeiro,
      // o que faltar vem das outras (ex.: data de expedição no verso do RG)
      const fotos = imagens.length ? imagens : [imagemBase64];
      const tipoFoto = imagens.length ? 'image/jpeg' : mimeType;
      extraido = {};
      let ultimoErro = null, algumaDeuCerto = false;
      for (let i = 0; i < fotos.length; i++) {
        const texto = fotos.length > 1
          ? prompt + '\nEsta é a foto ' + (i + 1) + ' de ' + fotos.length + ' do mesmo documento (pode ser a frente, o verso ou outra página). Extraia só o que aparece nesta foto.'
          : prompt;
        const r = await perguntar([{ type: 'text', text: texto }, { type: 'image_url', image_url: `data:${tipoFoto};base64,${fotos[i]}` }]);
        if (r.erro) { ultimoErro = r.erro; continue; }
        algumaDeuCerto = true;
        const e = r.extraido && typeof r.extraido === 'object' ? r.extraido : {};
        Object.keys(e).forEach(function (k) {
          const vazio = extraido[k] == null || extraido[k] === '' || extraido[k] === 'null';
          if (vazio && e[k] != null && e[k] !== '' && e[k] !== 'null') extraido[k] = e[k];
        });
        // tipo "outro" da frente não impede um tipo mais certo das outras fotos
        if (extraido.tipo === 'outro' && e.tipo && e.tipo !== 'outro') extraido.tipo = e.tipo;
      }
      if (!algumaDeuCerto) { res.status(502).json({ erro: ultimoErro || 'A IA não conseguiu analisar a foto agora.' }); return; }
    }

    // a IA às vezes devolve objeto/lista onde era pra ser texto: vira texto simples (ou some)
    function comoTexto(v, max) {
      if (v == null) return null;
      if (typeof v === 'object') {
        v = Array.isArray(v) ? v.join(', ') : Object.keys(v).map(function (k) { return k + ': ' + v[k]; }).join('; ');
      }
      v = String(v).trim();
      return v && v !== 'null' ? v.slice(0, max) : null;
    }
    extraido = extraido && typeof extraido === 'object' ? extraido : {};
    ['nome', 'tipo', 'numero_documento', 'data_emissao', 'data_vencimento', 'categoria_sugerida'].forEach(function (k) {
      extraido[k] = comoTexto(extraido[k], 120);
    });
    extraido.observacoes = comoTexto(extraido.observacoes, 300);
    if (extraido.data_emissao && extraido.data_emissao === extraido.data_vencimento) extraido.data_emissao = null;

    res.status(200).json({ extraido: extraido });
  } catch (erro) {
    console.error('Erro inesperado em analisar-documento:', erro);
    res.status(500).json({ erro: 'Erro interno ao analisar a foto.' });
  }
};
