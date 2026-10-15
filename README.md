# MonkeyCord

Chamada de vídeo e áudio com a galera, em cima do Cloudflare RealtimeKit.
Tem duas formas de entrar, e as duas caem **nas mesmas salas**:

- **Site** — https://monkeycord.netlify.app
- **App do Windows** — instalador no [Releases](https://github.com/ruyteer/monkeycord/releases)

## Como funciona

O navegador nunca vê as chaves da Cloudflare. Quem entra pede um token pra
`/api/join`, que roda no servidor, acha (ou cria) a sala pelo nome e devolve um
token só daquele participante.

```
interface (React)  ->  /api/join  ->  Cloudflare RealtimeKit
```

O app desktop usa a mesma interface compilada, só que chama a `/api/join` do
site publicado. Por isso quem está no app e quem está no navegador se encontram.

## Rodando aqui

```bash
npm install
npm run build
npm start
```

Abre em http://localhost:3000. Pra desenvolver com recarga automática, use
`npm run dev` numa aba e `npm run dev:api` noutra.

### Variáveis de ambiente

Copie `.env.example` para `.env` (local) ou cadastre no painel da hospedagem:

| Variável | O que é |
| --- | --- |
| `CF_ACCOUNT_ID` | ID da conta Cloudflare |
| `CF_API_TOKEN` | API Token com permissão de Realtime |
| `RTK_APP_ID` | App ID do RealtimeKit |
| `RTK_PRESET_NAME` | Opcional. Padrão `group_call_participant` |
| `RTK_MEETING_ID` | Opcional. Força todo mundo numa sala fixa |

O `.env` e o `credenciais.txt` estão no `.gitignore` — eles têm segredo dentro.

## Chat e presença

Texto, quem está online e quem está em cada canal de voz vêm de um Worker na
Cloudflare (`worker/`), com Durable Objects:

- **Gateway** (um só): WebSocket no estilo do gateway do Discord — HELLO,
  heartbeat, IDENTIFY/RESUME e eventos (`MESSAGE_CREATE`, `MESSAGE_UPDATE`,
  `MESSAGE_DELETE`, `CHANNEL_CREATE`, `CHANNEL_DELETE`, `PRESENCE_UPDATE`,
  `VOICE_STATE_UPDATE`). Guarda também a lista de canais e o status de cada um
  (online, ausente, não perturbe, invisível). O protocolo está em `src/chat/protocol.ts`.
- **ChannelRoom** (um por canal de texto ou conversa direta): histórico,
  reações, fixadas, respostas e anexos (até 2 MB cada; imagens grandes são
  reduzidas no app antes de subir), tudo em SQLite.

As rotas REST estão listadas no topo de `worker/src/index.ts`. Não tem login: o
"autor" é o nome que o app manda, então só quem mandou consegue editar/apagar
pelo app, mas alguém mexendo na API na mão consegue se passar por outro nome.
Conversas diretas só chegam pros dois participantes.

O que fica só no aparelho (localStorage): o que já foi lido, as notificações de
cada canal, a lista de conversas diretas e os emojis recentes.

Em dev, rode `npm run dev:chat` (porta 8787) junto com o `npm run dev`; o app
fala direto com `http://127.0.0.1:8787`. Pra publicar:

```bash
npx wrangler login
npm run deploy:chat
```

O Worker publicado fica em `https://monkeycord-chat.monkeycord.workers.dev`, que
é o padrão do build de produção (site e app desktop). Pra apontar pra outro,
use `VITE_CHAT_URL`.

## App desktop

Fica em [`desktop/`](desktop). É Electron carregando a interface compilada
localmente (não é uma janela com o site dentro).

O que ele faz de diferente do navegador:

- **Compartilha a tela com o áudio do Windows junto** (`loopback`), que é o que
  falta no navegador pra passar filme com som.
- Seletor próprio de tela ou janela, com miniaturas.
- **Botão de som da transmissão na barra da chamada**: liga e desliga o áudio
  que vai junto com a tela, a qualquer momento, sem parar de compartilhar.
- Atenção: o Windows só entrega o som da **saída inteira**. Não dá pra mandar o
  filme e deixar o Discord de fora — por isso o botão, que corta o som todo
  quando ele estiver atrapalhando. Pra ter o filme sem o Discord junto, mude a
  saída do Discord pra outro dispositivo nas configurações de som do Windows
  (o `loopback` pega só o dispositivo padrão).
- Atualiza sozinho pelo GitHub Releases.

```bash
cd desktop
npm install
npm run dev     # roda o app aqui
npm run dist    # gera release/MonkeyCord-Setup-<versao>.exe
```

### Publicando uma versão nova

O [workflow](.github/workflows/desktop.yml) roda a cada push na `main` que mexa
no app ou na interface. Ele compila, faz um teste de abertura e:

- se a tag `v<versao>` **ainda não existe**, publica o instalador no Releases;
- se já existe, só compila e anexa o `.exe` como artefato do build.

Ou seja, pra lançar: suba o número em `desktop/package.json` e dê push. Quem já
tem o app instalado recebe a atualização sozinho.

### Sobre o aviso do Windows

O instalador não é assinado digitalmente. O Windows Defender não acusa nada
(testado), mas o **SmartScreen** mostra "O Windows protegeu o computador" nas
primeiras instalações, porque o arquivo ainda não tem reputação. É só clicar em
"Mais informações" → "Executar assim mesmo". O aviso some sozinho conforme mais
gente baixa. Pra acabar de vez com ele só comprando um certificado de assinatura
de código (uns US$ 200 por ano).

Pra reduzir atrito, o instalador já é por usuário (não pede senha de
administrador) e não usa compressão de executável, que é o que costuma gerar
falso positivo em antivírus.
