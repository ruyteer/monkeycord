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

## App desktop

Fica em [`desktop/`](desktop). É Electron carregando a interface compilada
localmente (não é uma janela com o site dentro).

O que ele faz de diferente do navegador:

- **Compartilha a tela com o áudio do Windows junto** (`loopback`), que é o que
  falta no navegador pra passar filme com som.
- Seletor próprio de tela ou janela, com miniaturas.
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
