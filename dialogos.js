// Janelas no estilo do app (substituem alert/confirm/prompt do navegador).
// Uso (sempre com await, dentro de função async):
//   await Dialogo.avisar('Mensagem');
//   if (!(await Dialogo.confirmar('Excluir?', { ok: 'Excluir', perigo: true }))) return;
//   const nome = await Dialogo.pedir('Nome da pessoa:', 'valor inicial', { placeholder: 'Ex.: Maria' });
//   (pedir devolve null se a pessoa cancelar, igual ao prompt)
//   const v = await Dialogo.escolher('Pergunta', [{ valor: 'a', texto: 'Opção A', perigo: true }, { valor: 'b', texto: 'Opção B' }]);
//   (escolher devolve o valor do botão tocado, ou null se cancelar)
(function () {
  var css = [
    '.dlg-fundo { position: fixed; inset: 0; z-index: 1000; background: rgba(5, 8, 15, 0.62); display: flex; align-items: center; justify-content: center; padding: 20px; animation: dlgFundo .15s ease; }',
    '.dlg-caixa { width: 100%; max-width: 400px; background: var(--superficie, #141821); color: var(--texto, #F1F2F4); border: 1px solid var(--borda, #232833); border-radius: 16px; padding: 22px 20px 18px; box-shadow: 0 20px 50px rgba(0,0,0,.45); font-family: inherit; animation: dlgCaixa .18s ease; }',
    '.dlg-titulo { font-size: 16px; font-weight: 700; margin: 0 0 6px; }',
    '.dlg-texto { font-size: 14px; line-height: 1.5; color: var(--texto-muted, #8A93A3); margin: 0; white-space: pre-line; overflow-wrap: anywhere; }',
    '.dlg-titulo + .dlg-texto { margin-top: 0; }',
    '.dlg-campo { width: 100%; margin-top: 14px; padding: 11px 13px; font: inherit; font-size: 15px; color: var(--texto, #F1F2F4); background: var(--bg, #0B0E14); border: 1.5px solid var(--borda, #232833); border-radius: 10px; outline: none; box-sizing: border-box; }',
    '.dlg-campo:focus { border-color: var(--marca, #5B6EF5); }',
    '.dlg-botoes { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }',
    '.dlg-btn { font: inherit; font-size: 14px; font-weight: 600; padding: 10px 18px; border-radius: 10px; cursor: pointer; border: 1px solid transparent; }',
    '.dlg-btn-sec { background: transparent; color: var(--texto, #F1F2F4); border-color: var(--borda, #232833); }',
    '.dlg-btn-sec:hover { background: var(--bg, #0B0E14); }',
    '.dlg-btn-ok { background: var(--marca, #5B6EF5); color: #FFFFFF; }',
    '.dlg-btn-ok:hover { filter: brightness(1.08); }',
    '.dlg-btn-perigo { background: var(--status-vermelho, #F2555C); color: #FFFFFF; }',
    '.dlg-botoes.dlg-coluna { flex-direction: column; }',
    '.dlg-botoes.dlg-coluna .dlg-btn { width: 100%; padding: 12px; }',
    '@keyframes dlgFundo { from { opacity: 0; } to { opacity: 1; } }',
    '@keyframes dlgCaixa { from { opacity: 0; transform: translateY(8px) scale(.98); } to { opacity: 1; transform: none; } }',
    '@media (max-width: 480px) { .dlg-botoes { flex-direction: column-reverse; } .dlg-btn { width: 100%; padding: 12px; } }'
  ].join('\n');

  var estiloPronto = false;
  function prepararEstilo() {
    if (estiloPronto) return;
    var el = document.createElement('style');
    el.textContent = css;
    document.head.appendChild(el);
    estiloPronto = true;
  }

  // divide "Pergunta?\n\nDetalhe" em título + texto quando a mensagem é curta na primeira linha
  function separar(mensagem, opcoes) {
    var msg = String(mensagem == null ? '' : mensagem);
    if (opcoes && opcoes.titulo) return { titulo: opcoes.titulo, texto: msg };
    var partes = msg.split(/\n\n/);
    if (partes.length > 1 && partes[0].length <= 90) return { titulo: partes[0], texto: partes.slice(1).join('\n\n') };
    if (msg.length <= 70 && msg.indexOf('\n') === -1) return { titulo: msg, texto: '' };
    return { titulo: '', texto: msg };
  }

  function abrir(tipo, mensagem, valorInicial, opcoes) {
    opcoes = opcoes || {};
    prepararEstilo();
    return new Promise(function (resolver) {
      var focoAnterior = document.activeElement;
      var partes = separar(mensagem, opcoes);

      var fundo = document.createElement('div');
      fundo.className = 'dlg-fundo';
      var caixa = document.createElement('div');
      caixa.className = 'dlg-caixa';
      caixa.setAttribute('role', tipo === 'avisar' ? 'alertdialog' : 'dialog');
      caixa.setAttribute('aria-modal', 'true');

      if (partes.titulo) {
        var t = document.createElement('p');
        t.className = 'dlg-titulo';
        t.textContent = partes.titulo;
        caixa.appendChild(t);
      }
      if (partes.texto) {
        var p = document.createElement('p');
        p.className = 'dlg-texto';
        p.textContent = partes.texto;
        caixa.appendChild(p);
      }

      var campo = null;
      if (tipo === 'pedir') {
        campo = document.createElement('input');
        campo.className = 'dlg-campo';
        campo.type = opcoes.tipo || 'text';
        campo.value = valorInicial == null ? '' : String(valorInicial);
        if (opcoes.placeholder) campo.placeholder = opcoes.placeholder;
        campo.setAttribute('autocomplete', 'off');
        if (opcoes.tipo === 'email') campo.setAttribute('inputmode', 'email');
        caixa.appendChild(campo);
      }

      var botoes = document.createElement('div');
      botoes.className = 'dlg-botoes';
      var btnCancelar = null;
      var escolhas = [];
      if (tipo === 'escolher') {
        botoes.classList.add('dlg-coluna');
        (opcoes.botoes || []).forEach(function (b) {
          var el = document.createElement('button');
          el.type = 'button';
          el.className = 'dlg-btn ' + (b.perigo ? 'dlg-btn-perigo' : b.principal ? 'dlg-btn-ok' : 'dlg-btn-sec');
          el.textContent = b.texto;
          el.addEventListener('click', function () { fechar(b.valor); });
          botoes.appendChild(el);
          escolhas.push(el);
        });
      }
      if (tipo !== 'avisar') {
        btnCancelar = document.createElement('button');
        btnCancelar.type = 'button';
        btnCancelar.className = 'dlg-btn dlg-btn-sec';
        btnCancelar.textContent = opcoes.cancelar || 'Cancelar';
        botoes.appendChild(btnCancelar);
      }
      if (tipo === 'escolher') botoes.appendChild(btnCancelar); // Cancelar por último, embaixo
      var btnOk = document.createElement('button');
      btnOk.type = 'button';
      if (tipo === 'escolher') btnOk.hidden = true;
      btnOk.className = 'dlg-btn ' + (opcoes.perigo ? 'dlg-btn-perigo' : 'dlg-btn-ok');
      btnOk.textContent = opcoes.ok || (tipo === 'avisar' ? 'Entendi' : tipo === 'pedir' ? 'Salvar' : 'Confirmar');
      if (tipo !== 'escolher') botoes.appendChild(btnOk);
      caixa.appendChild(botoes);

      fundo.appendChild(caixa);
      document.body.appendChild(fundo);

      function fechar(resultado) {
        document.removeEventListener('keydown', teclas, true);
        fundo.remove();
        if (focoAnterior && focoAnterior.focus) { try { focoAnterior.focus(); } catch (e) {} }
        resolver(resultado);
      }
      function confirmar() {
        if (tipo === 'pedir') fechar(campo.value);
        else if (tipo === 'confirmar') fechar(true);
        else fechar(undefined);
      }
      function cancelar() {
        if (tipo === 'pedir' || tipo === 'escolher') fechar(null);
        else if (tipo === 'confirmar') fechar(false);
        else fechar(undefined);
      }
      function teclas(e) {
        if (e.key === 'Escape') { e.preventDefault(); cancelar(); }
        else if (e.key === 'Enter' && tipo !== 'escolher' && (tipo !== 'confirmar' || document.activeElement !== btnCancelar)) { e.preventDefault(); confirmar(); }
      }

      btnOk.addEventListener('click', confirmar);
      if (btnCancelar) btnCancelar.addEventListener('click', cancelar);
      fundo.addEventListener('click', function (e) { if (e.target === fundo) cancelar(); });
      document.addEventListener('keydown', teclas, true);

      setTimeout(function () {
        if (campo) { campo.focus(); campo.select(); }
        else if (tipo === 'escolher') btnCancelar.focus(); // escolha perigosa nunca vem focada
        else btnOk.focus();
      }, 30);
    });
  }

  window.Dialogo = {
    avisar: function (mensagem, opcoes) { return abrir('avisar', mensagem, null, opcoes); },
    confirmar: function (mensagem, opcoes) { return abrir('confirmar', mensagem, null, opcoes); },
    pedir: function (mensagem, valorInicial, opcoes) { return abrir('pedir', mensagem, valorInicial, opcoes); },
    escolher: function (mensagem, botoes, opcoes) { return abrir('escolher', mensagem, null, Object.assign({}, opcoes || {}, { botoes: botoes })); }
  };
})();
