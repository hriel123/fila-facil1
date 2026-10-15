# API do FilaFácil

Servidor que guarda as contas, as filas e as senhas do FilaFácil. Há dois tipos de conta: **estabelecimento** (controla a própria fila) e **cliente** (pega e acompanha senhas pelo celular).

## Stack

- Node.js + Express
- Prisma ORM
- PostgreSQL
- JWT (autenticação) + bcrypt (hash de senha)

## Rotas

| Método | Rota | Quem usa | O que faz |
|--------|------|----------|-----------|
| GET | `/health` | Render | Responde `{ ok: true }` |
| POST | `/auth/register` | todos | Cria a conta (`name`, `email`, `password`, `role`: `OWNER` ou `CUSTOMER`, e `businessName` para estabelecimento). Já devolve o token |
| POST | `/auth/login` | todos | Devolve o token (`email`, `password`). Vale 30 dias |
| GET | `/auth/me` | todos | Dados da conta logada |
| GET | `/public/:code` | página da fila e TV | Nome da fila, quantos aguardam, senha chamada e últimas chamadas. Só códigos de senha, sem nomes |
| GET | `/tickets` | cliente | Senhas ativas (com posição e espera estimada) e histórico |
| GET | `/tickets/:id` | cliente | Uma senha do cliente |
| POST | `/tickets` | cliente | Pega senha na fila `code`. Se já tiver uma ativa nessa fila, devolve a mesma |
| DELETE | `/tickets/:id` | cliente | Sai da fila |
| GET | `/panel` | estabelecimento | Senha chamada, fila, últimos atendimentos e números do dia |
| POST | `/panel/next` | estabelecimento | Finaliza o atendimento atual e chama a próxima senha |
| POST | `/panel/recall` | estabelecimento | Chama a senha atual de novo |
| POST | `/panel/finish` | estabelecimento | Finaliza o atendimento atual |
| POST | `/panel/no-show` | estabelecimento | Marca que a senha chamada não compareceu |
| POST | `/panel/tickets` | estabelecimento | Gera uma senha avulsa (`name` opcional) |
| DELETE | `/panel/tickets/:id` | estabelecimento | Tira uma senha da fila |
| PATCH | `/panel/settings` | estabelecimento | Muda `name`, `prefix`, `avgMinutes` ou `open` |
| GET | `/panel/report?day=AAAA-MM-DD` | estabelecimento | Relatório do dia: totais, esperas, senhas por hora e lista de atendimentos |

As rotas de `/tickets` e `/panel` exigem o cabeçalho `Authorization: Bearer <token>` da conta do tipo certo.

A numeração das senhas recomeça do 1 todo dia (fuso de Fortaleza). A espera estimada usa o tempo médio configurado até haver 3 atendimentos no dia; depois, a média real do dia.

## Rodar localmente

```bash
docker run -d --name filafacil-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=filafacil -p 5432:5432 postgres:15-alpine
cd backend
cp .env.example .env
npm install
npx prisma migrate deploy
npm run dev
```

A API sobe em `http://localhost:3001`. Para o site usar essa API, coloque o endereço na tag `<meta name="filafacil-api" content="...">` do `app.html` e do `tv.html`, sirva a pasta do site na porta 8000 (`python3 -m http.server 8000`) e abra `http://localhost:8000/app.html`.

## Publicar (Neon + Render, gratuito)

### 1. Banco (Neon)

1. Crie um projeto gratuito em [neon.tech](https://neon.tech), na região **AWS US East (N. Virginia)**.
2. Em **Connection string**, desligue a opção **Pooled connection** e copie o endereço (formato `postgresql://usuario:senha@host/banco?sslmode=require`).

### 2. Servidor (Render)

1. No [Render](https://render.com), clique em **New** > **Blueprint** e escolha o repositório `hriel123/fila-facil1`.
2. O Render lê o `render.yaml` da raiz e cria o serviço `fila-facil-api`. Ele pede o valor de `DATABASE_URL`: cole o endereço do Neon.
3. O `JWT_SECRET` é gerado sozinho, e o `CORS_ORIGIN` já vem como `https://hriel123.github.io`.
4. Clique em **Apply**. Quando o deploy terminar, abra `https://<nome-do-serviço>.onrender.com/health`. Deve aparecer `{"ok":true}`.

No plano gratuito o servidor dorme depois de 15 minutos sem uso. O primeiro acesso depois disso leva de 30 a 60 segundos; o app mostra um aviso enquanto isso.

### 3. Ligar o site ao servidor

No `app.html` e no `tv.html`, troque `<meta name="filafacil-api" content="">` pelo endereço do serviço, por exemplo `<meta name="filafacil-api" content="https://fila-facil-api.onrender.com">`, e publique.
