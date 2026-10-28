-- ============================================================
-- Convite por e-mail: a pessoa cadastrada ganha acesso próprio
-- (planos Família e Profissional)
--
-- Níveis de acesso (escolhidos pelo dono, por pessoa):
--   ver        -> vê os documentos dela e baixa os arquivos
--   atualizar  -> + atualiza a data e anexa o arquivo novo quando renova
--   gerenciar  -> + cadastra documentos novos dela e edita os dados
-- Excluir fica só com o dono.
--
-- O convidado nunca lê a tabela documentos direto: tudo passa pelas
-- funções abaixo, que conferem o acesso. As telas que já existem
-- continuam vendo só os documentos do próprio usuário.
-- Pode rodar mais de uma vez sem problema.
-- ============================================================

-- 1) Colunas novas em pessoas
alter table public.pessoas add column if not exists convite_token text;
alter table public.pessoas add column if not exists convite_criado_em timestamptz;
alter table public.pessoas add column if not exists convidado_user_id uuid references auth.users(id) on delete set null;
alter table public.pessoas add column if not exists convite_aceito_em timestamptz;
alter table public.pessoas add column if not exists permissao text not null default 'atualizar';

do $$ begin
  alter table public.pessoas add constraint pessoas_permissao_check check (permissao in ('ver', 'atualizar', 'gerenciar'));
exception when duplicate_object then null; end $$;

create unique index if not exists pessoas_convite_token_idx on public.pessoas (convite_token) where convite_token is not null;
create index if not exists pessoas_convidado_idx on public.pessoas (convidado_user_id) where convidado_user_id is not null;

-- 2) O dono não pode colocar um convidado "na mão" (só aceitando o convite).
--    Ele pode tirar o acesso (voltar pra vazio) quando quiser.
create or replace function public.proteger_convidado()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  if coalesce(current_setting('doctrack.aceitando_convite', true), '') = 'sim' then
    return new;
  end if;
  if new.convidado_user_id is not null
     and (tg_op = 'INSERT' or new.convidado_user_id is distinct from old.convidado_user_id) then
    raise exception 'O acesso só é liberado quando a pessoa aceita o convite.';
  end if;
  if new.convidado_user_id is null then
    new.convite_aceito_em := null;
  end if;
  return new;
end;
$$;

drop trigger if exists proteger_convidado on public.pessoas;
create trigger proteger_convidado
  before insert or update on public.pessoas
  for each row execute function public.proteger_convidado();

-- 3) Acesso do usuário logado a uma pessoa: devolve o nível ou null
--    (null também quando o plano do dono não é Família/Profissional)
create or replace function public.acesso_pessoa(p_pessoa uuid)
returns text
language sql
stable
security definer
set search_path to ''
as $$
  select p.permissao
  from public.pessoas p
  where p.id = p_pessoa
    and p.convidado_user_id = auth.uid()
    and public.plano_ativo(p.user_id) in ('familia', 'profissional');
$$;

-- nome que o convidado vê do dono: nome da empresa > nome > e-mail
create or replace function public.nome_do_dono(p_user uuid)
returns text
language sql
stable
security definer
set search_path to ''
as $$
  select coalesce(
    nullif(trim((select pr.nome_empresa from public.preferencias pr where pr.user_id = p_user)), ''),
    nullif(trim((select u.raw_user_meta_data->>'full_name' from auth.users u where u.id = p_user)), ''),
    (select u.email from auth.users u where u.id = p_user)
  );
$$;

-- 4) Dono: gera (ou renova) o convite e devolve o código do link
create or replace function public.criar_convite(p_pessoa uuid, p_permissao text default 'atualizar')
returns text
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_token text;
begin
  if p_permissao not in ('ver', 'atualizar', 'gerenciar') then
    raise exception 'Nível de acesso inválido.';
  end if;
  if not exists (select 1 from public.pessoas where id = p_pessoa and user_id = auth.uid()) then
    raise exception 'Pessoa não encontrada.';
  end if;
  if public.plano_ativo(auth.uid()) not in ('familia', 'profissional') then
    raise exception 'Convidar pessoas é um recurso dos planos Família e Profissional.';
  end if;
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  update public.pessoas
     set convite_token = v_token, convite_criado_em = now(), permissao = p_permissao
   where id = p_pessoa and user_id = auth.uid();
  return v_token;
end;
$$;

-- 5) Página do convite: mostra quem convidou antes de entrar (funciona sem login)
create or replace function public.ver_convite(p_token text)
returns table (dono_nome text, pessoa_nome text, permissao text, valido boolean)
language sql
stable
security definer
set search_path to ''
as $$
  select public.nome_do_dono(p.user_id), p.nome, p.permissao,
         (p.convite_criado_em > now() - interval '14 days'
           and public.plano_ativo(p.user_id) in ('familia', 'profissional'))
  from public.pessoas p
  where p.convite_token = p_token and length(p_token) >= 32;
$$;

-- 6) Convidado: aceita o convite
create or replace function public.aceitar_convite(p_token text)
returns table (pessoa_id uuid, dono_nome text, pessoa_nome text, permissao text)
language plpgsql
security definer
set search_path to ''
as $$
declare
  v public.pessoas%rowtype;
  v_email text;
begin
  if auth.uid() is null then
    raise exception 'Entre na sua conta para aceitar o convite.';
  end if;
  select * into v from public.pessoas where convite_token = p_token and length(p_token) >= 32 for update;
  if not found then
    raise exception 'Convite não encontrado. Ele pode já ter sido usado. Peça um link novo.';
  end if;
  if v.convite_criado_em <= now() - interval '14 days' then
    raise exception 'Esse convite expirou. Peça um link novo.';
  end if;
  if v.user_id = auth.uid() then
    raise exception 'Esse convite é seu. Envie o link para a pessoa abrir na conta dela.';
  end if;
  if public.plano_ativo(v.user_id) not in ('familia', 'profissional') then
    raise exception 'O plano de quem convidou não permite compartilhar agora.';
  end if;

  select u.email into v_email from auth.users u where u.id = auth.uid();

  perform set_config('doctrack.aceitando_convite', 'sim', true);
  update public.pessoas p
     set convidado_user_id = auth.uid(),
         convite_aceito_em = now(),
         convite_token = null,
         email = coalesce(nullif(p.email, ''), v_email),
         avisar_email = case when nullif(p.email, '') is null then true else p.avisar_email end
   where p.id = v.id;
  perform set_config('doctrack.aceitando_convite', '', true);

  return query select v.id, public.nome_do_dono(v.user_id), v.nome, v.permissao;
end;
$$;

-- 7) Convidado: pessoas compartilhadas com ele
create or replace function public.pessoas_compartilhadas()
returns table (pessoa_id uuid, pessoa_nome text, dono_id uuid, dono_nome text, permissao text)
language sql
stable
security definer
set search_path to ''
as $$
  select p.id, p.nome, p.user_id, public.nome_do_dono(p.user_id), p.permissao
  from public.pessoas p
  where p.convidado_user_id = auth.uid()
    and public.plano_ativo(p.user_id) in ('familia', 'profissional')
  order by 4, 2;
$$;

-- 8) Convidado: documentos compartilhados com ele
create or replace function public.documentos_compartilhados()
returns table (
  id uuid, nome text, tipo text, categoria text, data_vencimento date, data_emissao date,
  numero_documento text, observacoes text, arquivo_path text, arquivo_nome text,
  avisos_dias integer[], repeticao text, criado_em timestamptz,
  pessoa_id uuid, pessoa_nome text, dono_id uuid, dono_nome text, permissao text
)
language sql
stable
security definer
set search_path to ''
as $$
  select d.id, d.nome, d.tipo, d.categoria, d.data_vencimento, d.data_emissao,
         d.numero_documento, d.observacoes, d.arquivo_path, d.arquivo_nome,
         d.avisos_dias, d.repeticao, d.criado_em,
         p.id, p.nome, p.user_id, public.nome_do_dono(p.user_id), p.permissao
  from public.documentos d
  join public.pessoas p on p.id = d.pessoa_id and p.user_id = d.user_id
  where p.convidado_user_id = auth.uid()
    and public.plano_ativo(p.user_id) in ('familia', 'profissional')
  order by d.data_vencimento nulls last, d.nome;
$$;

-- arquivo enviado pelo convidado precisa estar na pasta dele dentro da pasta do dono
create or replace function public.caminho_compartilhado_ok(p_dono uuid, p_path text)
returns boolean
language sql
stable
set search_path to ''
as $$
  select p_path is null
      or (p_path like p_dono::text || '/compartilhado/' || auth.uid()::text || '/%'
          and position('..' in p_path) = 0);
$$;

-- 9) Convidado (atualizar/gerenciar): renovou -> data nova e/ou arquivo novo
create or replace function public.atualizar_documento_compartilhado(
  p_id uuid, p_data_vencimento date, p_arquivo_path text default null, p_arquivo_nome text default null
)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  d public.documentos%rowtype;
  v_acesso text;
begin
  select * into d from public.documentos where id = p_id for update;
  if not found then raise exception 'Documento não encontrado.'; end if;
  v_acesso := public.acesso_pessoa(d.pessoa_id);
  if v_acesso is null or v_acesso not in ('atualizar', 'gerenciar')
     or not exists (select 1 from public.pessoas p where p.id = d.pessoa_id and p.user_id = d.user_id) then
    raise exception 'Você não tem permissão para atualizar esse documento.';
  end if;
  if not public.caminho_compartilhado_ok(d.user_id, p_arquivo_path) then
    raise exception 'Arquivo inválido.';
  end if;

  update public.documentos
     set data_vencimento = coalesce(p_data_vencimento, data_vencimento),
         arquivo_path = coalesce(p_arquivo_path, arquivo_path),
         arquivo_nome = case when p_arquivo_path is not null then left(coalesce(p_arquivo_nome, 'arquivo'), 200) else arquivo_nome end
   where id = d.id;

  if p_data_vencimento is not null and p_data_vencimento is distinct from d.data_vencimento then
    insert into public.historico_documentos (documento_id, user_id, data_vencimento_anterior, data_vencimento_nova)
    values (d.id, d.user_id, d.data_vencimento, p_data_vencimento);
    update public.checklist_items set concluido = false where documento_id = d.id;
  end if;
end;
$$;

-- 10) Convidado (gerenciar): cadastra (p_id vazio) ou edita um documento da pessoa
create or replace function public.salvar_documento_compartilhado(p_id uuid, p_pessoa uuid, p_dados jsonb)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_dono uuid;
  d public.documentos%rowtype;
  v_nome text := left(trim(p_dados->>'nome'), 120);
  v_venc date := nullif(p_dados->>'data_vencimento', '')::date;
  v_path text := nullif(p_dados->>'arquivo_path', '');
  v_id uuid;
begin
  if coalesce(public.acesso_pessoa(p_pessoa), '') <> 'gerenciar' then
    raise exception 'Você não tem permissão para cadastrar documentos dessa pessoa.';
  end if;
  select user_id into v_dono from public.pessoas where id = p_pessoa;
  if v_nome is null or v_nome = '' then raise exception 'Informe o nome do documento.'; end if;
  if v_venc is null then raise exception 'Informe a data de vencimento.'; end if;
  if not public.caminho_compartilhado_ok(v_dono, v_path) then raise exception 'Arquivo inválido.'; end if;

  if p_id is null then
    insert into public.documentos (
      user_id, pessoa_id, nome, tipo, categoria, data_vencimento, data_emissao,
      numero_documento, observacoes, avisos_dias, repeticao, arquivo_path, arquivo_nome
    ) values (
      v_dono, p_pessoa, v_nome,
      nullif(left(p_dados->>'tipo', 40), ''),
      coalesce(nullif(left(p_dados->>'categoria', 40), ''), 'outro'),
      v_venc,
      nullif(p_dados->>'data_emissao', '')::date,
      nullif(left(p_dados->>'numero_documento', 80), ''),
      nullif(left(p_dados->>'observacoes', 2000), ''),
      coalesce((select array_agg(x::int) from jsonb_array_elements_text(p_dados->'avisos_dias') x), '{30,7}'),
      nullif(p_dados->>'repeticao', ''),
      v_path,
      case when v_path is not null then left(coalesce(p_dados->>'arquivo_nome', 'arquivo'), 200) end
    ) returning id into v_id;
    return v_id;
  end if;

  select * into d from public.documentos where id = p_id for update;
  if not found or d.user_id <> v_dono
     or coalesce(public.acesso_pessoa(d.pessoa_id), '') <> 'gerenciar' then
    raise exception 'Você não tem permissão para editar esse documento.';
  end if;

  update public.documentos set
    pessoa_id = p_pessoa,
    nome = v_nome,
    tipo = nullif(left(p_dados->>'tipo', 40), ''),
    categoria = coalesce(nullif(left(p_dados->>'categoria', 40), ''), 'outro'),
    data_vencimento = v_venc,
    data_emissao = nullif(p_dados->>'data_emissao', '')::date,
    numero_documento = nullif(left(p_dados->>'numero_documento', 80), ''),
    observacoes = nullif(left(p_dados->>'observacoes', 2000), ''),
    avisos_dias = coalesce((select array_agg(x::int) from jsonb_array_elements_text(p_dados->'avisos_dias') x), avisos_dias),
    repeticao = nullif(p_dados->>'repeticao', ''),
    arquivo_path = coalesce(v_path, arquivo_path),
    arquivo_nome = case when v_path is not null then left(coalesce(p_dados->>'arquivo_nome', 'arquivo'), 200) else arquivo_nome end
  where id = d.id;

  if v_venc is distinct from d.data_vencimento then
    insert into public.historico_documentos (documento_id, user_id, data_vencimento_anterior, data_vencimento_nova)
    values (d.id, d.user_id, d.data_vencimento, v_venc);
  end if;
  return d.id;
end;
$$;

-- 11) Convidado: sair do compartilhamento
create or replace function public.sair_compartilhamento(p_pessoa uuid)
returns void
language sql
security definer
set search_path to ''
as $$
  update public.pessoas set convidado_user_id = null
  where id = p_pessoa and convidado_user_id = auth.uid();
$$;

-- 12) Arquivos: o convidado lê os arquivos dos documentos compartilhados
--     e envia arquivos novos só pra pasta dele dentro da pasta do dono
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
    where d.arquivo_path = p_path
      and p.convidado_user_id = auth.uid()
      and public.plano_ativo(p.user_id) in ('familia', 'profissional')
  );
$$;

create or replace function public.pode_enviar_para_dono(p_dono text)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select exists (
    select 1 from public.pessoas p
    where p.user_id::text = p_dono
      and p.convidado_user_id = auth.uid()
      and p.permissao in ('atualizar', 'gerenciar')
      and public.plano_ativo(p.user_id) in ('familia', 'profissional')
  );
$$;

drop policy if exists "convidado ve arquivos compartilhados" on storage.objects;
create policy "convidado ve arquivos compartilhados" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'documentos-arquivos'
    and (
      public.pode_ler_arquivo_compartilhado(name)
      or ((storage.foldername(name))[2] = 'compartilhado'
          and (storage.foldername(name))[3] = (select auth.uid())::text
          and public.pode_enviar_para_dono((storage.foldername(name))[1]))
    )
  );

drop policy if exists "convidado envia arquivos compartilhados" on storage.objects;
create policy "convidado envia arquivos compartilhados" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'documentos-arquivos'
    and (storage.foldername(name))[2] = 'compartilhado'
    and (storage.foldername(name))[3] = (select auth.uid())::text
    and public.pode_enviar_para_dono((storage.foldername(name))[1])
  );

-- 13) Quem pode chamar o quê
revoke execute on function public.proteger_convidado() from public, anon, authenticated;
revoke execute on function public.acesso_pessoa(uuid) from public, anon;
revoke execute on function public.nome_do_dono(uuid) from public, anon, authenticated;
revoke execute on function public.criar_convite(uuid, text) from public, anon;
revoke execute on function public.aceitar_convite(text) from public, anon;
revoke execute on function public.pessoas_compartilhadas() from public, anon;
revoke execute on function public.documentos_compartilhados() from public, anon;
revoke execute on function public.atualizar_documento_compartilhado(uuid, date, text, text) from public, anon;
revoke execute on function public.salvar_documento_compartilhado(uuid, uuid, jsonb) from public, anon;
revoke execute on function public.sair_compartilhamento(uuid) from public, anon;
revoke execute on function public.pode_ler_arquivo_compartilhado(text) from public, anon;
revoke execute on function public.pode_enviar_para_dono(text) from public, anon;

grant execute on function public.ver_convite(text) to anon, authenticated;
grant execute on function public.acesso_pessoa(uuid) to authenticated;
grant execute on function public.criar_convite(uuid, text) to authenticated;
grant execute on function public.aceitar_convite(text) to authenticated;
grant execute on function public.pessoas_compartilhadas() to authenticated;
grant execute on function public.documentos_compartilhados() to authenticated;
grant execute on function public.atualizar_documento_compartilhado(uuid, date, text, text) to authenticated;
grant execute on function public.salvar_documento_compartilhado(uuid, uuid, jsonb) to authenticated;
grant execute on function public.sair_compartilhamento(uuid) to authenticated;
grant execute on function public.pode_ler_arquivo_compartilhado(text) to authenticated;
grant execute on function public.pode_enviar_para_dono(text) to authenticated;
