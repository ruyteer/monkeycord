# MonkeyCord

Chat, voz, vídeo e tela com a galera, no estilo do Discord. Tem duas formas de
entrar, e as duas caem **nos mesmos canais**:

- **Site** — https://monkeycord.netlify.app
- **App do Windows** — instalador no [Releases](https://github.com/ruyteer/monkeycord/releases)

## Como funciona

```
interface (React)  ──WebSocket/REST──>  Worker do chat (Cloudflare, plano grátis)
        │                                   texto, presença, canais, sinalização
        └──────── WebRTC direto (P2P) ────> as outras pessoas da chamada
```

- **Chat e presença**: um Worker com Durable Objects (ver abaixo). Cabe no
  plano grátis da Cloudflare.
- **Voz, vídeo e tela**: conexão direta entre as pessoas (WebRTC "mesh",
  `src/call/meeting.ts`). Não tem servidor de mídia nem conta pra pagar: o
  Worker só apresenta um ao outro e o áudio/vídeo vai de PC pra PC.
  - Bom pra grupo de amigos: até umas 8 pessoas com voz e algumas câmeras.
  - Quem compartilha a tela manda uma cópia pra cada pessoa, então a internet
    de **upload** de quem transmite é o limite (1080p ≈ 4,5 Mbps por pessoa).
  - Em algumas redes (operadora com CGNAT dos dois lados, rede de empresa) a
    conexão direta não fecha. Pra isso dá pra ligar um servidor **TURN**, que
    repassa a mídia. Cadastre no Worker (todos opcionais):

    ```bash
    cd worker
    npx wrangler secret put TURN_URLS        # ex.: turn:seu-servidor:3478,turns:seu-servidor:5349
    npx wrangler secret put TURN_USERNAME
    npx wrangler secret put TURN_CREDENTIAL
    ```

    Opções grátis: um `coturn` numa VM grátis (Oracle Cloud Always Free) ou
    o plano grátis do metered.ca.

O app desktop usa a mesma interface compilada, apontando pro mesmo Worker. Por
isso quem está no app e quem está no navegador se encontram.

## Rodando aqui

```bash
npm install
npm run dev:chat   # Worker do chat em http://127.0.0.1:8787
npm run dev        # interface em http://localhost:5173 (outra aba do terminal)
```

Pra servir o build: `npm run build` e `npm start` (http://localhost:3000).

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
localmente (não é uma janela com o site dentro), igual ao Discord.

O que ele faz de diferente do navegador:

- **Barra de título própria** e janela no visual do app; seta verde quando tem
  atualização pronta.
- **Bandeja do Windows**: o X esconde a janela e o app continua rodando (dá pra
  mudar em Configurações > Windows e atualizações). Menu da bandeja com mutar,
  desativar áudio, sair da voz e fechar.
- **Atalhos globais**: Ctrl+Shift+M (mutar) e Ctrl+Shift+D (desativar áudio)
  funcionam com o app minimizado.
- **Selo vermelho no ícone da barra de tarefas** com as menções, e o ícone
  pisca quando alguém te marca.
- **Abrir junto com o Windows** (já começa escondido na bandeja).
- **Links `monkeycord://sala/<nome>`** abrem o app direto no canal de voz.
- **Compartilha a tela com o áudio do Windows junto** (`loopback`), que é o que
  falta no navegador pra passar filme com som. Seletor próprio de tela ou
  janela, com miniaturas, e botão pra ligar/desligar o som da transmissão.
- Atenção: o Windows só entrega o som da **saída inteira**. Pra ter o filme sem
  a voz da galera junto, mude a saída do MonkeyCord (Configurações > Voz e
  vídeo > Dispositivo de saída) pra outro aparelho, ou use fone.
- **Atualiza sozinho** pelo GitHub Releases (procura a cada 4 horas e dá pra
  procurar na mão nas configurações).

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
