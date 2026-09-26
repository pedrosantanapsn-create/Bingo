# Bingo

Site de bingo em tempo real, sem cadastro para os jogadores. Quem organiza (o host) cria o bingo com uma senha, envia as imagens que serão sorteadas e controla o sorteio; cada jogador entra com um código de 5 letras, informa o nome e recebe uma cartela. As imagens sorteadas aparecem marcadas na cartela na hora e o próprio servidor confere quem fez BINGO.

## Como funciona

| Quem | O que faz |
|------|-----------|
| Host | Cria o bingo (senha do host), envia as imagens, gera cartelas se quiser, inicia, sorteia (manual ou automático), desfaz, reinicia, encerra. |
| Jogador | Abre o link ou digita o código, informa o nome, recebe a cartela e acompanha o sorteio ao vivo. |
| Servidor | Sorteia com aleatoriedade criptográfica, gera cartelas únicas, confere o BINGO e guarda tudo em banco de dados SQLite. |

## Segurança

- Sorteio, cartelas e conferência acontecem **no servidor**. O navegador só exibe.
- Criar bingos exige a senha definida em `HOST_PASSWORD`.
- Cada bingo recebe um **token de host** (link do painel). Sem ele, ninguém sorteia, edita ou apaga.
- Jogadores só conseguem entrar e receber cartela; nunca escrevem no sorteio nem se declaram vencedores.
- Imagens são reduzidas no navegador (240 px) e validadas no servidor (tipo e tamanho). Limite de 120 imagens por bingo.
- Limite de requisições por IP, cabeçalhos de proteção e nenhuma dependência além de Express e Socket.io.
- Uso recreativo, sem apostas: não há pagamento nem prêmio em dinheiro.

## Rodar no computador

Requer Node.js 22.13 ou mais novo.

```bash
npm install
HOST_PASSWORD=escolha-uma-senha npm start
```

Abra http://localhost:3000. No Windows (PowerShell): `$env:HOST_PASSWORD="escolha-uma-senha"; npm start`.

## Publicar na internet

O servidor precisa rodar Node.js continuamente (não funciona em Netlify ou GitHub Pages). Opções gratuitas ou baratas:

**Railway** (mantém o banco; requer plano pago):
1. Crie um projeto a partir deste repositório no GitHub.
2. Em *Variables*, defina `HOST_PASSWORD`.
3. Adicione um *Volume* montado em `/data` e defina `DATA_DIR=/data`.
4. Gere o domínio público em *Settings → Networking*.

**Render**: crie um *Web Service*, Build `npm install`, Start `npm start`, variável `HOST_PASSWORD`. No plano gratuito o disco é apagado a cada deploy e o serviço dorme sem uso; para manter o histórico, adicione um *Disk* montado em `/data` com `DATA_DIR=/data` (plano pago).

**Fly.io**: `fly launch`, crie um volume (`fly volumes create data`) e defina `DATA_DIR=/data` e `HOST_PASSWORD` com `fly secrets set`.

## Variáveis de ambiente

| Variável | Obrigatória | Descrição |
|----------|-------------|-----------|
| `HOST_PASSWORD` | sim | Senha para criar bingos. |
| `PORT` | não | Porta (padrão 3000; as hospedagens definem sozinhas). |
| `DATA_DIR` | não | Pasta do banco `bingo.db` (padrão `./data`). |

## Estrutura

```
server.js          servidor, regras do jogo, API e tempo real
public/index.html  entrada: código do jogador ou criação pelo host
public/host.html   painel do host
public/play.html   cartela do jogador
public/app.js      funções compartilhadas
public/style.css   visual (duas cores: tinta #1f3b2f e papel #f5f1e6)
data/bingo.db      banco SQLite (criado automaticamente)
```

## Limitações

- O link do painel do host contém o token; quem tiver o link controla o bingo. Não o compartilhe com jogadores.
- Não há recuperação do link do host: se perder, crie outro bingo (o dispositivo que criou guarda os links na página inicial).
- O SQLite embutido no Node ainda exibe um aviso de "experimental" ao iniciar; é inofensivo.

## Endereço publicado

https://bingo-7h74.onrender.com (Render, plano gratuito, região Virgínia).
