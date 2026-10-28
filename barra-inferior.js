// Barra de navegação inferior — só no celular (< 960px). No computador continua a sidebar.
// Também esconde o botão ☰ (menu) em todas as telas: no celular a barra substitui, no computador a sidebar já fica fixa.
(function () {
  var ICONES = {
    home: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
    plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    messageCircle: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
    user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'
  };

  function svg(nome, tam) {
    return '<svg width="' + tam + '" height="' + tam + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONES[nome] + '</svg>';
  }

  var css = [
    '#botao-menu { display: none !important; }',
    '.barra-inferior { display: none; }',
    '@media (max-width: 959px) {',
    '  body { padding-bottom: calc(66px + env(safe-area-inset-bottom, 0px)); }',
    '  .barra-inferior {',
    '    position: fixed; left: 0; right: 0; bottom: 0; z-index: 30;',
    '    display: grid; grid-template-columns: repeat(5, 1fr); align-items: center;',
    '    height: calc(66px + env(safe-area-inset-bottom, 0px));',
    '    padding: 0 6px env(safe-area-inset-bottom, 0px);',
    '    background: var(--superficie); border-top: 1px solid var(--borda);',
    '    font-family: inherit;',
    '  }',
    '  .barra-item {',
    '    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;',
    '    height: 100%; text-decoration: none; color: var(--texto-muted);',
    '    font-size: 10.5px; font-weight: 600; -webkit-tap-highlight-color: transparent;',
    '  }',
    '  .barra-item.ativo { color: var(--marca); }',
    '  .barra-mais { display: flex; align-items: center; justify-content: center; height: 100%; text-decoration: none; -webkit-tap-highlight-color: transparent; }',
    '  .barra-mais span {',
    '    width: 50px; height: 50px; border-radius: 16px; background: var(--marca); color: #FFFFFF;',
    '    display: flex; align-items: center; justify-content: center;',
    '    box-shadow: 0 6px 18px rgba(91, 110, 245, 0.45); transition: transform 0.15s ease;',
    '  }',
    '  .barra-mais:active span { transform: scale(0.94); }',
    '  .barra-mais.ativo span { box-shadow: 0 0 0 3px var(--superficie), 0 0 0 5px var(--marca); }',
    /* o + da barra substitui o botão flutuante de cadastrar documento */
    '  a.fab[href="novo-documento.html"] { display: none !important; }',
    /* outros botões flutuantes (ex.: novo gasto) sobem pra ficar acima da barra */
    '  .fab { bottom: calc(82px + env(safe-area-inset-bottom, 0px)) !important; }',
    /* tela do assistente ocupa a tela toda: termina em cima da barra */
    '  body.tela-assistente .app-shell { bottom: calc(66px + env(safe-area-inset-bottom, 0px)) !important; }',
    '}',
    '@media print { .barra-inferior { display: none !important; } body { padding-bottom: 0 !important; } }'
  ].join('\n');

  var estilo = document.createElement('style');
  estilo.textContent = css;
  document.head.appendChild(estilo);

  var pagina = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  if (pagina === 'planos.html') pagina = 'perfil.html';

  var itens = [
    { href: 'index.html', icone: 'home', label: 'Início' },
    { href: 'calendario.html', icone: 'calendar', label: 'Calendário' },
    { href: 'novo-documento.html', mais: true, label: 'Novo documento' },
    { href: 'assistente.html', icone: 'messageCircle', label: 'Assistente' },
    { href: 'perfil.html', icone: 'user', label: 'Perfil' }
  ];

  function montar() {
    if (document.querySelector('.barra-inferior')) return;
    if (pagina === 'assistente.html') document.body.classList.add('tela-assistente');
    var nav = document.createElement('nav');
    nav.className = 'barra-inferior';
    nav.setAttribute('aria-label', 'Navegação principal');
    nav.innerHTML = itens.map(function (item) {
      var ativo = item.href === pagina ? ' ativo' : '';
      var atual = ativo ? ' aria-current="page"' : '';
      if (item.mais) {
        return '<a href="' + item.href + '" class="barra-mais' + ativo + '" aria-label="' + item.label + '"' + atual + '><span>' + svg('plus', 24) + '</span></a>';
      }
      return '<a href="' + item.href + '" class="barra-item' + ativo + '"' + atual + '>' + svg(item.icone, 22) + item.label + '</a>';
    }).join('');
    document.body.appendChild(nav);
  }

  if (document.body) montar();
  else document.addEventListener('DOMContentLoaded', montar);
})();
