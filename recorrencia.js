// Documentos recorrentes (DAS, aluguel, mensalidade, exame anual...).
// O documento tem "repeticao" (mensal/trimestral/semestral/anual). Ao tocar em "Paguei"/"Renovei":
//   - o vencimento pula pro próximo período (e o "próximo pagamento", se tiver)
//   - registra no histórico de renovação
//   - se tem valor, lança em Gastos com a data de hoje
//   - desmarca o checklist pra começar de novo
// Os avisos por e-mail recomeçam sozinhos, porque eles são controlados pela data de vencimento.
(function () {
  var MESES = { mensal: 1, trimestral: 3, semestral: 6, anual: 12 };
  var ROTULOS = { mensal: 'Todo mês', trimestral: 'A cada 3 meses', semestral: 'A cada 6 meses', anual: 'Todo ano' };
  var CATEGORIA_GASTO = { pessoal: 'outros', veiculo: 'transporte', trabalho: 'outros', casa: 'moradia', outro: 'outros' };

  function hojeISO() {
    return new Date().toLocaleDateString('sv-SE'); // AAAA-MM-DD no fuso do aparelho
  }

  // soma meses mantendo o dia; se o mês não tem esse dia (ex.: 31), usa o último dia do mês
  function proximaData(iso, repeticao) {
    var meses = MESES[repeticao];
    if (!iso || !meses) return iso;
    var p = iso.split('-').map(Number);
    var ano = p[0], mes = p[1] - 1 + meses, dia = p[2];
    ano += Math.floor(mes / 12);
    mes = mes % 12;
    var ultimoDia = new Date(ano, mes + 1, 0).getDate();
    var d = Math.min(dia, ultimoDia);
    return ano + '-' + String(mes + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  }

  function dataBR(iso) {
    return iso ? new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR') : '';
  }

  function moeda(v) {
    return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function rotuloBotao(doc) {
    return doc && doc.custo_valor ? 'Paguei' : 'Renovei';
  }

  // pergunta, avança e devolve a nova data (ou null se cancelou / deu erro)
  async function marcar(sb, doc, userId) {
    if (!doc || !MESES[doc.repeticao]) return null;
    var nova = proximaData(doc.data_vencimento, doc.repeticao);
    var pago = !!doc.custo_valor;
    var texto = (pago ? 'Marcar ' + doc.nome + ' como pago?' : 'Marcar ' + doc.nome + ' como renovado?') +
      '\n\nO próximo vencimento passa pra ' + dataBR(nova) + '.' +
      (pago ? ' O valor de ' + moeda(doc.custo_valor) + ' entra em Gastos.' : '');
    if (!(await Dialogo.confirmar(texto, { ok: rotuloBotao(doc) }))) return null;

    var mudancas = { data_vencimento: nova };
    if (doc.proximo_pagamento_data) {
      mudancas.proximo_pagamento_data = proximaData(doc.proximo_pagamento_data, doc.repeticao);
      mudancas.proximo_pagamento_status = 'pendente';
    }
    var r = await sb.from('documentos').update(mudancas).eq('id', doc.id);
    if (r.error) {
      await Dialogo.avisar('Não foi possível atualizar agora. Tente de novo.');
      return null;
    }

    // o resto é complemento: se falhar, o vencimento já foi atualizado
    try {
      await sb.from('historico_documentos').insert([{
        documento_id: doc.id, user_id: userId,
        data_vencimento_anterior: doc.data_vencimento, data_vencimento_nova: nova,
      }]);
      if (pago) {
        await sb.from('gastos').insert([{
          user_id: userId, documento_id: doc.id, descricao: doc.nome,
          valor: doc.custo_valor, data_gasto: hojeISO(),
          categoria: CATEGORIA_GASTO[doc.categoria] || 'outros',
        }]);
      }
      await sb.from('checklist_items').update({ concluido: false }).eq('documento_id', doc.id);
    } catch (e) { console.error('Recorrência: complemento falhou', e); }

    avisoRapido((pago ? 'Pago! ' : 'Renovado! ') + 'Próximo vencimento: ' + dataBR(nova));
    return nova;
  }

  // aviso que some sozinho (canto de baixo)
  function avisoRapido(texto) {
    var el = document.getElementById('aviso-rapido-recorrencia');
    if (!el) {
      el = document.createElement('div');
      el.id = 'aviso-rapido-recorrencia';
      el.setAttribute('role', 'status');
      el.style.cssText = 'position:fixed;left:50%;bottom:24px;z-index:900;transform:translate(-50%,20px);opacity:0;' +
        'transition:transform .2s ease,opacity .2s ease;width:calc(100% - 32px);max-width:420px;padding:14px 16px;border-radius:12px;' +
        'background:#1E2330;color:#F1F2F4;border:1px solid #2E3546;box-shadow:0 12px 32px rgba(0,0,0,.45);font-size:14px;pointer-events:none;';
      if (window.matchMedia('(max-width: 959px)').matches) el.style.bottom = 'calc(82px + env(safe-area-inset-bottom, 0px))';
      document.body.appendChild(el);
    }
    el.textContent = '✓  ' + texto;
    requestAnimationFrame(function () { el.style.opacity = '1'; el.style.transform = 'translate(-50%,0)'; });
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.style.opacity = '0'; el.style.transform = 'translate(-50%,20px)'; }, 4000);
  }

  window.Recorrencia = {
    MESES: MESES, ROTULOS: ROTULOS,
    proximaData: proximaData, rotuloBotao: rotuloBotao, marcar: marcar, dataBR: dataBR,
    ICONE: '<path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
  };
})();
