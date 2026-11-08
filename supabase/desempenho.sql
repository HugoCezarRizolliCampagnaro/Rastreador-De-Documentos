-- DocTrack — desempenho do banco (02/11/2026)
-- Não muda nenhuma regra de acesso: só deixa as consultas rápidas quando tiver muita gente.
-- 1) Índices que faltavam (a tela inicial busca os documentos de cada usuário por data)
-- 2) Regras de acesso (RLS) com auth.uid() calculado 1 vez por consulta, não 1 vez por linha.
--    Mesma regra de antes, só reescrita no formato recomendado pelo Supabase.

begin;

-- 1) índices
create index if not exists documentos_user_venc_idx      on public.documentos (user_id, data_vencimento);
create index if not exists documentos_pessoa_id_idx      on public.documentos (pessoa_id);
create index if not exists pessoas_user_id_idx           on public.pessoas (user_id);
create index if not exists gastos_user_id_idx            on public.gastos (user_id);
create index if not exists gastos_documento_id_idx       on public.gastos (documento_id);
create index if not exists historico_documento_id_idx    on public.historico_documentos (documento_id);
create index if not exists checklist_documento_id_idx    on public.checklist_items (documento_id);
create index if not exists push_inscricoes_user_id_idx   on public.push_inscricoes (user_id);
create index if not exists avisos_ia_user_id_idx         on public.avisos_ia (user_id);

-- 2) regras de acesso: auth.uid() -> (select auth.uid())
alter policy "usuarios veem seus proprios documentos"      on public.documentos using ((select auth.uid()) = user_id);
alter policy "usuarios inserem seus proprios documentos"   on public.documentos with check ((select auth.uid()) = user_id);
alter policy "usuarios atualizam seus proprios documentos" on public.documentos using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
alter policy "usuarios excluem seus proprios documentos"   on public.documentos using ((select auth.uid()) = user_id);

alter policy "usuarios veem seu proprio checklist"       on public.checklist_items using ((select auth.uid()) = user_id);
alter policy "usuarios inserem seu proprio checklist"    on public.checklist_items with check ((select auth.uid()) = user_id);
alter policy "usuarios atualizam seu proprio checklist"  on public.checklist_items using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
alter policy "usuarios excluem seu proprio checklist"    on public.checklist_items using ((select auth.uid()) = user_id);

alter policy "usuarios veem seus proprios gastos"     on public.gastos using ((select auth.uid()) = user_id);
alter policy "usuarios inserem seus proprios gastos"  on public.gastos with check ((select auth.uid()) = user_id);
alter policy "usuarios excluem seus proprios gastos"  on public.gastos using ((select auth.uid()) = user_id);

alter policy "usuarios veem seu proprio historico"     on public.historico_documentos using ((select auth.uid()) = user_id);
alter policy "usuarios inserem seu proprio historico"  on public.historico_documentos with check ((select auth.uid()) = user_id);

alter policy "usuarios veem suas proprias pessoas"     on public.pessoas using ((select auth.uid()) = user_id);
alter policy "usuarios inserem suas proprias pessoas"  on public.pessoas with check ((select auth.uid()) = user_id);

alter policy "ler proprio perfil" on public.perfis using ((select auth.uid()) = user_id);

alter policy "ver proprias inscricoes"       on public.push_inscricoes using ((select auth.uid()) = user_id);
alter policy "criar proprias inscricoes"     on public.push_inscricoes with check ((select auth.uid()) = user_id);
alter policy "atualizar proprias inscricoes" on public.push_inscricoes using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
alter policy "apagar proprias inscricoes"    on public.push_inscricoes using ((select auth.uid()) = user_id);

commit;

-- QR code por funcionário (plano Profissional) — aplicado em 08/11/2026
alter table public.pessoas add column if not exists qr_token uuid;
create unique index if not exists pessoas_qr_token_idx on public.pessoas (qr_token) where qr_token is not null;
create or replace function public.status_qr(t uuid) returns json language sql stable security definer set search_path = public as $$
  select json_build_object('nome', pe.nome, 'cargo', pe.cargo, 'documentos', coalesce((
      select json_agg(json_build_object('nome', d.nome, 'tipo', d.tipo, 'vencimento', d.data_vencimento) order by d.data_vencimento)
      from documentos d where d.pessoa_id = pe.id and d.user_id = pe.user_id and d.data_vencimento is not null), '[]'::json))
  from pessoas pe join perfis pf on pf.user_id = pe.user_id
  where pe.qr_token = t and pf.plano = 'profissional' and pf.plano_valido_ate >= (now() at time zone 'America/Sao_Paulo')::date
$$;
revoke all on function public.status_qr(uuid) from public;
grant execute on function public.status_qr(uuid) to anon, authenticated;
