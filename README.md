# Bingo

Site de bingo em tempo real, sem cadastro para os jogadores. Quem organiza (o host) cria o bingo, envia as imagens que serão sorteadas e controla o sorteio; cada jogador entra com um código de 5 letras, informa o nome e recebe uma cartela. As imagens sorteadas aparecem marcadas na cartela na hora e o próprio servidor confere quem fez BINGO.

## Como funciona

| Quem | O que faz |
|------|-----------|
| Host | Cria o bingo, envia as imagens, compartilha o link, inicia, sorteia (aleatório, automático ou escolhendo a imagem), desfaz, reinicia, encerra. |
| Jogador | Abre o link, informa o nome e fica na sala de espera; ao iniciar recebe a cartela e a entrada é fechada. |
| Tela | `/tela?c=CODIGO` é a tela da live (OBS, TV ou projetor): 16:9 sem rolagem, QR code na espera, imagem grande, faixa das sorteadas e vencedores. Aceita `&tema=light|dark` e `&cor=RRGGBB` (cor do canal), configurados no painel do host. |
| Servidor | Sorteia com aleatoriedade criptográfica, gera cartelas únicas, confere o BINGO e guarda tudo em banco de dados SQLite. |

## Segurança

- Sorteio, cartelas e conferência acontecem **no servidor**. O navegador só exibe.
- Qualquer pessoa pode criar um bingo (limite de 10 por hora por endereço IP).
- Cada bingo recebe um **token de host** (link do painel). Sem ele, ninguém sorteia, edita ou apaga.
- Jogadores só conseguem entrar e receber cartela; nunca escrevem no sorteio nem se declaram vencedores.
- Imagens são reduzidas no navegador (240 px) e validadas no servidor (tipo e tamanho). Limite de 120 imagens por bingo.
- Limite de requisições por IP, cabeçalhos de proteção e dependências: Express, Socket.io e qrcode.
- Uso recreativo, sem apostas: não há pagamento nem prêmio em dinheiro.

## Rodar no computador

Requer Node.js 22.13 ou mais novo.

```bash
npm install
npm start
```

Abra http://localhost:3000.

## Publicar na internet

O servidor precisa rodar Node.js continuamente (não funciona em Netlify ou GitHub Pages). Opções gratuitas ou baratas:

**Railway** (mantém o banco; requer plano pago):
1. Crie um projeto a partir deste repositório no GitHub.
2. Adicione um *Volume* montado em `/data` e defina `DATA_DIR=/data`.
3. Gere o domínio público em *Settings → Networking*.

**Render**: crie um *Web Service*, Build `npm install`, Start `npm start`. No plano gratuito o disco é apagado a cada deploy e o serviço dorme sem uso; para manter o histórico, adicione um *Disk* montado em `/data` com `DATA_DIR=/data` (plano pago).

**Fly.io**: `fly launch`, crie um volume (`fly volumes create data`) e defina `DATA_DIR=/data`.

## Variáveis de ambiente

| Variável | Obrigatória | Descrição |
|----------|-------------|-----------|
| `PORT` | não | Porta (padrão 3000; as hospedagens definem sozinhas). |
| `DATA_DIR` | não | Pasta do banco `bingo.db` (padrão `./data`). |

## Estrutura

```
server.js          servidor, regras do jogo, API e tempo real
public/index.html  entrada: código do jogador ou criação pelo host
public/host.html   painel do host
public/play.html   sala de espera e cartela do jogador
public/tela.html   tela de projeção
public/app.js      funções compartilhadas
public/style.css   visual (tinta #1f3b2f, papel #f5f1e6, marcação #e8432a; modo escuro automático)
data/bingo.db      banco SQLite (criado automaticamente)
```

## Capacidade

Testado com 300 jogadores entrando ao mesmo tempo (0,5 s), geração de 300 cartelas ao iniciar (0,07 s) e sorteios com 300 cartelas (5 ms cada). Cada jogador recebe só a própria cartela; o estado transmitido a todos fica pequeno. Limite de 2.000 jogadores por bingo.

## Limitações

- O link do painel do host contém o token; quem tiver o link controla o bingo. Não o compartilhe com jogadores.
- Não há recuperação do link do host: guarde-o ou deixe a aba aberta durante o jogo; se perder, crie outro bingo.
- O SQLite embutido no Node ainda exibe um aviso de "experimental" ao iniciar; é inofensivo.

## Endereço publicado

https://bingo-7h74.onrender.com (Render, plano gratuito, região Virgínia).
