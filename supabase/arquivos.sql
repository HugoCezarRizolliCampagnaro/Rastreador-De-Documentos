-- ============================================================
-- Vários arquivos por documento (frente, verso, páginas) — até 6
--
-- documentos.arquivo_path continua existindo e guarda o 1º arquivo,
-- então o que já usa ele (cartões, convite, e-mails) continua funcionando.
-- Pode rodar mais de uma vez sem problema.
-- ============================================================

create table if not exists public.documento_arquivos (
  id uuid primary key default gen_random_uuid(),
  documento_id uuid not null references public.documentos(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  path text not null,
  nome text,
  rotulo text,            -- "Frente", "Verso", "Página 3"... (vazio = automático pela ordem)
  mime text,
  ordem integer not null default 0,
  criado_em timestamptz not null default now()
);

create index if not exists documento_arquivos_documento_idx on public.documento_arquivos (documento_id, ordem);
create index if not exists documento_arquivos_user_idx on public.documento_arquivos (user_id);

alter table public.documento_arquivos enable row level security;

drop policy if exists "dono ve arquivos do documento" on public.documento_arquivos;
create policy "dono ve arquivos do documento" on public.documento_arquivos
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "dono adiciona arquivos do documento" on public.documento_arquivos;
create policy "dono adiciona arquivos do documento" on public.documento_arquivos
  for insert to authenticated with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.documentos d where d.id = documento_id and d.user_id = (select auth.uid()))
  );

drop policy if exists "dono atualiza arquivos do documento" on public.documento_arquivos;
create policy "dono atualiza arquivos do documento" on public.documento_arquivos
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.documentos d where d.id = documento_id and d.user_id = (select auth.uid()))
  );

drop policy if exists "dono exclui arquivos do documento" on public.documento_arquivos;
create policy "dono exclui arquivos do documento" on public.documento_arquivos
  for delete to authenticated using ((select auth.uid()) = user_id);

-- no máximo 6 arquivos por documento
create or replace function public.limitar_arquivos_documento()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  perform pg_advisory_xact_lock(hashtext('arquivos_doc_' || new.documento_id::text));
  if (select count(*) from public.documento_arquivos where documento_id = new.documento_id) >= 6 then
    raise exception 'Cada documento pode ter até 6 arquivos.';
  end if;
  return new;
end;
$$;

drop trigger if exists limitar_arquivos_documento on public.documento_arquivos;
create trigger limitar_arquivos_documento
  before insert on public.documento_arquivos
  for each row execute function public.limitar_arquivos_documento();

-- Quando o arquivo_path do documento muda pra um arquivo que não está na lista
-- (ex.: convidado anexou o documento renovado), a lista passa a ser só esse arquivo.
-- A tela de cadastro atualiza a lista antes, então ali isso não faz nada.
create or replace function public.sincronizar_arquivo_principal()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if new.arquivo_path is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.arquivo_path is not distinct from old.arquivo_path then
    return new;
  end if;
  if exists (select 1 from public.documento_arquivos a where a.documento_id = new.id and a.path = new.arquivo_path) then
    return new;
  end if;
  delete from public.documento_arquivos where documento_id = new.id;
  insert into public.documento_arquivos (documento_id, user_id, path, nome, mime, ordem)
  values (new.id, new.user_id, new.arquivo_path, new.arquivo_nome,
          case when lower(new.arquivo_path) like '%.pdf' then 'application/pdf' else 'image/jpeg' end, 0);
  return new;
end;
$$;

drop trigger if exists sincronizar_arquivo_principal on public.documentos;
create trigger sincronizar_arquivo_principal
  after insert or update of arquivo_path on public.documentos
  for each row execute function public.sincronizar_arquivo_principal();

-- arquivos que já existem passam pra lista nova
insert into public.documento_arquivos (documento_id, user_id, path, nome, mime, ordem)
select d.id, d.user_id, d.arquivo_path, d.arquivo_nome,
       case when lower(d.arquivo_path) like '%.pdf' then 'application/pdf' else 'image/jpeg' end, 0
from public.documentos d
where d.arquivo_path is not null
  and not exists (select 1 from public.documento_arquivos a where a.documento_id = d.id);

-- Convite: o convidado vê todos os arquivos dos documentos compartilhados com ele
create or replace function public.arquivos_compartilhados(p_documento uuid)
returns table (path text, nome text, rotulo text, mime text, ordem integer)
language sql
stable
security definer
set search_path to ''
as $$
  select a.path, a.nome, a.rotulo, a.mime, a.ordem
  from public.documento_arquivos a
  join public.documentos d on d.id = a.documento_id
  join public.pessoas p on p.id = d.pessoa_id and p.user_id = d.user_id
  where a.documento_id = p_documento
    and p.convidado_user_id = auth.uid()
    and public.plano_ativo(p.user_id) in ('familia', 'profissional')
  order by a.ordem, a.criado_em;
$$;

create or replace function public.pode_ler_arquivo_compartilhado(p_path text)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select exists (
    select 1 from public.documentos d
    join public.pessoas p on p.id = d.pessoa_id and p.user_id = d.user_id
    where p.convidado_user_id = auth.uid()
      and public.plano_ativo(p.user_id) in ('familia', 'profissional')
      and (d.arquivo_path = p_path
           or exists (select 1 from public.documento_arquivos a where a.documento_id = d.id and a.path = p_path))
  );
$$;

revoke execute on function public.limitar_arquivos_documento() from public, anon, authenticated;
revoke execute on function public.sincronizar_arquivo_principal() from public, anon, authenticated;
revoke execute on function public.arquivos_compartilhados(uuid) from public, anon;
grant execute on function public.arquivos_compartilhados(uuid) to authenticated;
