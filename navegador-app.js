// navegador-app.js
//
// Quando o site é aberto DENTRO do Instagram ou do Facebook (navegador do próprio app),
// mostra uma faixa no topo pedindo pra abrir no navegador de verdade. Lá dentro o login
// com Google é bloqueado, não dá pra instalar o app nem ativar notificações.
// No Chrome, Safari etc. não aparece nada.
//   Android: botão "Abrir no Chrome" (abre o mesmo endereço no Chrome).
//   iPhone: só explica, porque o iPhone não deixa forçar a abertura.

(function () {
  var ua = navigator.userAgent || '';
  var dentroDoApp = /Instagram|FBAN|FBAV|FB_IAB|FBIOS/i.test(ua);
  if (!dentroDoApp) return;

  var android = /Android/i.test(ua);
  // sem o "#..." do fim: o link do Chrome usa o # pra outra coisa
  var url = window.location.origin + window.location.pathname + window.location.search;

  function montar() {
    if (document.getElementById('faixa-navegador-app')) return;

    var faixa = document.createElement('div');
    faixa.id = 'faixa-navegador-app';
    faixa.setAttribute('role', 'alert');
    faixa.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:9999',
      'display:flex', 'align-items:center', 'gap:12px',
      'padding:12px 16px', 'background:var(--marca, #5B6EF5)', 'color:#fff',
      'font-family:inherit', 'font-size:13.5px', 'line-height:1.4',
      'box-shadow:0 4px 16px rgba(0,0,0,.25)',
    ].join(';');

    var texto = document.createElement('span');
    texto.style.cssText = 'flex:1;min-width:0;';
    faixa.appendChild(texto);

    if (android) {
      texto.innerHTML = '<strong>Abra no Chrome</strong> pra entrar com Google e receber os avisos.';
      var botao = document.createElement('a');
      botao.textContent = 'Abrir no Chrome';
      var semProtocolo = url.replace(/^https?:\/\//, '');
      botao.href = 'intent://' + semProtocolo + '#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=' + encodeURIComponent(url) + ';end';
      botao.style.cssText = 'flex-shrink:0;background:#fff;color:var(--marca, #5B6EF5);font-weight:700;text-decoration:none;padding:9px 14px;border-radius:10px;font-size:13px;white-space:nowrap;';
      faixa.appendChild(botao);
    } else {
      texto.innerHTML = 'Pra usar tudo, toque nos <strong>⋯</strong> no canto da tela e escolha <strong>Abrir no navegador</strong>.';
    }

    document.body.appendChild(faixa);

    // empurra a página pra baixo pra faixa não cobrir o conteúdo
    var original = parseFloat(getComputedStyle(document.body).paddingTop) || 0;
    function ajustar() { document.body.style.paddingTop = (original + faixa.offsetHeight) + 'px'; }
    ajustar();
    window.addEventListener('resize', ajustar);
  }

  if (document.body) montar();
  else document.addEventListener('DOMContentLoaded', montar);
})();
