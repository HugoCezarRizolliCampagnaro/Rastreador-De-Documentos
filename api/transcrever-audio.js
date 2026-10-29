// api/transcrever-audio.js
//
// Transforma em texto o áudio gravado no Assistente (usado quando o navegador
// não tem reconhecimento de voz próprio, como Brave e Firefox).
// Recebe { audio: <WAV em base64> } e devolve { texto }.
//
// Env var na Vercel: MISTRAL_API_KEY (a mesma do Assistente)
const { usuarioDaRequisicao } = require('./_comum');

const MODELO_TRANSCRICAO = process.env.MISTRAL_TRANSCRICAO_MODEL || 'voxtral-mini-latest';
const LIMITE_BYTES = 2.5 * 1024 * 1024; // ~80s de áudio 16 kHz mono

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ erro: 'Método não permitido.' });
    return;
  }

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

  const base64 = req.body && typeof req.body.audio === 'string' ? req.body.audio : '';
  if (!base64) {
    res.status(400).json({ erro: 'Áudio não recebido.' });
    return;
  }
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length < 1000) {
    res.status(400).json({ erro: 'Áudio muito curto. Segure um pouco mais e fale de novo.' });
    return;
  }
  if (bytes.length > LIMITE_BYTES) {
    res.status(413).json({ erro: 'Áudio muito longo. Fale em até 1 minuto.' });
    return;
  }

  try {
    const form = new FormData();
    form.append('model', MODELO_TRANSCRICAO);
    form.append('language', 'pt');
    form.append('file', new Blob([bytes], { type: 'audio/wav' }), 'pergunta.wav');

    const resposta = await fetch('https://api.mistral.ai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    const dados = await resposta.json().catch(function () { return {}; });
    if (!resposta.ok) {
      console.error('Transcrição falhou', resposta.status, JSON.stringify(dados).slice(0, 500));
      res.status(502).json({ erro: resposta.status === 429 ? 'Muitos pedidos agora. Espere uns segundos e tente de novo.' : 'Não consegui entender o áudio agora. Tente de novo ou digite a pergunta.' });
      return;
    }
    const texto = String(dados.text || '').trim();
    res.status(200).json({ texto: texto });
  } catch (e) {
    console.error('Transcrição: erro', e);
    res.status(500).json({ erro: 'Não consegui entender o áudio agora. Tente de novo ou digite a pergunta.' });
  }
};
