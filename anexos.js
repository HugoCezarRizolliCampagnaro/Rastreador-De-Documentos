// Anexos do documento: várias fotos/PDFs (frente, verso, páginas), até 6.
// - Miniaturas com nome automático (Frente, Verso, Página 3...) que dá pra trocar tocando
// - Tocar na miniatura abre em tela cheia (com zoom e passar pro lado); PDF abre em outra aba
// - "Tirar foto" abre a câmera DENTRO do app (não troca de aplicativo, então a página não recarrega)
//   e dá pra tirar frente e verso seguidas; se o navegador não deixar, usa a câmera do celular
// - Fotos são reduzidas antes de enviar (pesam menos e gastam menos espaço)
// Uso (novo-documento.html):
//   Anexos.iniciar({ sb, aoMudar })            monta a área
//   await Anexos.carregar(docId, doc)          mostra os arquivos de um documento salvo
//   await Anexos.enviarNovos(userId)           sobe os arquivos novos (antes de salvar o documento)
//   await Anexos.gravar(docId, userId)         grava a lista e devolve o 1º arquivo { path, nome } ou null
//   await Anexos.imagensParaIA(3)              fotos em base64 pra leitura automática
(function () {
  var MAX = 6;
  var BUCKET = 'documentos-arquivos';
  var sb = null;
  var opcoes = {};
  var itens = [];      // { id?, path?, nome, mime, rotulo, url, file?, novo }
  var removidos = [];  // { id, path }
  var multiDisponivel = true; // false enquanto o SQL novo não foi rodado: aceita 1 arquivo, como antes

  var ICONES = {
    camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
    x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    left: '<polyline points="15 18 9 12 15 6"/>',
    right: '<polyline points="9 18 15 12 9 6"/>',
    check: '<polyline points="20 6 9 17 4 12"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>',
    refresh: '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',
  };
  function svg(nome, tam, extra) {
    return '<svg width="' + (tam || 18) + '" height="' + (tam || 18) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"' + (extra || '') + '>' + (ICONES[nome] || '') + '</svg>';
  }
  function esc(t) { var d = document.createElement('div'); d.textContent = t == null ? '' : String(t); return d.innerHTML; }
  function ehPdf(it) { return (it.mime || '').indexOf('pdf') !== -1 || /\.pdf$/i.test(it.nome || it.path || ''); }

  function rotuloPadrao(i, it) {
    if (it && ehPdf(it) && itens.length === 1) return 'PDF';
    if (i === 0) return 'Frente';
    if (i === 1) return 'Verso';
    return 'Página ' + (i + 1);
  }
  function rotulo(i) { return itens[i].rotulo || rotuloPadrao(i, itens[i]); }

  /* ---------- estilo ---------- */
  var css = [
    '.anexos-grade { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 10px; }',
    '.anexos-grade:empty { display: none; }',
    '.anexo { position: relative; display: flex; flex-direction: column; gap: 6px; min-width: 0; }',
    '.anexo-mini { position: relative; display: block; width: 100%; aspect-ratio: 3 / 4; padding: 0; border-radius: 10px; overflow: hidden; border: 1px solid var(--borda, #232833); background: var(--bg, #0B0E14); cursor: zoom-in; }',
    '.anexo-mini img { width: 100%; height: 100%; object-fit: cover; display: block; }',
    '.anexo-pdf { width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; color: var(--marca, #5B6EF5); font-size: 11px; font-weight: 700; padding: 8px; text-align: center; }',
    '.anexo-pdf span { color: var(--texto-muted, #8A93A3); font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }',
    '.anexo-remover { position: absolute; top: 5px; right: 5px; width: 26px; height: 26px; border-radius: 50%; border: none; background: rgba(5,8,15,.75); color: #FFFFFF; display: flex; align-items: center; justify-content: center; cursor: pointer; z-index: 2; }',
    '.anexo-rotulo { display: inline-flex; align-items: center; justify-content: center; gap: 4px; max-width: 100%; padding: 4px 8px; border-radius: 999px; border: 1px solid var(--borda, #232833); background: var(--superficie, #141821); color: var(--texto, #F1F2F4); font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; }',
    '.anexo-rotulo span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
    '.anexo-rotulo svg { flex-shrink: 0; color: var(--texto-muted, #8A93A3); }',
    '.anexo-novo-selo { position: absolute; left: 5px; top: 5px; padding: 2px 7px; border-radius: 999px; background: var(--marca, #5B6EF5); color: #FFFFFF; font-size: 10px; font-weight: 700; z-index: 2; }',
    '.anexos-botoes { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 12px; }',
    '.anexos-botoes button { white-space: nowrap; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 12px; border-radius: 10px; font: inherit; font-size: 14px; font-weight: 600; cursor: pointer; border: 1.5px solid var(--borda, #232833); background: var(--bg, #0B0E14); color: var(--texto, #F1F2F4); }',
    '.anexos-botoes button.principal { background: var(--marca, #5B6EF5); border-color: var(--marca, #5B6EF5); color: #FFFFFF; }',
    '.anexos-botoes button:disabled { opacity: .5; cursor: default; }',
    '.anexos-dica { font-size: 12px; color: var(--texto-muted, #8A93A3); margin: 8px 0 0; line-height: 1.45; }',
    /* visualizador */
    '.anx-ver { position: fixed; inset: 0; z-index: 1100; background: #000000; display: flex; flex-direction: column; }',
    '.anx-ver-topo { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 14px; color: #FFFFFF; font-size: 14px; font-weight: 600; }',
    '.anx-ver-topo button, .anx-ver-nav { width: 42px; height: 42px; border-radius: 50%; border: none; background: rgba(255,255,255,.12); color: #FFFFFF; display: flex; align-items: center; justify-content: center; cursor: pointer; }',
    '.anx-ver-palco { flex: 1; overflow: auto; display: flex; align-items: center; justify-content: center; touch-action: pan-x pan-y pinch-zoom; }',
    '.anx-ver-palco img { max-width: 100%; max-height: 100%; object-fit: contain; cursor: zoom-in; user-select: none; -webkit-user-drag: none; }',
    '.anx-ver-palco.zoom { align-items: flex-start; justify-content: flex-start; }',
    '.anx-ver-palco.zoom img { max-width: none; max-height: none; width: 220%; cursor: zoom-out; }',
    '.anx-ver-nav { position: absolute; top: 50%; transform: translateY(-50%); }',
    '.anx-ver-nav.esq { left: 10px; } .anx-ver-nav.dir { right: 10px; }',
    '.anx-ver-dica { text-align: center; color: rgba(255,255,255,.6); font-size: 12px; padding: 8px 14px calc(12px + env(safe-area-inset-bottom, 0px)); }',
    /* câmera */
    '.anx-cam { position: fixed; inset: 0; z-index: 1100; background: #000000; display: flex; flex-direction: column; color: #FFFFFF; }',
    '.anx-cam video { flex: 1; min-height: 0; width: 100%; object-fit: contain; background: #000000; }',
    '.anx-cam-topo { position: absolute; top: 0; left: 0; right: 0; display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; background: linear-gradient(rgba(0,0,0,.6), transparent); font-size: 14px; font-weight: 600; z-index: 2; }',
    '.anx-cam-topo button { width: 42px; height: 42px; border-radius: 50%; border: none; background: rgba(255,255,255,.15); color: #FFFFFF; display: flex; align-items: center; justify-content: center; cursor: pointer; }',
    '.anx-cam-guia { position: absolute; left: 50%; top: 46%; transform: translate(-50%, -50%); width: 80%; max-width: 520px; aspect-ratio: 1.45; border: 2px dashed rgba(255,255,255,.55); border-radius: 14px; pointer-events: none; }',
    '.anx-cam-baixo { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 12px; padding: 14px 18px calc(18px + env(safe-area-inset-bottom, 0px)); background: #000000; }',
    '.anx-cam-tiradas { display: flex; gap: 6px; min-width: 0; overflow: hidden; }',
    '.anx-cam-tiradas img { width: 40px; height: 52px; object-fit: cover; border-radius: 6px; border: 1px solid rgba(255,255,255,.4); }',
    '.anx-cam-disparo { width: 72px; height: 72px; border-radius: 50%; border: 4px solid #FFFFFF; background: rgba(255,255,255,.25); cursor: pointer; }',
    '.anx-cam-disparo:active { background: #FFFFFF; }',
    '.anx-cam-pronto { justify-self: end; padding: 11px 18px; border-radius: 999px; border: none; background: var(--marca, #5B6EF5); color: #FFFFFF; font: inherit; font-size: 14px; font-weight: 700; cursor: pointer; }',
    '.anx-cam-pronto:disabled { opacity: .4; }',
    '.anx-cam-dica { position: absolute; left: 0; right: 0; bottom: calc(120px + env(safe-area-inset-bottom, 0px)); text-align: center; font-size: 14px; font-weight: 600; text-shadow: 0 1px 4px rgba(0,0,0,.8); z-index: 2; }',
    '.anx-cam-flash { position: absolute; inset: 0; background: #FFFFFF; opacity: 0; pointer-events: none; transition: opacity .15s ease; }',
  ].join('\n');

  function prepararEstilo() {
    if (document.getElementById('anexos-estilo')) return;
    var st = document.createElement('style');
    st.id = 'anexos-estilo';
    st.textContent = css;
    document.head.appendChild(st);
  }

  /* ---------- montar ---------- */
  function iniciar(o) {
    opcoes = o || {};
    sb = opcoes.sb;
    prepararEstilo();
    var btnFoto = document.getElementById('btn-tirar-foto');
    var btnGaleria = document.getElementById('btn-galeria');
    btnFoto.innerHTML = svg('camera', 18) + ' Tirar foto';
    btnGaleria.innerHTML = svg('image', 18) + ' Galeria / PDF';
    btnFoto.addEventListener('click', abrirCamera);
    btnGaleria.addEventListener('click', function () {
      if (cheio()) return avisarCheio();
      marcarSaida();
      document.getElementById('arquivo').click();
    });
    document.getElementById('arquivo').addEventListener('change', function () {
      var arquivos = Array.prototype.slice.call(this.files || []);
      this.value = '';
      limparSaida();
      adicionarArquivos(arquivos);
    });
    var camNativa = document.getElementById('arquivo-camera');
    camNativa.addEventListener('change', function () {
      var arquivos = Array.prototype.slice.call(this.files || []);
      this.value = '';
      limparSaida();
      adicionarArquivos(arquivos);
    });
    ['arquivo', 'arquivo-camera'].forEach(function (id) {
      document.getElementById(id).addEventListener('cancel', limparSaida);
    });
    document.getElementById('anexos-grade').addEventListener('click', cliqueGrade);

    // o banco já tem a lista de arquivos? (senão aceita 1, como antes)
    // opcoes.umArquivo: só 1 arquivo, sem nome Frente/Verso (ex.: renovação feita pelo convidado)
    if (opcoes.umArquivo) multiDisponivel = false;
    else if (sb) {
      sb.from('documento_arquivos').select('id').limit(1).then(function (r) {
        multiDisponivel = !r.error;
        desenhar();
      });
    }
    desenhar();
  }

  function limite() { return multiDisponivel ? MAX : 1; }
  function cheio() { return itens.length >= limite(); }
  function avisarCheio() {
    var msg = multiDisponivel ? 'Cada documento pode ter até ' + MAX + ' arquivos. Remova um pra adicionar outro.' : 'Remova o arquivo atual pra escolher outro.';
    if (window.Dialogo) Dialogo.avisar(msg); else alert(msg);
  }

  // a página pode recarregar enquanto a galeria/câmera do celular está aberta: guarda a hora
  function marcarSaida() { try { sessionStorage.setItem('camera-aberta', String(Date.now())); } catch (e) {} if (opcoes.aoSair) opcoes.aoSair(); }
  function limparSaida() { try { sessionStorage.removeItem('camera-aberta'); } catch (e) {} }

  /* ---------- adicionar ---------- */
  function reduzir(arquivo, maximo, qualidade) {
    return new Promise(function (resolver, rejeitar) {
      var url = URL.createObjectURL(arquivo);
      var img = new Image();
      img.onload = function () {
        try {
          var escala = Math.min(1, maximo / Math.max(img.width, img.height));
          var c = document.createElement('canvas');
          c.width = Math.round(img.width * escala);
          c.height = Math.round(img.height * escala);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          URL.revokeObjectURL(url);
          c.toBlob(function (blob) {
            if (!blob || blob.size < 500) { rejeitar(new Error('memoria')); return; }
            resolver(blob);
          }, 'image/jpeg', qualidade);
        } catch (e) { URL.revokeObjectURL(url); rejeitar(new Error('memoria')); }
      };
      img.onerror = function () { URL.revokeObjectURL(url); rejeitar(new Error('memoria')); };
      img.src = url;
    });
  }

  function nomeSeguro(nome) { return String(nome || 'arquivo').replace(/[^a-zA-Z0-9.\-_]/g, '_').slice(-80); }

  async function adicionarArquivos(arquivos) {
    var problemas = [];
    for (var i = 0; i < arquivos.length; i++) {
      var a = arquivos[i];
      if (cheio()) { problemas.push('limite'); break; }
      var pdf = a.type === 'application/pdf' || /\.pdf$/i.test(a.name);
      if (!pdf && !(a.type || '').startsWith('image/')) { problemas.push('tipo'); continue; }
      if (pdf && a.size > 10 * 1024 * 1024) { problemas.push('pdf'); continue; }
      var file = a;
      if (!pdf) {
        try {
          var blob = await reduzir(a, 2000, 0.85);
          file = new File([blob], nomeSeguro(a.name).replace(/\.[a-z0-9]+$/i, '') + '.jpg', { type: 'image/jpeg' });
        } catch (e) { problemas.push('memoria'); continue; }
      }
      itens.push({ nome: file.name, mime: pdf ? 'application/pdf' : 'image/jpeg', rotulo: null, url: URL.createObjectURL(file), file: file, novo: true });
    }
    desenhar();
    avisarMudanca();
    if (problemas.length && window.Dialogo) {
      var p = problemas[0];
      Dialogo.avisar(
        p === 'limite' ? 'Cada documento pode ter até ' + limite() + (limite() === 1 ? ' arquivo' : ' arquivos') + '. Os outros ficaram de fora.'
        : p === 'pdf' ? 'Esse PDF passa de 10 MB. Escolha um arquivo menor.'
        : p === 'tipo' ? 'Só dá pra anexar fotos ou PDF.'
        : 'Não consegui abrir a foto. Isso costuma acontecer quando o celular está com pouco espaço ou memória. Feche outros apps e tente de novo.'
      );
    }
  }

  function avisarMudanca() { if (opcoes.aoMudar) opcoes.aoMudar(itens.slice()); }

  /* ---------- desenhar ---------- */
  function desenhar() {
    var grade = document.getElementById('anexos-grade');
    grade.innerHTML = itens.map(function (it, i) {
      var miolo = ehPdf(it)
        ? '<span class="anexo-pdf">' + svg('file', 28) + 'PDF<span>' + esc(it.nome || '') + '</span></span>'
        : '<img src="' + esc(it.url || '') + '" alt="' + esc(rotulo(i)) + '" loading="lazy">';
      return '<div class="anexo">' +
        '<button type="button" class="anexo-mini" data-ver="' + i + '" aria-label="Abrir ' + esc(rotulo(i)) + '">' + miolo + '</button>' +
        (it.novo ? '<span class="anexo-novo-selo">Novo</span>' : '') +
        '<button type="button" class="anexo-remover" data-remover="' + i + '" aria-label="Remover ' + esc(rotulo(i)) + '">' + svg('x', 14) + '</button>' +
        (multiDisponivel ? '<button type="button" class="anexo-rotulo" data-rotulo="' + i + '" title="Trocar nome"><span>' + esc(rotulo(i)) + '</span>' + svg('edit', 11) + '</button>' : '') +
        '</div>';
    }).join('');
    var dica = document.getElementById('anexos-dica');
    var lim = limite();
    if (!itens.length) dica.textContent = multiDisponivel ? 'Tire a foto da frente e, se tiver, do verso. Também dá pra mandar PDF. Até ' + MAX + ' arquivos.' : 'Tire uma foto ou escolha uma imagem ou PDF.';
    else if (itens.length >= lim) dica.textContent = lim === 1 ? 'Toque no X pra trocar o arquivo.' : 'Limite de ' + lim + ' arquivos atingido.';
    else if (itens.length === 1 && !ehPdf(itens[0])) dica.textContent = 'Tem verso? Tire mais uma foto. Toque no nome embaixo da foto pra trocar.';
    else dica.textContent = itens.length + ' de ' + lim + ' arquivos. Toque na imagem pra ver grande.';
    document.getElementById('btn-tirar-foto').disabled = itens.length >= lim;
    document.getElementById('btn-galeria').disabled = itens.length >= lim;
  }

  async function cliqueGrade(e) {
    var b = e.target.closest('[data-ver],[data-remover],[data-rotulo]');
    if (!b) return;
    if (b.dataset.remover != null) {
      var i = Number(b.dataset.remover);
      var it = itens[i];
      if (it.id) removidos.push({ id: it.id, path: it.path });
      if (it.novo && it.url) URL.revokeObjectURL(it.url);
      itens.splice(i, 1);
      desenhar();
      avisarMudanca();
    } else if (b.dataset.rotulo != null) {
      trocarRotulo(Number(b.dataset.rotulo));
    } else {
      abrirVisualizador(Number(b.dataset.ver));
    }
  }

  async function trocarRotulo(i) {
    if (!window.Dialogo) return;
    var pagina = 'Página ' + (i + 1);
    var opcoesR = ['Frente', 'Verso', pagina].map(function (t) { return { valor: t, texto: t + (rotulo(i) === t ? ' (atual)' : ''), principal: rotulo(i) === t }; });
    opcoesR.push({ valor: '__outro__', texto: 'Outro nome...' });
    var v = await Dialogo.escolher('Nome desta imagem', opcoesR);
    if (!v) return;
    if (v === '__outro__') {
      v = await Dialogo.pedir('Nome desta imagem', itens[i].rotulo || '', { placeholder: 'Ex.: Página 2, Contrato assinado', ok: 'Salvar' });
      if (v == null) return;
      v = v.trim().slice(0, 40);
    }
    itens[i].rotulo = v || null;
    itens[i].rotuloMudou = true;
    desenhar();
    avisarMudanca();
  }

  /* ---------- visualizador ---------- */
  function abrirVisualizador(inicio) {
    var it = itens[inicio];
    if (!it) return;
    if (ehPdf(it)) { if (it.url) window.open(it.url, '_blank', 'noopener'); return; }
    var fotos = itens.map(function (x, i) { return { it: x, i: i }; }).filter(function (x) { return !ehPdf(x.it); });
    var pos = fotos.findIndex(function (x) { return x.i === inicio; });
    var el = document.createElement('div');
    el.className = 'anx-ver';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.innerHTML = '<div class="anx-ver-topo"><span class="anx-ver-titulo"></span><button type="button" class="anx-ver-fechar" aria-label="Fechar">' + svg('x', 20) + '</button></div>' +
      '<div class="anx-ver-palco"><img alt=""></div>' +
      (fotos.length > 1 ? '<button type="button" class="anx-ver-nav esq" aria-label="Anterior">' + svg('left', 22) + '</button><button type="button" class="anx-ver-nav dir" aria-label="Próxima">' + svg('right', 22) + '</button>' : '') +
      '<div class="anx-ver-dica">Toque na imagem pra ampliar' + (fotos.length > 1 ? ' · arraste pro lado pra ver a próxima' : '') + '</div>';
    document.body.appendChild(el);
    var palco = el.querySelector('.anx-ver-palco');
    var img = palco.querySelector('img');
    function mostrar() {
      var f = fotos[pos];
      img.src = f.it.url;
      palco.classList.remove('zoom');
      el.querySelector('.anx-ver-titulo').textContent = rotulo(f.i) + (fotos.length > 1 ? '  ·  ' + (pos + 1) + ' de ' + fotos.length : '');
    }
    function ir(d) { if (fotos.length < 2) return; pos = (pos + d + fotos.length) % fotos.length; mostrar(); }
    function fechar() { document.removeEventListener('keydown', teclas, true); el.remove(); }
    function teclas(e) {
      if (e.key === 'Escape') { e.preventDefault(); fechar(); }
      else if (e.key === 'ArrowRight') ir(1);
      else if (e.key === 'ArrowLeft') ir(-1);
    }
    el.querySelector('.anx-ver-fechar').addEventListener('click', fechar);
    var esq = el.querySelector('.anx-ver-nav.esq'), dir = el.querySelector('.anx-ver-nav.dir');
    if (esq) esq.addEventListener('click', function () { ir(-1); });
    if (dir) dir.addEventListener('click', function () { ir(1); });
    img.addEventListener('click', function () { palco.classList.toggle('zoom'); });
    var x0 = null;
    palco.addEventListener('touchstart', function (e) { x0 = e.touches.length === 1 && !palco.classList.contains('zoom') ? e.touches[0].clientX : null; }, { passive: true });
    palco.addEventListener('touchend', function (e) {
      if (x0 == null) return;
      var dx = e.changedTouches[0].clientX - x0;
      if (Math.abs(dx) > 50) ir(dx < 0 ? 1 : -1);
      x0 = null;
    });
    document.addEventListener('keydown', teclas, true);
    mostrar();
  }

  /* ---------- câmera dentro do app ---------- */
  function cameraNativa() {
    marcarSaida();
    document.getElementById('arquivo-camera').click();
  }

  async function abrirCamera() {
    if (cheio()) return avisarCheio();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.isSecureContext) return cameraNativa();
    var stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } },
        audio: false,
      });
    } catch (e) {
      if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError') && window.Dialogo) {
        var usar = await Dialogo.confirmar('O navegador bloqueou a câmera dentro do app.\n\nPra liberar, toque no cadeado ao lado do endereço e permita a câmera. Ou use a câmera do celular agora.', { ok: 'Usar câmera do celular', cancelar: 'Fechar' });
        if (usar) cameraNativa();
        return;
      }
      return cameraNativa();
    }

    var el = document.createElement('div');
    el.className = 'anx-cam';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.innerHTML = '<div class="anx-cam-topo"><span class="anx-cam-titulo"></span><button type="button" class="anx-cam-fechar" aria-label="Fechar câmera">' + svg('x', 20) + '</button></div>' +
      '<video playsinline autoplay muted></video><div class="anx-cam-guia"></div><div class="anx-cam-dica"></div><div class="anx-cam-flash"></div>' +
      '<div class="anx-cam-baixo"><div class="anx-cam-tiradas"></div><button type="button" class="anx-cam-disparo" aria-label="Tirar foto"></button><button type="button" class="anx-cam-pronto" disabled>Pronto</button></div>';
    document.body.appendChild(el);
    document.body.style.overflow = 'hidden';
    var video = el.querySelector('video');
    video.srcObject = stream;
    var trilha = stream.getVideoTracks()[0];
    // foco automático contínuo, quando o celular deixa
    try { trilha.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(function () {}); } catch (e) {}
    // foto de verdade (resolução cheia da câmera, com foco), quando o navegador tem ImageCapture
    var capturador = null;
    try { if (window.ImageCapture) capturador = new ImageCapture(trilha); } catch (e) { capturador = null; }
    var tiradas = [];
    var ocupado = false;

    function atualizarTextos() {
      var proxima = itens.length + tiradas.length;
      el.querySelector('.anx-cam-titulo').textContent = rotuloPadrao(proxima);
      el.querySelector('.anx-cam-dica').textContent = tiradas.length === 0
        ? 'Encaixe o documento no quadro e toque no botão'
        : 'Foto ' + tiradas.length + ' ok! Tem verso? Vire o documento e tire de novo, ou toque em Pronto.';
      el.querySelector('.anx-cam-pronto').disabled = tiradas.length === 0;
      el.querySelector('.anx-cam-disparo').disabled = proxima >= limite();
      el.querySelector('.anx-cam-tiradas').innerHTML = tiradas.map(function (t) { return '<img src="' + t.url + '" alt="">'; }).join('');
    }

    function fechar(salvar) {
      stream.getTracks().forEach(function (t) { t.stop(); });
      document.body.style.overflow = '';
      el.remove();
      if (salvar) {
        tiradas.forEach(function (t) { itens.push({ nome: t.file.name, mime: 'image/jpeg', rotulo: null, url: t.url, file: t.file, novo: true }); });
        desenhar();
        avisarMudanca();
      } else {
        tiradas.forEach(function (t) { URL.revokeObjectURL(t.url); });
      }
    }

    el.querySelector('.anx-cam-disparo').addEventListener('click', function () {
      if (ocupado || !video.videoWidth || itens.length + tiradas.length >= limite()) return;
      ocupado = true;
      var flash = el.querySelector('.anx-cam-flash');
      flash.style.opacity = '0.8';
      setTimeout(function () { flash.style.opacity = '0'; }, 120);
      el.querySelector('.anx-cam-dica').textContent = 'Segure firme...';

      function quadroDoVideo() {
        return new Promise(function (resolver) {
          var w = video.videoWidth, h = video.videoHeight;
          var escala = Math.min(1, 2000 / Math.max(w, h));
          var c = document.createElement('canvas');
          c.width = Math.round(w * escala); c.height = Math.round(h * escala);
          c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
          c.toBlob(resolver, 'image/jpeg', 0.9);
        });
      }
      function guardar(blob) {
        ocupado = false;
        if (!blob) { atualizarTextos(); if (window.Dialogo) Dialogo.avisar('Não consegui tirar a foto. Tente de novo.'); return; }
        var file = new File([blob], 'foto-' + Date.now() + '.jpg', { type: 'image/jpeg' });
        tiradas.push({ file: file, url: URL.createObjectURL(file) });
        atualizarTextos();
        if (itens.length + tiradas.length >= limite()) fechar(true);
      }
      var foto = capturador
        ? capturador.takePhoto().then(function (b) { return reduzir(b, 2000, 0.9); }).catch(function () { return quadroDoVideo(); })
        : quadroDoVideo();
      foto.then(guardar, function () { guardar(null); });
    });
    el.querySelector('.anx-cam-pronto').addEventListener('click', function () { fechar(true); });
    el.querySelector('.anx-cam-fechar').addEventListener('click', function () { fechar(tiradas.length > 0); });
    atualizarTextos();
  }

  /* ---------- carregar um documento salvo ---------- */
  async function carregar(docId, doc) {
    itens = []; removidos = [];
    var linhas = [];
    if (multiDisponivel) {
      var r = await sb.from('documento_arquivos').select('id, path, nome, rotulo, mime, ordem').eq('documento_id', docId).order('ordem').order('criado_em');
      if (r.error) multiDisponivel = false; else linhas = r.data || [];
    }
    if (!linhas.length && doc && doc.arquivo_path) {
      linhas = [{ id: null, path: doc.arquivo_path, nome: doc.arquivo_nome, rotulo: null, mime: /\.pdf$/i.test(doc.arquivo_path) ? 'application/pdf' : 'image/jpeg' }];
    }
    if (linhas.length) {
      var urls = await sb.storage.from(BUCKET).createSignedUrls(linhas.map(function (l) { return l.path; }), 3600);
      var mapa = {};
      (urls.data || []).forEach(function (u) { if (u && u.path) mapa[u.path] = u.signedUrl; });
      itens = linhas.map(function (l) {
        return { id: l.id, path: l.path, nome: l.nome || l.path.split('/').pop(), mime: l.mime, rotulo: l.rotulo, url: mapa[l.path] || '', novo: false, semLinha: !l.id };
      });
    }
    desenhar();
    avisarMudanca();
  }

  /* ---------- salvar ---------- */
  async function enviarNovos(userId) {
    for (var i = 0; i < itens.length; i++) {
      var it = itens[i];
      if (!it.novo || it.path) continue;
      var caminho = userId + '/' + Date.now() + '-' + i + '-' + nomeSeguro(it.nome);
      var r = await sb.storage.from(BUCKET).upload(caminho, it.file, { contentType: it.mime });
      if (r.error) throw new Error('Não foi possível enviar ' + (ehPdf(it) ? 'o PDF' : 'a foto') + ' (' + rotulo(i) + '). Confira a internet e tente de novo.');
      it.path = caminho;
    }
  }

  async function gravar(docId, userId) {
    var primeiro = itens.length ? { path: itens[0].path, nome: itens[0].nome } : null;
    if (!multiDisponivel) return primeiro;

    // 1) tira os removidos
    var idsRemovidos = removidos.filter(function (r) { return r.id; }).map(function (r) { return r.id; });
    if (idsRemovidos.length) await sb.from('documento_arquivos').delete().in('id', idsRemovidos);

    // 2) grava os novos e a ordem/nome dos que já existiam
    for (var i = 0; i < itens.length; i++) {
      var it = itens[i];
      if (!it.id) {
        var ins = await sb.from('documento_arquivos').insert([{ documento_id: docId, user_id: userId, path: it.path, nome: it.nome, rotulo: it.rotulo, mime: it.mime, ordem: i }]).select('id').single();
        if (ins.error) throw new Error(/até 6/.test(ins.error.message || '') ? ins.error.message : 'Não foi possível salvar os arquivos. Tente de novo.');
        it.id = ins.data.id;
        it.novo = false;
      } else {
        await sb.from('documento_arquivos').update({ ordem: i, rotulo: it.rotulo }).eq('id', it.id);
      }
    }

    // 3) apaga do armazenamento o que não é mais usado por nenhum documento
    for (var j = 0; j < removidos.length; j++) {
      var p = removidos[j].path;
      if (!p) continue;
      var ainda = await sb.from('documento_arquivos').select('id', { count: 'exact', head: true }).eq('path', p);
      var noDoc = await sb.from('documentos').select('id', { count: 'exact', head: true }).eq('arquivo_path', p).neq('id', docId);
      if (!ainda.error && !noDoc.error && !ainda.count && !noDoc.count) await sb.storage.from(BUCKET).remove([p]);
    }
    removidos = [];
    return primeiro;
  }

  /* ---------- fotos pra IA ---------- */
  async function imagensParaIA(max) {
    var fotos = itens.filter(function (it) { return !ehPdf(it); }).slice(0, max || 3);
    var res = [];
    for (var i = 0; i < fotos.length; i++) {
      var it = fotos[i];
      var blob = it.file;
      if (!blob && it.url) {
        var resp = await fetch(it.url);
        blob = await resp.blob();
      }
      if (!blob) continue;
      var reduzida = await reduzir(blob, 1600, 0.85);
      res.push(await paraBase64(reduzida));
    }
    return res;
  }
  function pdfParaIA() {
    var pdf = itens.find(function (it) { return ehPdf(it); });
    return pdf || null;
  }
  async function arquivoBase64(it) {
    var blob = it.file;
    if (!blob && it.url) blob = await (await fetch(it.url)).blob();
    return paraBase64(blob);
  }
  function paraBase64(blob) {
    return new Promise(function (resolver, rejeitar) {
      var leitor = new FileReader();
      leitor.onload = function () { resolver(String(leitor.result).split(',')[1] || ''); };
      leitor.onerror = function () { rejeitar(new Error('memoria')); };
      leitor.readAsDataURL(blob);
    });
  }

  // Duplicar documento: copia a lista de arquivos (os arquivos em si são compartilhados entre as cópias)
  async function duplicar(cliente, origemId, novoId, userId) {
    var r = await cliente.from('documento_arquivos').select('path, nome, rotulo, mime, ordem').eq('documento_id', origemId).order('ordem');
    if (r.error || !r.data || !r.data.length) return;
    await cliente.from('documento_arquivos').delete().eq('documento_id', novoId); // a que o banco criou sozinho
    await cliente.from('documento_arquivos').insert(r.data.map(function (a) {
      return { documento_id: novoId, user_id: userId, path: a.path, nome: a.nome, rotulo: a.rotulo, mime: a.mime, ordem: a.ordem };
    }));
  }

  window.Anexos = {
    iniciar: iniciar, carregar: carregar, enviarNovos: enviarNovos, gravar: gravar,
    imagensParaIA: imagensParaIA, pdfParaIA: pdfParaIA, arquivoBase64: arquivoBase64, duplicar: duplicar,
    itens: function () { return itens.slice(); },
    limpar: function () { itens.forEach(function (it) { if (it.novo && it.url) URL.revokeObjectURL(it.url); }); itens = []; removidos = []; desenhar(); avisarMudanca(); },
    temNovos: function () { return itens.some(function (it) { return it.novo; }); },
  };
})();
