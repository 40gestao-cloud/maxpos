# MaxPOS — ERP/PDV

Sistema de Gestão e Ponto de Venda Moderno com design neumórfico, voltado para uso educacional.

**Stack:** React 19 + TypeScript + Vite 6 + Tailwind CSS 4 + Supabase (PostgreSQL + Auth + Realtime + RLS) + PWA (vite-plugin-pwa).

## Módulos

PDV/Caixa · Cadastros · Estoque · Financeiro · Fiscal (simulado) · Fichas/Eventos · Agendador · Relatórios · Catálogo Online · Configurações.

## Setup local

**Pré-requisitos:** Node.js 18+ e uma conta no [Supabase](https://supabase.com).

1. Instale as dependências:
   ```bash
   npm install
   ```
2. Crie um projeto no Supabase e rode `supabase/schema.sql` no SQL Editor.
3. Crie os usuários iniciais no painel **Authentication → Users** e ajuste seus cargos (instruções no final do `schema.sql`).
4. Copie `.env.example` para `.env` e preencha:
   ```
   VITE_SUPABASE_URL=...
   VITE_SUPABASE_ANON_KEY=...
   ```
5. Rode em modo dev:
   ```bash
   npm run dev
   ```

## Build de produção

```bash
npm run build
npm run preview
```

## Deploy no Vercel

1. Importe este repo no Vercel.
2. Framework: **Vite** (auto-detectado).
3. Em **Environment Variables**, defina `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`.
4. Em **Supabase → Authentication → URL Configuration**, adicione o domínio do Vercel em Site URL e Redirect URLs.

O `vercel.json` já cuida do fallback SPA e dos headers de cache do PWA.
