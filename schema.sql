-- Etapa 2: tabela de documentos
-- Rodar no SQL Editor do Supabase (Project > SQL Editor > New query > Run)

create table documentos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid, -- fica sem uso até a Etapa 4 (autenticação)
  nome text not null,
  tipo text not null,
  cliente text,
  data_vencimento date not null,
  criado_em timestamptz not null default now()
);

alter table documentos enable row level security;

-- Etapa 4: login chegou — trocamos as policies temporárias por policies
-- que isolam os documentos por usuário logado (auth.uid()).
drop policy if exists "insercao publica temporaria" on documentos;
drop policy if exists "leitura publica temporaria" on documentos;

create policy "usuarios veem seus proprios documentos"
on documentos for select
to authenticated
using (auth.uid() = user_id);

create policy "usuarios inserem seus proprios documentos"
on documentos for insert
to authenticated
with check (auth.uid() = user_id);

-- Etapa 5: editar e excluir documentos
create policy "usuarios atualizam seus proprios documentos"
on documentos for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "usuarios excluem seus proprios documentos"
on documentos for delete
to authenticated
using (auth.uid() = user_id);

-- Anexo de arquivo (PDF ou foto) no documento
alter table documentos add column if not exists arquivo_path text;
alter table documentos add column if not exists arquivo_nome text;

-- Categorias pra organizar os documentos por área da vida
alter table documentos add column if not exists categoria text not null default 'outro';

-- Histórico de renovação: registra quando a data de vencimento muda
create table if not exists historico_documentos (
  id uuid primary key default gen_random_uuid(),
  documento_id uuid not null references documentos(id) on delete cascade,
  user_id uuid not null,
  data_vencimento_anterior date,
  data_vencimento_nova date,
  criado_em timestamptz not null default now()
);

alter table historico_documentos enable row level security;

create policy "usuarios veem seu proprio historico"
on historico_documentos for select
to authenticated
using (auth.uid() = user_id);

create policy "usuarios inserem seu proprio historico"
on historico_documentos for insert
to authenticated
with check (auth.uid() = user_id);

-- Checklist de renovação: passos a cumprir pra renovar cada documento
create table if not exists checklist_items (
  id uuid primary key default gen_random_uuid(),
  documento_id uuid not null references documentos(id) on delete cascade,
  user_id uuid not null,
  texto text not null,
  concluido boolean not null default false,
  ordem int not null default 0,
  criado_em timestamptz not null default now()
);

alter table checklist_items enable row level security;

create policy "usuarios veem seu proprio checklist"
on checklist_items for select
to authenticated
using (auth.uid() = user_id);

create policy "usuarios inserem seu proprio checklist"
on checklist_items for insert
to authenticated
with check (auth.uid() = user_id);

create policy "usuarios atualizam seu proprio checklist"
on checklist_items for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "usuarios excluem seu proprio checklist"
on checklist_items for delete
to authenticated
using (auth.uid() = user_id);

-- Perfis/pessoas: associar um documento a uma pessoa (ex: membro da família)
create table if not exists pessoas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  nome text not null,
  criado_em timestamptz not null default now()
);

alter table pessoas enable row level security;

create policy "usuarios veem suas proprias pessoas"
on pessoas for select
to authenticated
using (auth.uid() = user_id);

create policy "usuarios inserem suas proprias pessoas"
on pessoas for insert
to authenticated
with check (auth.uid() = user_id);

alter table documentos add column if not exists pessoa_id uuid references pessoas(id) on delete set null;

-- Campos adicionais do documento
alter table documentos add column if not exists numero_documento text;
alter table documentos add column if not exists data_emissao date;
alter table documentos add column if not exists observacoes text;

-- Preferência de quando avisar (dias antes do vencimento) — usado quando o Web Push estiver no ar
alter table documentos add column if not exists avisos_dias integer[] not null default '{30,7}';

-- Gastos: controle de custos, opcionalmente ligados a um documento
create table if not exists gastos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  documento_id uuid references documentos(id) on delete set null,
  descricao text not null,
  valor numeric(10,2) not null,
  data_gasto date not null default current_date,
  categoria text not null default 'outro',
  criado_em timestamptz not null default now()
);

alter table gastos enable row level security;

create policy "usuarios veem seus proprios gastos"
on gastos for select
to authenticated
using (auth.uid() = user_id);

create policy "usuarios inserem seus proprios gastos"
on gastos for insert
to authenticated
with check (auth.uid() = user_id);

create policy "usuarios excluem seus proprios gastos"
on gastos for delete
to authenticated
using (auth.uid() = user_id);

-- Storage: bucket "documentos-arquivos" (criado pelo painel, privado)
-- Cada usuário só acessa arquivos dentro da própria pasta: {user_id}/arquivo.pdf
create policy "usuarios veem seus proprios arquivos"
on storage.objects for select
to authenticated
using (bucket_id = 'documentos-arquivos' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "usuarios enviam seus proprios arquivos"
on storage.objects for insert
to authenticated
with check (bucket_id = 'documentos-arquivos' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "usuarios atualizam seus proprios arquivos"
on storage.objects for update
to authenticated
using (bucket_id = 'documentos-arquivos' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "usuarios excluem seus proprios arquivos"
on storage.objects for delete
to authenticated
using (bucket_id = 'documentos-arquivos' and auth.uid()::text = (storage.foldername(name))[1]);

-- Custos do documento (Etapa: redesign do cadastro)
alter table documentos add column if not exists custo_valor numeric(10,2);
alter table documentos add column if not exists custo_tipo text;
alter table documentos add column if not exists proximo_pagamento_data date;
alter table documentos add column if not exists proximo_pagamento_status text default 'pendente';

-- ---------- plano / assinatura (pagamento via Asaas) ----------
-- O usuário só consegue LER o próprio perfil. Quem grava (plano, validade) é o servidor
-- (rotas /api com a chave secreta), então ninguém consegue se dar um plano pago pelo navegador.

create table if not exists perfis (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plano text not null default 'gratis',
  plano_valido_ate date,
  asaas_customer_id text,
  asaas_subscription_id text,
  criado_em timestamptz default now()
);

alter table perfis enable row level security;

create policy "ler proprio perfil" on perfis
  for select using (auth.uid() = user_id);


-- Notificações push: um aparelho = uma linha
create table if not exists push_inscricoes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  criado_em timestamptz default now()
);

alter table push_inscricoes enable row level security;

create policy "ver proprias inscricoes" on push_inscricoes
  for select using (auth.uid() = user_id);
create policy "criar proprias inscricoes" on push_inscricoes
  for insert with check (auth.uid() = user_id);
create policy "atualizar proprias inscricoes" on push_inscricoes
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "apagar proprias inscricoes" on push_inscricoes
  for delete using (auth.uid() = user_id);
