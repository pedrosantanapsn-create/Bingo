// Bingo — servidor
// Express + Socket.io + SQLite (node:sqlite, embutido no Node 22.13+)
import express from "express";
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { Server } from "socket.io";
import QRCode from "qrcode";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const MAX_IMG_BYTES = 200 * 1024;
const MAX_PLAYERS = 2000;


fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, "bingo.db"));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS games (
    id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
    grid INTEGER NOT NULL, pattern TEXT NOT NULL, status TEXT NOT NULL,
    allow_join INTEGER NOT NULL DEFAULT 1, host_token TEXT NOT NULL,
    draws TEXT NOT NULL DEFAULT '[]', winners TEXT NOT NULL DEFAULT '[]',
    items_version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, game_id TEXT NOT NULL, name TEXT NOT NULL, img TEXT NOT NULL, ord INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS players (id TEXT PRIMARY KEY, game_id TEXT NOT NULL, name TEXT NOT NULL, token TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS cards (id TEXT PRIMARY KEY, game_id TEXT NOT NULL, player_id TEXT, n INTEGER NOT NULL, player TEXT NOT NULL, cells TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS items_game ON items(game_id, ord);
  CREATE INDEX IF NOT EXISTS players_game ON players(game_id, created_at);
  CREATE INDEX IF NOT EXISTS cards_game ON cards(game_id, n);
`);
try { db.exec("ALTER TABLE cards ADD COLUMN player_id TEXT"); } catch {} // bancos criados na versão anterior
db.exec("CREATE INDEX IF NOT EXISTS cards_player ON cards(player_id)");

const q = {
  gameByCode: db.prepare("SELECT * FROM games WHERE code = ?"),
  insertGame: db.prepare("INSERT INTO games (id, code, name, grid, pattern, status, host_token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'setup', ?, ?, ?)"),
  updateGame: db.prepare("UPDATE games SET name=?, grid=?, pattern=?, status=?, allow_join=?, draws=?, winners=?, items_version=?, updated_at=? WHERE id=?"),
  deleteGame: db.prepare("DELETE FROM games WHERE id = ?"),
  items: db.prepare("SELECT id, name, img, ord FROM items WHERE game_id = ? ORDER BY ord"),
  itemsMeta: db.prepare("SELECT id, name, ord FROM items WHERE game_id = ? ORDER BY ord"),
  insertItem: db.prepare("INSERT INTO items (id, game_id, name, img, ord) VALUES (?, ?, ?, ?, ?)"),
  renameItem: db.prepare("UPDATE items SET name = ? WHERE id = ? AND game_id = ?"),
  deleteItem: db.prepare("DELETE FROM items WHERE id = ? AND game_id = ?"),
  deleteItems: db.prepare("DELETE FROM items WHERE game_id = ?"),
  maxItemOrd: db.prepare("SELECT COALESCE(MAX(ord),0) AS m FROM items WHERE game_id = ?"),
  players: db.prepare("SELECT id, name, created_at FROM players WHERE game_id = ? ORDER BY created_at"),
  playerById: db.prepare("SELECT * FROM players WHERE id = ? AND game_id = ?"),
  playerCount: db.prepare("SELECT COUNT(*) AS c FROM players WHERE game_id = ?"),
  insertPlayer: db.prepare("INSERT INTO players (id, game_id, name, token, created_at) VALUES (?, ?, ?, ?, ?)"),
  deletePlayer: db.prepare("DELETE FROM players WHERE id = ? AND game_id = ?"),
  deletePlayers: db.prepare("DELETE FROM players WHERE game_id = ?"),
  cards: db.prepare("SELECT id, player_id, n, player, cells FROM cards WHERE game_id = ? ORDER BY n"),
  cardsByPlayer: db.prepare("SELECT id, n, player, cells FROM cards WHERE game_id = ? AND player_id = ? ORDER BY n"),
  cardCount: db.prepare("SELECT COUNT(*) AS c FROM cards WHERE game_id = ?"),
  insertCard: db.prepare("INSERT INTO cards (id, game_id, player_id, n, player, cells, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"),
  deleteCard: db.prepare("DELETE FROM cards WHERE id = ? AND game_id = ?"),
  deleteCardsOfPlayer: db.prepare("DELETE FROM cards WHERE player_id = ? AND game_id = ?"),
  deleteCards: db.prepare("DELETE FROM cards WHERE game_id = ?"),
  maxCardN: db.prepare("SELECT COALESCE(MAX(n),0) AS m FROM cards WHERE game_id = ?"),
};

// ---------- utilidades ----------
const now = () => new Date().toISOString();
const id = () => crypto.randomBytes(8).toString("hex");
const codeChars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function newCode() { for (;;) { let c = ""; for (let i = 0; i < 5; i++) c += codeChars[crypto.randomInt(codeChars.length)]; if (!q.gameByCode.get(c)) return c; } }
function shuffle(arr) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const cellsNeeded = (grid) => (grid === 5 ? 24 : grid * grid);
function buildCard(grid, itemIds) {
  const picks = shuffle(itemIds).slice(0, cellsNeeded(grid));
  const cells = []; let p = 0;
  for (let i = 0; i < grid * grid; i++) cells.push(grid === 5 && i === 12 ? null : picks[p++]);
  return cells;
}
function checkPattern(cells, grid, pattern, drawnSet) {
  const hit = cells.map((c) => c === null || drawnSet.has(c));
  if (pattern === "full") return hit.every(Boolean) ? "Cartela cheia" : null;
  for (let r = 0; r < grid; r++) if (hit.slice(r * grid, r * grid + grid).every(Boolean)) return `Linha ${r + 1}`;
  for (let c = 0; c < grid; c++) { let ok = true; for (let r = 0; r < grid; r++) if (!hit[r * grid + c]) { ok = false; break; } if (ok) return `Coluna ${c + 1}`; }
  let d1 = true, d2 = true;
  for (let i = 0; i < grid; i++) { if (!hit[i * grid + i]) d1 = false; if (!hit[i * grid + (grid - 1 - i)]) d2 = false; }
  if (d1 || d2) return "Diagonal";
  return null;
}
function safeEqual(a, b) { const A = Buffer.from(String(a)), B = Buffer.from(String(b)); return A.length === B.length && crypto.timingSafeEqual(A, B); }
const clean = (s, max) => String(s ?? "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, max);

function loadGame(code) {
  const g = q.gameByCode.get(String(code || "").toUpperCase());
  if (!g) return null;
  g.draws = JSON.parse(g.draws); g.winners = JSON.parse(g.winners);
  return g;
}
function saveGame(g) {
  g.updated_at = now();
  q.updateGame.run(g.name, g.grid, g.pattern, g.status, g.allow_join ? 1 : 0, JSON.stringify(g.draws), JSON.stringify(g.winners), g.items_version, g.updated_at, g.id);
}
// estado público: leve, sem cartelas (cada jogador busca só a sua)
function publicState(g) {
  return {
    code: g.code, name: g.name, grid: g.grid, pattern: g.pattern, status: g.status, allowJoin: !!g.allow_join,
    draws: g.draws, winners: g.winners, itemsVersion: g.items_version, items: q.itemsMeta.all(g.id),
    playerCount: q.playerCount.get(g.id).c, cardCount: q.cardCount.get(g.id).c, updatedAt: g.updated_at,
  };
}
function evaluateWinners(g) {
  const drawnSet = new Set(g.draws);
  const known = new Set(g.winners.map((w) => w.cardId));
  for (const c of q.cards.all(g.id)) {
    if (known.has(c.id)) continue;
    const how = checkPattern(JSON.parse(c.cells), g.grid, g.pattern, drawnSet);
    if (how) g.winners.push({ cardId: c.id, n: c.n, player: c.player, how, drawIndex: g.draws.length, at: now() });
  }
}
let cardSigCache = new Map(); // game_id -> Set de assinaturas (evita cartelas repetidas)
function createCard(g, playerId, playerName, itemIds) {
  let sigs = cardSigCache.get(g.id);
  if (!sigs) { sigs = new Set(q.cards.all(g.id).map((c) => c.cells)); cardSigCache.set(g.id, sigs); }
  let cells, sig, tries = 0;
  do { cells = buildCard(g.grid, itemIds); sig = JSON.stringify(cells); tries++; } while (sigs.has(sig) && tries < 100);
  sigs.add(sig);
  const n = q.maxCardN.get(g.id).m + 1;
  const card = { id: id(), n, player: playerName, cells };
  q.insertCard.run(card.id, g.id, playerId, n, playerName, sig, now());
  return card;
}

// ---------- app ----------
const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e5, pingInterval: 25000 });

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use((req, res, next) => { res.setHeader("X-Content-Type-Options", "nosniff"); res.setHeader("X-Frame-Options", "DENY"); res.setHeader("Referrer-Policy", "no-referrer"); next(); });
app.use(express.json({ limit: "400kb" }));
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"], maxAge: "5m" }));

const hits = new Map();
app.use("/api", (req, res, next) => {
  const key = `${req.ip}:${Math.floor(Date.now() / 60000)}`;
  const n = (hits.get(key) || 0) + 1; hits.set(key, n);
  if (hits.size > 20000) hits.clear();
  if (n > 2000) return res.status(429).json({ error: "Muitas requisições. Aguarde um minuto." });
  next();
});

let pending = new Map(); // broadcast agrupado (várias entradas seguidas viram um envio)
function broadcast(g) {
  if (pending.has(g.code)) return;
  pending.set(g.code, setTimeout(() => { pending.delete(g.code); const fresh = loadGame(g.code); if (fresh) io.to(`game:${g.code}`).emit("state", publicState(fresh)); }, 150));
}
function hostAuth(req, res, next) {
  const g = loadGame(req.params.code);
  if (!g) return res.status(404).json({ error: "Bingo não encontrado." });
  if (!safeEqual(req.get("x-host-token") || "", g.host_token)) return res.status(403).json({ error: "Acesso de host negado." });
  req.game = g; next();
}
function publicGame(req, res, next) {
  const g = loadGame(req.params.code);
  if (!g) return res.status(404).json({ error: "Bingo não encontrado." });
  req.game = g; next();
}

// ----- criação (sem senha; limite de 10 bingos por hora por endereço) -----
const creations = new Map();
app.post("/api/games", (req, res) => {
  const { name, grid, pattern } = req.body || {};
  const key = `${req.ip}:${Math.floor(Date.now() / 3600000)}`;
  const c = (creations.get(key) || 0) + 1; creations.set(key, c);
  if (creations.size > 5000) creations.clear();
  if (c > 10) return res.status(429).json({ error: "Limite de bingos criados por hora. Tente mais tarde." });
  const gridN = [3, 4, 5].includes(Number(grid)) ? Number(grid) : 4;
  const pat = pattern === "full" ? "full" : "line";
  const g = { id: id(), code: newCode(), name: clean(name, 40) || "Bingo", host_token: crypto.randomBytes(24).toString("hex") };
  const t = now();
  q.insertGame.run(g.id, g.code, g.name, gridN, pat, g.host_token, t, t);
  res.json({ code: g.code, hostToken: g.host_token });
});

// ----- leitura pública -----
app.get("/api/games/:code", publicGame, (req, res) => res.json(publicState(req.game)));
app.get("/api/games/:code/items", publicGame, (req, res) => {
  res.setHeader("Cache-Control", "private, max-age=3600");
  res.json({ itemsVersion: req.game.items_version, items: q.items.all(req.game.id) });
});
app.get("/api/games/:code/qr.svg", publicGame, async (req, res) => {
  const link = `${req.protocol}://${req.get("host")}/play?c=${req.game.code}`;
  const svg = await QRCode.toString(link, { type: "svg", margin: 1, color: { dark: "#000000", light: "#00000000" } });
  res.setHeader("Content-Type", "image/svg+xml"); res.setHeader("Cache-Control", "public, max-age=86400");
  res.send(svg);
});
app.get("/api/games/:code/players", publicGame, (req, res) => {
  res.json({ players: q.players.all(req.game.id).map((p) => ({ id: p.id, name: p.name })) });
});

// ----- jogador: entra na sala de espera; recebe a cartela quando o host inicia -----
app.post("/api/games/:code/join", publicGame, (req, res) => {
  const g = req.game;
  if (g.status === "finished") return res.status(400).json({ error: "Este bingo já foi encerrado." });
  if (!g.allow_join) return res.status(400).json({ error: "O bingo já começou. A entrada foi fechada." });
  const name = clean(req.body?.player, 30);
  if (!name) return res.status(400).json({ error: "Informe seu nome." });
  if (q.playerCount.get(g.id).c >= MAX_PLAYERS) return res.status(400).json({ error: "O bingo está lotado." });
  const p = { id: id(), token: crypto.randomBytes(16).toString("hex") };
  q.insertPlayer.run(p.id, g.id, name, p.token, now());
  if (g.status === "playing") { // entrada reaberta pelo host durante o jogo: já recebe cartela
    const itemIds = q.itemsMeta.all(g.id).map((i) => i.id);
    createCard(g, p.id, name, itemIds);
  }
  broadcast(g);
  res.json({ playerId: p.id, playerToken: p.token, name });
});
app.get("/api/games/:code/me", publicGame, (req, res) => {
  const g = req.game;
  const p = q.playerById.get(String(req.query.player || ""), g.id);
  if (!p || !safeEqual(req.get("x-player-token") || "", p.token)) return res.status(404).json({ error: "Jogador não encontrado." });
  const cards = q.cardsByPlayer.all(g.id, p.id).map((c) => ({ id: c.id, n: c.n, player: c.player, cells: JSON.parse(c.cells) }));
  res.json({ id: p.id, name: p.name, cards });
});

// ----- host -----
app.get("/api/games/:code/cards", hostAuth, (req, res) => {
  res.json({ cards: q.cards.all(req.game.id).map((c) => ({ id: c.id, playerId: c.player_id, n: c.n, player: c.player, cells: JSON.parse(c.cells) })) });
});
app.post("/api/games/:code/settings", hostAuth, (req, res) => {
  const g = req.game, b = req.body || {};
  if (b.name !== undefined) g.name = clean(b.name, 40) || g.name;
  if (b.grid !== undefined && [3, 4, 5].includes(Number(b.grid)) && g.status === "setup") g.grid = Number(b.grid);
  if (b.pattern !== undefined) g.pattern = b.pattern === "full" ? "full" : "line";
  if (b.allowJoin !== undefined) g.allow_join = b.allowJoin ? 1 : 0;
  saveGame(g); broadcast(g); res.json({ ok: true });
});
app.post("/api/games/:code/items", hostAuth, (req, res) => {
  const g = req.game;
  const img = String(req.body?.img || "");
  if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(img)) return res.status(400).json({ error: "Imagem inválida." });
  if (img.length > MAX_IMG_BYTES * 1.4) return res.status(400).json({ error: "Imagem grande demais." });
  if (q.itemsMeta.all(g.id).length >= 120) return res.status(400).json({ error: "Limite de 120 imagens por bingo." });
  const name = clean(req.body?.name, 30) || "Imagem";
  const it = { id: id(), name, ord: q.maxItemOrd.get(g.id).m + 1 };
  q.insertItem.run(it.id, g.id, name, img, it.ord);
  g.items_version++; saveGame(g); broadcast(g); res.json(it);
});
app.patch("/api/games/:code/items/:id", hostAuth, (req, res) => {
  const g = req.game;
  q.renameItem.run(clean(req.body?.name, 30) || "Imagem", req.params.id, g.id);
  g.items_version++; saveGame(g); broadcast(g); res.json({ ok: true });
});
app.delete("/api/games/:code/items/:id", hostAuth, (req, res) => {
  const g = req.game;
  if (g.status !== "setup") return res.status(400).json({ error: "Só é possível excluir imagens na preparação." });
  q.deleteItem.run(req.params.id, g.id);
  g.items_version++; saveGame(g); broadcast(g); res.json({ ok: true });
});
// cartela avulsa criada pelo host (para quem está sem celular)
app.post("/api/games/:code/cards", hostAuth, (req, res) => {
  const g = req.game;
  const itemIds = q.itemsMeta.all(g.id).map((i) => i.id);
  if (itemIds.length < cellsNeeded(g.grid)) return res.status(400).json({ error: `Cadastre pelo menos ${cellsNeeded(g.grid)} imagens.` });
  const qty = Math.min(20, Math.max(1, Number(req.body?.qty) || 1));
  const name = clean(req.body?.player, 30);
  const made = [];
  for (let i = 0; i < qty; i++) made.push(createCard(g, null, name || `Cartela ${q.maxCardN.get(g.id).m + 1}`, itemIds));
  broadcast(g); res.json({ cards: made });
});
app.delete("/api/games/:code/cards/:id", hostAuth, (req, res) => { q.deleteCard.run(req.params.id, req.game.id); cardSigCache.delete(req.game.id); broadcast(req.game); res.json({ ok: true }); });
app.delete("/api/games/:code/players/:id", hostAuth, (req, res) => {
  q.deleteCardsOfPlayer.run(req.params.id, req.game.id); q.deletePlayer.run(req.params.id, req.game.id); cardSigCache.delete(req.game.id);
  broadcast(req.game); res.json({ ok: true });
});
app.post("/api/games/:code/status", hostAuth, (req, res) => {
  const g = req.game, s = req.body?.status;
  if (!["setup", "playing", "finished"].includes(s)) return res.status(400).json({ error: "Status inválido." });
  if (s === "playing") {
    const itemIds = q.itemsMeta.all(g.id).map((i) => i.id);
    if (itemIds.length < cellsNeeded(g.grid)) return res.status(400).json({ error: "Imagens insuficientes para iniciar." });
    // gera a cartela de quem está na sala de espera e fecha a entrada
    const withCard = new Set(q.cards.all(g.id).map((c) => c.player_id).filter(Boolean));
    for (const p of q.players.all(g.id)) if (!withCard.has(p.id)) createCard(g, p.id, p.name, itemIds);
    g.allow_join = 0;
  }
  if (s === "setup") g.allow_join = 1;
  g.status = s; saveGame(g); broadcast(g); res.json({ ok: true });
});
app.post("/api/games/:code/draw", hostAuth, (req, res) => {
  const g = req.game;
  if (g.status !== "playing") return res.status(400).json({ error: "O bingo não está em andamento." });
  const drawn = new Set(g.draws);
  const left = q.itemsMeta.all(g.id).filter((i) => !drawn.has(i.id));
  if (!left.length) return res.status(400).json({ error: "Todas as imagens já foram sorteadas." });
  let pick;
  const chosen = req.body?.itemId;
  if (chosen) { pick = left.find((i) => i.id === chosen); if (!pick) return res.status(400).json({ error: "Essa imagem já saiu ou não existe." }); }
  else pick = left[crypto.randomInt(left.length)]; // aleatoriedade criptográfica, no servidor
  g.draws.push(pick.id);
  evaluateWinners(g);
  saveGame(g); broadcast(g); res.json({ drawn: pick, total: g.draws.length });
});
app.post("/api/games/:code/undo", hostAuth, (req, res) => {
  const g = req.game;
  if (!g.draws.length) return res.status(400).json({ error: "Nada para desfazer." });
  g.draws.pop(); g.winners = g.winners.filter((w) => w.drawIndex <= g.draws.length);
  saveGame(g); broadcast(g); res.json({ ok: true });
});
app.post("/api/games/:code/reset", hostAuth, (req, res) => { const g = req.game; g.draws = []; g.winners = []; saveGame(g); broadcast(g); res.json({ ok: true }); });
app.delete("/api/games/:code", hostAuth, (req, res) => {
  const g = req.game;
  q.deleteItems.run(g.id); q.deleteCards.run(g.id); q.deletePlayers.run(g.id); q.deleteGame.run(g.id); cardSigCache.delete(g.id);
  io.to(`game:${g.code}`).emit("gone"); res.json({ ok: true });
});

app.use("/api", (req, res) => res.status(404).json({ error: "Rota não encontrada." }));
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err?.type === "entity.too.large") return res.status(413).json({ error: "Envio grande demais." });
  res.status(400).json({ error: "Requisição inválida." });
});

// ---------- tempo real ----------
io.on("connection", (socket) => {
  socket.on("watch", (code) => {
    const g = loadGame(code);
    if (!g) return socket.emit("gone");
    for (const room of socket.rooms) if (room.startsWith("game:")) socket.leave(room);
    socket.join(`game:${g.code}`);
    socket.emit("state", publicState(g));
  });
});

server.listen(PORT, () => console.log(`Bingo rodando em http://localhost:${PORT}`));
