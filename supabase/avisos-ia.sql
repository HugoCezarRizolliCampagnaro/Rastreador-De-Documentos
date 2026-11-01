-- ============================================================
-- Avisos de erro da leitura da IA (botão "A IA leu algo errado? Avisar")
-- Guarda só o texto que a pessoa escreveu + o que a IA leu/foi corrigido. Sem foto.
-- Usuário só consegue ENVIAR (não lê avisos de ninguém). Você vê pelo Table Editor / SQL.
-- Pode rodar mais de uma vez.
-- ============================================================
create table if not exists public.avisos_ia (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  mensagem text not null check (char_length(mensagem) between 1 and 500),
  lido jsonb,
  corrigido jsonb,
  fotos integer,
  criado_em timestamptz not null default now()
);

alter table public.avisos_ia enable row level security;

drop policy if exists "usuario envia aviso da ia" on public.avisos_ia;
create policy "usuario envia aviso da ia" on public.avisos_ia
  for insert to authenticated with check ((select auth.uid()) = user_id);

revoke all on public.avisos_ia from anon;
grant insert on public.avisos_ia to authenticated;
