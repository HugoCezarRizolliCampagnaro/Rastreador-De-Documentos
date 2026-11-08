// bloqueio.js — trava de privacidade com digital/rosto (opcional, desligada por padrão).
// Liga em Perfil > "Bloquear com digital ou rosto". Usa o leitor do próprio aparelho (WebAuthn).
// É uma trava do aparelho (não substitui a senha da conta): "Usar senha" sai da conta e desliga a trava.
// Carregado no <head> de todas as telas do app, pra esconder o conteúdo antes de aparecer.
(function () {
  var CHAVE = 'bloqueio-cred';

  function paraB64(buf) {
    var s = ''; var b = new Uint8Array(buf);
    for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function deB64(t) {
    t = t.replace(/-/g, '+').replace(/_/g, '/'); while (t.length % 4) t += '=';
    var s = atob(t); var b = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
    return b;
  }
  function aleatorio(n) { var b = new Uint8Array(n); crypto.getRandomValues(b); return b; }
  function ler(k, area) { try { return (area || localStorage).getItem(k); } catch (e) { return null; } }

  var cred = ler(CHAVE);
  var liberado = ler('desbloqueado', sessionStorage) === '1';

  async function verificar() {
    await navigator.credentials.get({ publicKey: {
      challenge: aleatorio(32),
      allowCredentials: [{ type: 'public-key', id: deB64(cred), transports: ['internal', 'hybrid'] }],
      userVerification: 'required',
      timeout: 60000,
    } });
    try { sessionStorage.setItem('desbloqueado', '1'); } catch (e) {}
  }

  function sairComSenha() {
    try {
      localStorage.removeItem(CHAVE);
      Object.keys(localStorage).forEach(function (k) { if (k.indexOf('sb-') === 0 && k.indexOf('auth-token') !== -1) localStorage.removeItem(k); });
    } catch (e) {}
    window.location.href = 'login.html';
  }

  function mostrarTela() {
    if (document.getElementById('tela-bloqueio')) return;
    var el = document.createElement('div');
    el.id = 'tela-bloqueio';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.innerHTML =
      '<img src="icons/icon-192.png" alt="" width="72" height="72">' +
      '<strong>DocTrack bloqueado</strong>' +
      '<span>Use a digital ou o rosto pra ver seus documentos.</span>' +
      '<button type="button" id="btn-desbloquear">Desbloquear</button>' +
      '<p id="erro-bloqueio" hidden></p>' +
      '<button type="button" id="btn-usar-senha" class="sec">Usar senha</button>';
    document.body.appendChild(el);
    var erro = el.querySelector('#erro-bloqueio');
    async function tentar(silencioso) {
      try {
        await verificar();
        document.documentElement.classList.remove('bloqueado');
        el.remove();
      } catch (e) {
        if (!silencioso) { erro.textContent = 'Não deu certo. Tente de novo ou use a senha.'; erro.hidden = false; }
      }
    }
    el.querySelector('#btn-desbloquear').addEventListener('click', function () { tentar(false); });
    el.querySelector('#btn-usar-senha').addEventListener('click', sairComSenha);
    tentar(true); // alguns celulares já abrem o leitor sozinhos
  }

  function bloquear() {
    document.documentElement.classList.add('bloqueado');
    if (document.body) mostrarTela(); else document.addEventListener('DOMContentLoaded', mostrarTela);
  }

  if (cred && window.PublicKeyCredential) {
    var st = document.createElement('style');
    st.textContent =
      'html.bloqueado body > *:not(#tela-bloqueio) { visibility: hidden !important; }' +
      '#tela-bloqueio { position: fixed; inset: 0; z-index: 100000; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 24px; text-align: center; background: var(--bg, #0B0E14); color: var(--texto, #F1F2F4); font-family: inherit; }' +
      '#tela-bloqueio img { border-radius: 18px; margin-bottom: 6px; }' +
      '#tela-bloqueio strong { font-size: 20px; }' +
      '#tela-bloqueio span { font-size: 14px; color: var(--texto-muted, #8A93A3); max-width: 300px; line-height: 1.45; }' +
      '#tela-bloqueio button { margin-top: 8px; width: 100%; max-width: 300px; padding: 14px; border-radius: 12px; border: none; background: var(--marca, #5B6EF5); color: #fff; font: inherit; font-size: 15px; font-weight: 700; cursor: pointer; }' +
      '#tela-bloqueio button.sec { background: transparent; color: var(--texto-muted, #8A93A3); font-weight: 600; margin-top: 0; }' +
      '#tela-bloqueio p { margin: 0; font-size: 13px; color: var(--status-vermelho, #F2555C); }';
    document.head.appendChild(st);
    if (!liberado) bloquear();
    // voltou depois de mais de 5 min em segundo plano: pede de novo
    document.addEventListener('visibilitychange', function () {
      if (!ler(CHAVE)) return;
      if (document.hidden) { try { sessionStorage.setItem('oculto-em', String(Date.now())); } catch (e) {} return; }
      var t = Number(ler('oculto-em', sessionStorage) || 0);
      if (t && Date.now() - t > 5 * 60 * 1000) {
        try { sessionStorage.removeItem('desbloqueado'); } catch (e) {}
        bloquear();
      }
    });
  }

  window.Bloqueio = {
    ativo: function () { return !!ler(CHAVE); },
    disponivel: async function () {
      try { return !!(window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); } catch (e) { return false; }
    },
    ativar: async function (email) {
      var c = await navigator.credentials.create({ publicKey: {
        challenge: aleatorio(32),
        rp: { name: 'DocTrack' },
        user: { id: aleatorio(16), name: email || 'DocTrack', displayName: email || 'DocTrack' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
        timeout: 60000,
      } });
      localStorage.setItem(CHAVE, paraB64(c.rawId));
      cred = paraB64(c.rawId);
      try { sessionStorage.setItem('desbloqueado', '1'); } catch (e) {}
    },
    desativar: function () { try { localStorage.removeItem(CHAVE); } catch (e) {} cred = null; },
  };
})();
