// DocTrack — agenda (.ics) com os vencimentos, pra assinar no Google Agenda / Apple Calendário.
// GET /functions/v1/agenda?t=TOKEN  (o token fica em preferencias.agenda_token; trocar o token desliga o link antigo)

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import postgres from 'npm:postgres@3.4.5'

const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { prepare: false, max: 1 })
const APP_URL = 'https://rastreador-de-documentos.vercel.app/'

const TIPOS: Record<string, string> = {
  aso: 'ASO', nr: 'NR', alvara: 'Alvará', contrato: 'Contrato', certificacao: 'Certificação',
  cnh: 'CNH', passaporte: 'Passaporte', certidao: 'Certidão', certificado_digital: 'Certificado digital', licenca_sanitaria: 'Licença sanitária',
  conta: 'Conta / boleto', imposto: 'Imposto / taxa', outro: 'Outro',
}

function texto(s: unknown) {
  return String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
}

// linhas do .ics têm no máximo 75 bytes; o resto continua na linha de baixo começando com espaço
function dobrar(linha: string) {
  const bytes = new TextEncoder().encode(linha)
  if (bytes.length <= 75) return linha
  const partes: string[] = []
  let atual = ''
  for (const ch of linha) {
    if (new TextEncoder().encode(atual + ch).length > (partes.length ? 74 : 75)) { partes.push(atual); atual = ch } else atual += ch
  }
  partes.push(atual)
  return partes.join('\r\n ')
}

function dataIcs(iso: string, maisDias = 0) {
  const p = iso.split('-').map(Number)
  return new Date(Date.UTC(p[0], p[1] - 1, p[2] + maisDias)).toISOString().slice(0, 10).replace(/-/g, '')
}

Deno.serve(async (req) => {
  const token = new URL(req.url).searchParams.get('t') ?? ''
  if (!/^[0-9a-f-]{36}$/i.test(token)) return new Response('Link inválido', { status: 404 })

  const docs = await sql`
    select d.id::text as id, d.nome, d.tipo, to_char(d.data_vencimento, 'YYYY-MM-DD') as venc, p.nome as pessoa
    from public.preferencias pr
    join public.documentos d on d.user_id = pr.user_id
    left join public.pessoas p on p.id = d.pessoa_id and p.user_id = d.user_id
    where pr.agenda_token = ${token}::uuid
      and d.data_vencimento >= (now() at time zone 'America/Sao_Paulo')::date - 60
    order by d.data_vencimento
    limit 1000
  `
  if (!docs.length) {
    const existe = await sql`select 1 from public.preferencias where agenda_token = ${token}::uuid`
    if (!existe.length) return new Response('Link inválido', { status: 404 })
  }

  const agora = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z'
  const linhas = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//DocTrack//Vencimentos//PT-BR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:DocTrack — vencimentos', 'X-WR-TIMEZONE:America/Sao_Paulo',
    'REFRESH-INTERVAL;VALUE=DURATION:PT12H', 'X-PUBLISHED-TTL:PT12H',
  ]
  for (const d of docs) {
    const titulo = `${d.nome}${d.pessoa ? ` (${d.pessoa})` : ''} vence`
    const tipo = d.tipo ? (TIPOS[d.tipo] ?? d.tipo) : ''
    linhas.push(
      'BEGIN:VEVENT',
      `UID:${d.id}-${d.venc}@doctrack`,
      `DTSTAMP:${agora}`,
      `DTSTART;VALUE=DATE:${dataIcs(d.venc)}`,
      `DTEND;VALUE=DATE:${dataIcs(d.venc, 1)}`,
      `SUMMARY:${texto(titulo)}`,
      `DESCRIPTION:${texto((tipo ? tipo + ' · ' : '') + 'Abrir no DocTrack: ' + APP_URL + 'novo-documento.html?id=' + d.id)}`,
      'TRANSP:TRANSPARENT',
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${texto(titulo)}`, 'TRIGGER:-P7D', 'END:VALARM',
      'END:VEVENT',
    )
  }
  linhas.push('END:VCALENDAR')

  return new Response(linhas.map(dobrar).join('\r\n') + '\r\n', {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="doctrack.ics"',
      'Cache-Control': 'private, max-age=900',
    },
  })
})
