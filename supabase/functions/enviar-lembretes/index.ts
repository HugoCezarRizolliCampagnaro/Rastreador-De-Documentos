// DocTrack — lembretes de vencimento por email
// Chamada 1x por dia pelo pg_cron. Busca documentos que entraram numa faixa de
// aviso (coluna avisos_dias de cada documento), manda 1 email por usuário pelo
// Gmail (SMTP porta 465) e registra em lembretes_enviados pra não repetir.
//
// Modos (campo "modo" no corpo JSON):
//   (vazio)          envio real
//   "simular"        só conta o que seria enviado, sem enviar nem registrar
//   "verificar_smtp" testa login no Gmail, sem enviar nada
//   "email_exemplo"  manda um email de exemplo para a própria conta do DocTrack

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import postgres from 'npm:postgres@3.4.5'
import nodemailer from 'npm:nodemailer@6.9.16'

const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { prepare: false, max: 1 })

const APP_URL = 'https://rastreador-de-documentos.vercel.app/'
const REMETENTE = Deno.env.get('GMAIL_USER') ?? 'doctrack.suporte@gmail.com'

type Lembrete = {
  id: string
  user_id: string
  email: string
  nome: string
  tipo: string | null
  cliente: string | null
  pessoa: string | null
  vencimento: string // YYYY-MM-DD
  vencimento_br: string // DD/MM/YYYY
  dias: number
  faixa: number
}

// Documentos que vencem hoje ou no futuro, cuja faixa atual de aviso
// (menor valor de avisos_dias que ainda cobre os dias restantes) ainda não foi enviada.
const CANDIDATOS = `
  select
    doc.id::text as id,
    doc.user_id::text as user_id,
    u.email,
    doc.nome,
    doc.tipo,
    doc.cliente,
    p.nome as pessoa,
    to_char(doc.data_vencimento, 'YYYY-MM-DD') as vencimento,
    to_char(doc.data_vencimento, 'DD/MM/YYYY') as vencimento_br,
    (doc.data_vencimento - h.d)::int as dias,
    f.faixa
  from public.documentos doc
  cross join (select (now() at time zone 'America/Sao_Paulo')::date as d) h
  cross join lateral (
    -- faixas negativas = avisos depois de vencer (1, 3 e 7 dias)
    select min(a) as faixa
    from unnest(coalesce(doc.avisos_dias, '{}') || array[-7, -3, -1]) as a
    where a >= (doc.data_vencimento - h.d)
  ) f
  join auth.users u on u.id = doc.user_id
  left join public.pessoas p on p.id = doc.pessoa_id
  left join public.preferencias pr on pr.user_id = doc.user_id
  where doc.data_vencimento >= h.d - 7
    and f.faixa is not null
    and coalesce(pr.email_lembretes, true)
    and u.email is not null
    and u.email_confirmed_at is not null
    and not exists (
      select 1 from public.lembretes_enviados le
      where le.documento_id = doc.id
        and le.data_vencimento = doc.data_vencimento
        and le.dias_aviso = f.faixa
    )
`

// Reserva os lembretes antes de enviar (atômico): se duas execuções rodarem
// juntas, só uma consegue reservar cada aviso.
const RESERVAR = `
  with c as (${CANDIDATOS}),
  r as (
    insert into public.lembretes_enviados (documento_id, user_id, dias_aviso, data_vencimento)
    select id::uuid, user_id::uuid, faixa, vencimento::date from c
    on conflict do nothing
    returning documento_id::text as id, dias_aviso as faixa
  )
  select c.* from c join r on r.id = c.id and r.faixa = c.faixa
`

// Assinaturas cujo período pago (ou teste grátis) termina em 5, 1 ou 0 dias e que ainda
// não receberam esse aviso. Reserva antes de enviar, igual aos lembretes de documento.
const RESERVAR_MENSALIDADE = `
  with h as (select (now() at time zone 'America/Sao_Paulo')::date as d),
  c as (
    select
      pf.user_id,
      u.email,
      pf.plano_valido_ate,
      to_char(pf.plano_valido_ate, 'DD/MM/YYYY') as valido_br,
      (pf.plano_valido_ate - h.d)::int as dias,
      (select min(a) from unnest(array[5, 1, 0]) as a where a >= (pf.plano_valido_ate - h.d)) as faixa,
      not exists (select 1 from public.pagamentos pg where pg.user_id = pf.user_id and pg.status = 'PAID') as em_teste
    from public.perfis pf
    cross join h
    join auth.users u on u.id = pf.user_id
    where pf.assinatura_ativa
      and pf.plano <> 'gratis'
      and pf.plano_valido_ate between h.d and h.d + 5
      and u.email is not null
  ),
  r as (
    insert into public.avisos_assinatura (user_id, valido_ate, dias)
    select user_id, plano_valido_ate, faixa from c where faixa is not null
    on conflict do nothing
    returning user_id, dias
  )
  select c.user_id::text as user_id, c.email, c.valido_br, c.dias, c.faixa, c.em_teste,
         to_char(c.plano_valido_ate, 'YYYY-MM-DD') as valido_ate
  from c join r on r.user_id = c.user_id and r.dias = c.faixa
`

type AvisoMensalidade = {
  user_id: string
  email: string
  valido_br: string
  valido_ate: string
  dias: number
  faixa: number
  em_teste: boolean
}

function emailMensalidade(a: AvisoMensalidade) {
  const quando = a.dias === 0 ? 'hoje' : a.dias === 1 ? 'amanhã' : `em ${a.dias} dias`
  const assunto = a.em_teste
    ? `Seu teste grátis do DocTrack termina ${quando}`
    : `Sua mensalidade do DocTrack vence ${quando}`
  const intro = a.em_teste
    ? `Seu teste do Premium vai até ${a.valido_br}. Pra continuar com documentos ilimitados e todos os recursos, pague R$ 9,90 com Pix ou cartão direto no app.`
    : `Seu Premium vale até ${a.valido_br}. Pra continuar, pague o próximo mês (R$ 9,90) com Pix ou cartão direto no app. Leva menos de um minuto.`
  const link = APP_URL + 'planos.html'
  const html = `
  <div style="background:#f4f5fb;padding:32px 16px;font-family:Arial,Helvetica,sans-serif;">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:16px;padding:32px;">
      <p style="margin:0 0 6px;font-size:12px;letter-spacing:1px;font-weight:bold;color:#3D4FE0;">DOCTRACK</p>
      <h1 style="margin:0 0 8px;font-size:22px;line-height:1.3;color:#14162b;">${esc(assunto)}</h1>
      <p style="margin:0 0 24px;font-size:15px;line-height:1.5;color:#4a4d68;">${esc(intro)}</p>
      <a href="${link}" style="display:inline-block;background:#3D4FE0;color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px;padding:14px 28px;border-radius:12px;">Pagar agora</a>
      <p style="margin:24px 0 0;font-size:12px;line-height:1.5;color:#7b7e96;">Não tem cobrança automática. Se não pagar, sua conta volta pro plano Grátis e nenhum documento é apagado.</p>
    </div>
  </div>`
  const texto = `${assunto}\n\n${intro}\n\nPagar agora: ${link}`
  return { assunto, html, texto }
}

function resposta(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function iguais(a: string, b: string) {
  const ea = new TextEncoder().encode(a)
  const eb = new TextEncoder().encode(b)
  if (ea.length !== eb.length) return false
  let diff = 0
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i]
  return diff === 0
}

function esc(s: unknown) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
}

function textoDias(d: number) {
  if (d === -1) return 'venceu ontem'
  if (d < 0) return `venceu há ${-d} dias`
  if (d === 0) return 'vence hoje'
  if (d === 1) return 'vence amanhã'
  return `vence em ${d} dias`
}

function maiuscula(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function cor(d: number) {
  if (d < 7) return '#E5484D'
  if (d < 30) return '#D9930D'
  return '#30A46C'
}

function detalhes(l: Lembrete) {
  return [l.tipo, l.pessoa, l.cliente].filter(Boolean).join(' · ')
}

function montarEmail(itens: Lembrete[]) {
  const ordenados = [...itens].sort((a, b) => a.dias - b.dias)
  const unico = ordenados.length === 1
  const primeiro = ordenados[0]

  const vencidos = ordenados.filter((l) => l.dias < 0).length
  const assunto = unico
    ? `${primeiro.nome} ${textoDias(primeiro.dias)}`
    : vencidos > 0
      ? `${ordenados.length} documentos precisam de atenção`
      : `${ordenados.length} documentos vencendo em breve`

  const titulo = unico ? `${primeiro.nome} ${textoDias(primeiro.dias)}` : 'Documentos que precisam de atenção'
  const intro = unico
    ? primeiro.dias < 0
      ? 'Renove o quanto antes e atualize a nova data no app.'
      : 'Organize a renovação com antecedência para não ficar com o documento vencido.'
    : vencidos > 0
      ? `Você tem ${ordenados.length} documentos vencidos ou perto de vencer.`
      : `Você tem ${ordenados.length} documentos perto do vencimento.`

  const cartoes = ordenados
    .map((l) => {
      const info = detalhes(l)
      return `
      <div style="border:1px solid #e6e8f2;border-left:4px solid ${cor(l.dias)};border-radius:12px;padding:14px 16px;margin:0 0 12px;">
        <p style="margin:0;font-size:15px;font-weight:bold;color:#14162b;">${esc(l.nome)}</p>
        ${info ? `<p style="margin:4px 0 0;font-size:13px;color:#7b7e96;">${esc(info)}</p>` : ''}
        <p style="margin:8px 0 0;font-size:14px;font-weight:bold;color:${cor(l.dias)};">${maiuscula(textoDias(l.dias))} · ${l.vencimento_br}</p>
      </div>`
    })
    .join('')

  const html = `
  <div style="background:#f4f5fb;padding:32px 16px;font-family:Arial,Helvetica,sans-serif;">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:16px;padding:32px;">
      <p style="margin:0 0 6px;font-size:12px;letter-spacing:1px;font-weight:bold;color:#3D4FE0;">DOCTRACK</p>
      <h1 style="margin:0 0 8px;font-size:22px;line-height:1.3;color:#14162b;">${esc(titulo)}</h1>
      <p style="margin:0 0 24px;font-size:15px;line-height:1.5;color:#4a4d68;">${esc(intro)}</p>
      ${cartoes}
      <a href="${APP_URL}" style="display:inline-block;margin-top:12px;background:#3D4FE0;color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px;padding:14px 28px;border-radius:12px;">Abrir o DocTrack</a>
      <p style="margin:24px 0 0;font-size:12px;line-height:1.5;color:#7b7e96;">Você recebe este aviso porque ativou lembretes para esses documentos. Os dias de aviso de cada documento podem ser ajustados no app, e você pode desligar estes e-mails em Minha conta.</p>
    </div>
  </div>`

  const texto = [
    titulo,
    '',
    intro,
    '',
    ...ordenados.map((l) => {
      const info = detalhes(l)
      return `- ${l.nome}${info ? ` (${info})` : ''}: ${textoDias(l.dias)}, em ${l.vencimento_br}`
    }),
    '',
    `Abrir o DocTrack: ${APP_URL}`,
  ].join('\n')

  return { assunto, html, texto }
}

function criarTransporte(senha: string) {
  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465, // 25 e 587 são bloqueadas nas Edge Functions
    secure: true,
    auth: { user: REMETENTE, pass: senha },
  })
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return resposta({ erro: 'use POST' }, 405)

  // Só o agendamento do banco conhece essa chave (guardada no Vault)
  const [segredo] = await sql`
    select decrypted_secret as valor from vault.decrypted_secrets
    where name = 'lembretes_cron_key' limit 1
  `
  const chave = req.headers.get('x-cron-key') ?? ''
  if (!segredo?.valor || !iguais(chave, segredo.valor)) {
    return resposta({ erro: 'nao autorizado' }, 401)
  }

  let corpo: { modo?: string } = {}
  try {
    corpo = await req.json()
  } catch {
    // corpo vazio = envio real
  }
  const modo = corpo?.modo ?? 'enviar'

  if (modo === 'simular') {
    const pendentes = (await sql.unsafe(CANDIDATOS)) as unknown as Lembrete[]
    return resposta({
      modo,
      lembretes: pendentes.length,
      usuarios: new Set(pendentes.map((p) => p.user_id)).size,
    })
  }

  const senha = Deno.env.get('GMAIL_APP_PASSWORD')
  if (!senha) {
    return resposta({ erro: 'GMAIL_APP_PASSWORD nao configurada' }, 500)
  }
  const transporte = criarTransporte(senha)

  if (modo === 'verificar_smtp') {
    try {
      await transporte.verify()
      return resposta({ modo, smtp: 'ok' })
    } catch (e) {
      console.error('verificar_smtp', e)
      return resposta({ modo, smtp: 'erro', detalhe: e instanceof Error ? e.message : String(e) }, 500)
    }
  }

  if (modo === 'email_exemplo') {
    const hoje = new Date()
    const em = (d: number) => {
      const x = new Date(hoje.getTime() + d * 86400000)
      return x.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
    }
    const exemplo: Lembrete[] = [
      { id: '1', user_id: '0', email: REMETENTE, nome: 'ASO — Exemplo', tipo: 'ASO', cliente: 'Empresa Exemplo', pessoa: 'João', vencimento: '', vencimento_br: em(7), dias: 7, faixa: 7 },
      { id: '2', user_id: '0', email: REMETENTE, nome: 'Alvará de funcionamento', tipo: 'Alvará', cliente: null, pessoa: null, vencimento: '', vencimento_br: em(30), dias: 30, faixa: 30 },
    ]
    const { assunto, html, texto } = montarEmail(exemplo)
    try {
      await transporte.sendMail({ from: `"DocTrack" <${REMETENTE}>`, to: REMETENTE, subject: `[Exemplo] ${assunto}`, html, text: texto })
      return resposta({ modo, enviado: true })
    } catch (e) {
      console.error('email_exemplo', e)
      return resposta({ modo, enviado: false, detalhe: e instanceof Error ? e.message : String(e) }, 500)
    }
  }

  // Envio real — 1) avisos de mensalidade
  const avisos = (await sql.unsafe(RESERVAR_MENSALIDADE)) as unknown as AvisoMensalidade[]
  let mensalidades = 0
  for (const a of avisos) {
    const { assunto, html, texto } = emailMensalidade(a)
    try {
      await transporte.sendMail({ from: `"DocTrack" <${REMETENTE}>`, to: a.email, subject: assunto, html, text: texto })
      mensalidades += 1
    } catch (e) {
      console.error('falha ao enviar aviso de mensalidade', e instanceof Error ? e.message : e)
      await sql`
        delete from public.avisos_assinatura
        where user_id = ${a.user_id}::uuid and valido_ate = ${a.valido_ate}::date and dias = ${a.faixa}
      `
    }
  }

  // 2) lembretes de documentos
  const reservados = (await sql.unsafe(RESERVAR)) as unknown as Lembrete[]
  if (reservados.length === 0) return resposta({ modo, emails: 0, lembretes: 0, mensalidades })

  const porUsuario = new Map<string, Lembrete[]>()
  for (const l of reservados) {
    const lista = porUsuario.get(l.user_id) ?? []
    lista.push(l)
    porUsuario.set(l.user_id, lista)
  }

  let emails = 0
  let falhas = 0
  for (const itens of porUsuario.values()) {
    const { assunto, html, texto } = montarEmail(itens)
    try {
      await transporte.sendMail({ from: `"DocTrack" <${REMETENTE}>`, to: itens[0].email, subject: assunto, html, text: texto })
      emails += 1
    } catch (e) {
      falhas += 1
      console.error('falha ao enviar lembrete', e instanceof Error ? e.message : e)
      // Libera a reserva para tentar de novo na próxima execução
      for (const l of itens) {
        await sql`
          delete from public.lembretes_enviados
          where documento_id = ${l.id}::uuid
            and dias_aviso = ${l.faixa}
            and data_vencimento = ${l.vencimento}::date
        `
      }
    }
  }

  console.log('lembretes', { emails, falhas, lembretes: reservados.length, mensalidades })
  return resposta({ modo, emails, falhas, lembretes: reservados.length, mensalidades })
})
