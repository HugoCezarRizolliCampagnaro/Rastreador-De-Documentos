// Tour guiado do Início: destaca cada parte da tela com um balão explicando.
// Uso: Tour.iniciar()  — tour do Início (boas-vindas, ou index.html?tour=1 pelo Perfil)
//      Tour.iniciar({ passos: [...], chave: 'tour-documento-visto' }) — tour de outra tela
// Um alvo pode ser um seletor CSS ou uma função que devolve o elemento.
// Cada passo aponta pra uma lista de seletores; usa o primeiro que estiver visível
// (celular e computador têm elementos diferentes). Passo sem nada visível é pulado.
(function () {
  var PASSOS = [
    {
      alvos: ['.resumo-faixa'],
      titulo: 'Como estão seus documentos',
      texto: 'A porcentagem mostra quantos estão dentro da validade. Ao lado, quantos estão em dia, em atenção e urgentes.',
    },
    {
      alvos: ['.doc-card-wrap'],
      titulo: 'Seus documentos',
      texto: 'A cor do prazo mostra a urgência: verde em dia, amarelo em atenção, vermelho urgente ou vencido. Toque pra abrir e editar. No ⋯ tem Duplicar, Excluir e "Paguei" pros que repetem todo mês.',
    },
    {
      alvos: ['#filtros'],
      titulo: 'Categorias',
      texto: 'Filtre por Pessoal, Trabalho, Casa… Só aparecem as categorias que você já usa. Pra criar outra, escolha "+ Nova categoria" no cadastro do documento.',
    },
    {
      alvos: ['.barra-mais', '#fab-adicionar'],
      titulo: 'Cadastrar documento',
      texto: 'Toque no + pra cadastrar. Dá pra tirar foto ou enviar o PDF que o app lê e preenche os campos pra você.',
    },
    {
      alvos: ['.sidebar-nav', '.topo-acoes'], // computador: barra lateral; celular: botões do topo
      titulo: 'Atalhos',
      texto: 'Relatório pra imprimir ou salvar em PDF, Gastos pra acompanhar o que você paga e Pessoas pra cuidar dos documentos da família ou da equipe.',
      textoPor: {
        '.sidebar-nav': 'Pelo menu você chega em Pessoas (documentos da família ou da equipe), Gastos, Calendário e Assistente. O Relatório pra imprimir ou salvar em PDF fica no topo do Início.',
      },
    },
    {
      alvos: ['#botao-notif'],
      titulo: 'Avisos',
      texto: 'O pontinho vermelho aparece quando tem documento urgente. Você também recebe aviso por e-mail antes de vencer (dá pra ajustar em Perfil).',
    },
    {
      alvos: ['.barra-inferior a[href="assistente.html"]', '.sidebar-item[href="assistente.html"]'],
      titulo: 'Assistente',
      texto: 'Pergunte do seu jeito, tipo "o que vence esse mês?" ou "quais documentos da Maria estão vencidos?".',
    },
  ];

  var css = [
    '.tour-bloqueio { position: fixed; inset: 0; z-index: 1000; background: transparent; }',
    '.tour-foco { position: fixed; z-index: 1001; border-radius: 14px; pointer-events: none; box-shadow: 0 0 0 9999px rgba(5, 8, 15, 0.72), 0 0 0 2px var(--marca, #5B6EF5); transition: top .25s ease, left .25s ease, width .25s ease, height .25s ease; }',
    '.tour-balao { position: fixed; z-index: 1002; width: min(340px, calc(100vw - 24px)); background: var(--superficie, #141821); color: var(--texto, #F1F2F4); border: 1px solid var(--borda, #232833); border-radius: 14px; padding: 16px 16px 14px; box-shadow: 0 16px 40px rgba(0,0,0,.5); font-family: inherit; transition: top .25s ease, left .25s ease; }',
    '.tour-passo { font-size: 11.5px; font-weight: 700; color: var(--marca, #5B6EF5); letter-spacing: .3px; margin: 0 0 4px; }',
    '.tour-titulo { font-size: 16px; font-weight: 700; margin: 0 0 6px; }',
    '.tour-texto { font-size: 13.5px; line-height: 1.5; color: var(--texto-muted, #8A93A3); margin: 0; }',
    '.tour-botoes { display: flex; align-items: center; gap: 8px; margin-top: 14px; }',
    '.tour-botoes .tour-pular { margin-right: auto; background: none; border: none; color: var(--texto-muted, #8A93A3); font: inherit; font-size: 13px; cursor: pointer; padding: 6px 2px; }',
    '.tour-btn { font: inherit; font-size: 13.5px; font-weight: 600; padding: 9px 14px; border-radius: 9px; cursor: pointer; border: 1px solid transparent; }',
    '.tour-btn-sec { background: transparent; color: var(--texto, #F1F2F4); border-color: var(--borda, #232833); }',
    '.tour-btn-ok { background: var(--marca, #5B6EF5); color: #FFFFFF; }',
  ].join('\n');

  var estado = null; // { passos, i, els, aoFim }

  function visivel(el) {
    if (!el) return false;
    var r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    if (r.right <= 0 || r.left >= window.innerWidth) return false; // fora da tela (ex.: menu lateral escondido no celular)
    var st = getComputedStyle(el);
    return st.visibility !== 'hidden' && st.display !== 'none';
  }

  function acharAlvo(passo) {
    for (var i = 0; i < passo.alvos.length; i++) {
      var alvo = passo.alvos[i];
      var el = typeof alvo === 'function' ? alvo() : document.querySelector(alvo);
      if (visivel(el)) return { el: el, seletor: typeof alvo === 'string' ? alvo : '' };
    }
    return null;
  }

  function fixo(el) {
    for (var n = el; n && n !== document.body; n = n.parentElement) {
      if (getComputedStyle(n).position === 'fixed') return true;
    }
    return false;
  }

  function montar() {
    if (!document.getElementById('tour-estilo')) {
      var st = document.createElement('style');
      st.id = 'tour-estilo';
      st.textContent = css;
      document.head.appendChild(st);
    }
    var bloqueio = document.createElement('div');
    bloqueio.className = 'tour-bloqueio';
    var foco = document.createElement('div');
    foco.className = 'tour-foco';
    var balao = document.createElement('div');
    balao.className = 'tour-balao';
    balao.setAttribute('role', 'dialog');
    balao.setAttribute('aria-modal', 'true');
    balao.innerHTML =
      '<p class="tour-passo"></p><p class="tour-titulo"></p><p class="tour-texto"></p>' +
      '<div class="tour-botoes"><button type="button" class="tour-pular">Pular tour</button>' +
      '<button type="button" class="tour-btn tour-btn-sec tour-voltar">Voltar</button>' +
      '<button type="button" class="tour-btn tour-btn-ok tour-proximo">Próximo</button></div>';
    document.body.appendChild(bloqueio);
    document.body.appendChild(foco);
    document.body.appendChild(balao);
    balao.querySelector('.tour-pular').addEventListener('click', function () { terminar(); });
    balao.querySelector('.tour-voltar').addEventListener('click', function () { irPara(estado.i - 1); });
    balao.querySelector('.tour-proximo').addEventListener('click', function () {
      if (estado.i >= estado.passos.length - 1) terminar(); else irPara(estado.i + 1);
    });
    return { bloqueio: bloqueio, foco: foco, balao: balao };
  }

  function posicionar() {
    if (!estado) return;
    var passo = estado.passos[estado.i];
    var alvo = passo.el;
    var r = alvo.getBoundingClientRect();
    var folga = 6;
    var f = estado.els.foco;
    f.style.top = (r.top - folga) + 'px';
    f.style.left = (r.left - folga) + 'px';
    f.style.width = (r.width + folga * 2) + 'px';
    f.style.height = (r.height + folga * 2) + 'px';

    var b = estado.els.balao;
    var vw = window.innerWidth, vh = window.innerHeight;
    var bh = b.offsetHeight, bw = b.offsetWidth;
    var abaixo = r.bottom + folga + 12;
    var acima = r.top - folga - 12 - bh;
    var top, left;
    var aoLado = r.right + folga + 16;
    if (r.height > vh * 0.5 && aoLado + bw <= vw - 12) {
      // alvo alto (ex.: menu lateral do computador): balão ao lado
      top = Math.min(Math.max(12, r.top), vh - bh - 12);
      left = aoLado;
    } else {
      if (abaixo + bh <= vh - 12) top = abaixo;
      else if (acima >= 12) top = acima;
      else top = Math.max(12, vh - bh - 12); // alvo muito grande: balão no fim da tela
      left = Math.min(Math.max(12, r.left + r.width / 2 - bw / 2), vw - bw - 12);
    }
    b.style.top = top + 'px';
    b.style.left = left + 'px';
  }

  function irPara(i) {
    if (!estado || i < 0 || i >= estado.passos.length) return;
    estado.i = i;
    var passo = estado.passos[i];
    var b = estado.els.balao;
    b.querySelector('.tour-passo').textContent = (i + 1) + ' de ' + estado.passos.length;
    b.querySelector('.tour-titulo').textContent = passo.titulo;
    b.querySelector('.tour-texto').textContent = passo.texto;
    b.querySelector('.tour-voltar').hidden = i === 0;
    b.querySelector('.tour-proximo').textContent = i === estado.passos.length - 1 ? 'Concluir' : 'Próximo';
    // traz o alvo pra tela (os fixos, como a barra de baixo, já estão visíveis)
    if (!fixo(passo.el)) passo.el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setTimeout(posicionar, fixo(passo.el) ? 0 : 350);
    posicionar();
    b.querySelector('.tour-proximo').focus();
  }

  function teclas(e) {
    if (!estado) return;
    if (e.key === 'Escape') { e.preventDefault(); terminar(); }
    else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); estado.els.balao.querySelector('.tour-proximo').click(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); irPara(estado.i - 1); }
  }

  function terminar() {
    if (!estado) return;
    try { localStorage.setItem(estado.chave, 'true'); } catch (e) {}
    window.removeEventListener('resize', posicionar);
    window.removeEventListener('scroll', posicionar, true);
    document.removeEventListener('keydown', teclas, true);
    estado.els.bloqueio.remove();
    estado.els.foco.remove();
    estado.els.balao.remove();
    var aoFim = estado.aoFim;
    estado = null;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (aoFim) aoFim();
  }

  function iniciar(opcoes) {
    if (estado) return;
    // compatível com o jeito antigo: Tour.iniciar(funcaoAoFim)
    if (typeof opcoes === 'function') opcoes = { aoFim: opcoes };
    opcoes = opcoes || {};
    var lista = opcoes.passos || PASSOS;
    var aoFim = opcoes.aoFim;
    var passos = [];
    lista.forEach(function (p) {
      var achado = acharAlvo(p);
      if (achado) passos.push({ titulo: p.titulo, texto: (p.textoPor && p.textoPor[achado.seletor]) || p.texto, el: achado.el });
    });
    if (passos.length === 0) return;
    estado = { passos: passos, i: 0, els: montar(), aoFim: aoFim, chave: opcoes.chave || 'tour-visto' };
    window.addEventListener('resize', posicionar);
    window.addEventListener('scroll', posicionar, true);
    document.addEventListener('keydown', teclas, true);
    irPara(0);
  }

  window.Tour = { iniciar: iniciar };
})();
