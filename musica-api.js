// ═══════════════════════════════════════════════════════════════════
//  musica-api.js — música do app ZEROUN AUTOMED, rodando DENTRO do bot Automed
//  (mesmo servidor/endereço que o app já usa: https://zeroun-selfbots.shardweb.app)
//
//  - Não precisa do index.js do bot de call nem de outro servidor.
//  - Não precisa de ffmpeg. O yt-dlp é baixado sozinho para ./bin/ se não existir no servidor,
//    e se atualiza sozinho a cada 12h.
//
//  COMO LIGAR: no index.js do Automed, logo depois da linha
//      if (await SbRemoto.tratarRequisicao(req, res, u)) return;
//  coloque:
//      if (await require('./musica-api.js').tratar(req, res, u, { validar: (k, d) => { const r = carregarKeys()[String(k || '').trim().toUpperCase()]; return !!r && !keyExpirada(r) && r.appDevice === d; } })) return;
//
//  .env (opcional):
//   MUSICA_FONTE=soundcloud   de onde vem a música: soundcloud (padrão, não pede login) ou youtube
//   YTDLP_EXTRA=--cookies /caminho/cookies.txt   argumentos extras do yt-dlp (cookies, se o YouTube pedir login)
//   YTDLP_BIN=/caminho/yt-dlp                    usar um yt-dlp específico
//   MUSICA_TOKEN=segredo                         (só modo sozinho) token em ?t=
//   MUSICA_PORT=3001                             (só modo sozinho) sobe um servidor próprio
//
//  Rotas:  /musica/ping  /musica/buscar?q=  /musica/preparar?id=  /musica/audio?id=   (+ k=KEY&d=DEVICE)
//  Modo sozinho (teste):  node musica-api.js
// ═══════════════════════════════════════════════════════════════════
try { require("dotenv").config(); } catch (e) {}
const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const TOKEN = process.env.MUSICA_TOKEN || "";
const EXTRA = (process.env.YTDLP_EXTRA || "").split(" ").filter(Boolean);
const PASTA = path.join(__dirname, "musica_cache");
const BIN_DIR = path.join(__dirname, "bin");
const BIN_LOCAL = path.join(BIN_DIR, "yt-dlp");
const FONTE = (process.env.MUSICA_FONTE || "soundcloud").toLowerCase();
const IDRE = /^(?:[A-Za-z0-9_-]{11}|sc_[a-f0-9]{16})$/;
const crypto = require("crypto");
const REG_ARQ = path.join(__dirname, "musica_sc.json");   // id -> {url, thumb} (fora da pasta que é limpa)
let reg = {};
try { reg = JSON.parse(fs.readFileSync(REG_ARQ, "utf8")); } catch (e) {}
let regTimer = null;
function regSalvar() {
  if (regTimer) return;
  regTimer = setTimeout(() => {
    regTimer = null;
    try {
      const ks = Object.keys(reg);
      if (ks.length > 3000) for (const k of ks.slice(0, ks.length - 3000)) delete reg[k];
      fs.writeFileSync(REG_ARQ, JSON.stringify(reg));
    } catch (e) {}
  }, 2000);
  regTimer.unref();
}
const MAX_CACHE_MB = 500;
const MAX_SIMULTANEOS = 2;
fs.mkdirSync(PASTA, { recursive: true });

const log = (m) => console.log("[musica-api] " + m);
const buscas = new Map();
const baixando = new Map();
let fila = 0;
const espera = [];

// ───────────── yt-dlp: usa o do servidor; se não tiver, baixa o binário sozinho ─────────────
let ytBin = null;        // caminho/nome do executável
let ytLocal = false;     // true = baixado por aqui (aí usamos o node como runtime JS e atualizamos sozinho)
let ytPronto = null;

function temNoSistema() {
  try { return spawnSync("yt-dlp", ["--version"], { timeout: 15000 }).status === 0; } catch (e) { return false; }
}

function baixarArquivo(url, destino, vezes = 6) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "zeroun-automed" } }, (r) => {
      if ([301, 302, 303, 307, 308].includes(r.statusCode) && r.headers.location && vezes > 0) {
        r.resume();
        return resolve(baixarArquivo(new URL(r.headers.location, url).toString(), destino, vezes - 1));
      }
      if (r.statusCode !== 200) { r.resume(); return reject(new Error("download HTTP " + r.statusCode)); }
      const tmp = destino + ".tmp";
      const f = fs.createWriteStream(tmp);
      r.pipe(f);
      f.on("finish", () => f.close(() => { fs.renameSync(tmp, destino); resolve(); }));
      f.on("error", reject);
    }).on("error", reject);
  });
}

function prepararYt() {
  if (ytPronto) return ytPronto;
  ytPronto = (async () => {
    if (process.env.YTDLP_BIN) { ytBin = process.env.YTDLP_BIN; return; }
    if (temNoSistema()) { ytBin = "yt-dlp"; return; }
    fs.mkdirSync(BIN_DIR, { recursive: true });
    if (!fs.existsSync(BIN_LOCAL)) {
      const nome = process.arch === "arm64" ? "yt-dlp_linux_aarch64" : "yt-dlp_linux";
      log("yt-dlp não encontrado no servidor, baixando " + nome + "...");
      await baixarArquivo("https://github.com/yt-dlp/yt-dlp/releases/latest/download/" + nome, BIN_LOCAL);
      fs.chmodSync(BIN_LOCAL, 0o755);
      log("yt-dlp baixado.");
    }
    ytBin = BIN_LOCAL; ytLocal = true;
    const atualizar = () => spawn(BIN_LOCAL, ["-U"], { stdio: "ignore" }).on("error", () => {});
    setTimeout(atualizar, 60e3).unref();
    setInterval(atualizar, 12 * 3600e3).unref();
  })().catch((e) => { ytPronto = null; throw e; });
  return ytPronto;
}

async function yt(args, tolerar) {
  await prepararYt();
  const base = ytLocal ? ["--js-runtimes", "node:" + process.execPath] : [];
  return new Promise((resolve, reject) => {
    const p = spawn(ytBin, [...base, ...EXTRA, ...args]);
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", (e) => reject(new Error("yt-dlp não abriu: " + e.message)));
    p.on("close", (code) => (code === 0 || (tolerar && out.trim()) ? resolve(out) : reject(new Error(err.trim().split("\n").pop() || "yt-dlp erro " + code))));
  });
}

// ───────────── SoundCloud direto (rápido: sem abrir o yt-dlp) ─────────────
// Busca na API do SoundCloud (~0,3s) e o áudio vai por redirecionamento direto do CDN (sem baixar nada no servidor).
// Se algo falhar aqui, cai no yt-dlp automaticamente.
const CID_ARQ = path.join(__dirname, "musica_cid.json");
let cid = { v: "", ts: 0 };
try { cid = JSON.parse(fs.readFileSync(CID_ARQ, "utf8")); } catch (e) {}
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const streams = new Map(); // id -> { url, ts }
const sha1 = (t) => crypto.createHash("sha1").update(t).digest("hex");

function web(url, ms = 8000) {
  return fetch(url, { headers: { "User-Agent": UA, Accept: "application/json, text/html, */*" }, signal: AbortSignal.timeout(ms) });
}

async function clientId(forcar) {
  if (!forcar && cid.v && Date.now() - cid.ts < 12 * 3600e3) return cid.v;
  const html = await (await web("https://soundcloud.com/")).text();
  const srcs = [...html.matchAll(/<script[^>]+src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g)].map((m) => m[1]).reverse();
  for (const src of srcs) {
    try {
      const js = await (await web(src, 15000)).text();
      const m = js.match(/client_id\s*:\s*"([0-9a-zA-Z]{32})"/);
      if (m) { cid = { v: m[1], ts: Date.now() }; try { fs.writeFileSync(CID_ARQ, JSON.stringify(cid)); } catch (e) {} return cid.v; }
    } catch (e) {}
  }
  throw new Error("não achei o client_id do SoundCloud");
}

async function scJson(montar) {
  for (let i = 0; i < 2; i++) {
    const r = await web(montar(await clientId(i === 1)));
    if (r.status === 401 || r.status === 403) continue;
    if (!r.ok) throw new Error("SoundCloud HTTP " + r.status);
    return r.json();
  }
  throw new Error("SoundCloud recusou o client_id");
}

async function buscarScRapido(q) {
  const j = await scJson((id) => `https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(q)}&client_id=${id}&limit=15&app_locale=en`);
  let lista = (j.collection || []).filter((t) => t && t.title && t.permalink_url);
  const inteiras = lista.filter((t) => !/^(SNIP|BLOCK)$/.test(t.policy || ""));   // tira prévias de 30s
  if (inteiras.length) lista = inteiras;
  const itens = [];
  for (const t of lista) {
    const dur = Math.round((t.full_duration || t.duration || 0) / 1000);
    if (dur <= 0) continue;
    const id = "sc_" + sha1(t.permalink_url).slice(0, 16);
    const prog = ((t.media && t.media.transcodings) || []).find((x) => x.format && x.format.protocol === "progressive");
    const thumb = String(t.artwork_url || (t.user && t.user.avatar_url) || "").replace(/-(original|large|t500x500)\./, "-t300x300.");
    reg[id] = { url: t.permalink_url, thumb, prog: prog ? prog.url : "", auth: t.track_authorization || "" };
    itens.push({ id, titulo: t.title, artista: (t.user && t.user.username) || "Artista", duracao: dur });
    if (itens.length >= 12) break;
  }
  regSalvar();
  // já deixa o endereço direto dos 3 primeiros pronto: quando o usuário tocar, a música começa na hora
  itens.slice(0, 3).forEach((i) => urlDireta(i.id).catch(() => {}));
  return itens;
}

// endereço direto do mp3 no CDN do SoundCloud (vale ~15 min); null = sem versão direta (usa yt-dlp)
async function urlDireta(id) {
  const c = streams.get(id);
  if (c && Date.now() - c.ts < 15 * 60e3) return c.url;
  const r = reg[id];
  if (!r || !r.prog) return null;
  const j = await scJson((cv) => r.prog + (r.prog.includes("?") ? "&" : "?") + "client_id=" + cv + (r.auth ? "&track_authorization=" + encodeURIComponent(r.auth) : ""));
  if (!j.url) return null;
  streams.set(id, { url: j.url, ts: Date.now() });
  if (streams.size > 500) streams.delete(streams.keys().next().value);
  return j.url;
}
if (FONTE !== "youtube") setTimeout(() => clientId(false).catch(() => {}), 500).unref();

// ───────────── busca ─────────────
function item(j) {
  const dur = Math.round(Number(j.duration) || 0);
  if (!j.title || dur <= 0) return null;
  const artista = String(j.channel || j.uploader || "Artista").replace(/ - Topic$/, "");
  const pagina = j.webpage_url || j.original_url || "";
  if (/soundcloud\.com/i.test(pagina) || /soundcloud/i.test(j.extractor_key || "")) {
    if (!pagina) return null;
    const id = "sc_" + crypto.createHash("sha1").update(pagina).digest("hex").slice(0, 16);
    const thumb = String(j.thumbnail || "").replace(/-(original|large|t500x500)\./, "-t300x300.");
    reg[id] = { url: pagina, thumb }; regSalvar();
    return { id, titulo: j.title, artista, duracao: dur };
  }
  if (!j.id || !/^[A-Za-z0-9_-]{11}$/.test(j.id)) return null;
  return { id: j.id, titulo: j.title, artista, duracao: dur };
}

async function buscar(q) {
  const chave = q.toLowerCase().trim();
  const c = buscas.get(chave);
  if (c && Date.now() - c.ts < 6 * 3600e3) return c.itens;
  const ehLink = /^https?:\/\//i.test(q);
  if (!ehLink && FONTE !== "youtube") {
    try {
      const itens = await buscarScRapido(q);
      if (itens.length) {
        buscas.set(chave, { ts: Date.now(), itens });
        if (buscas.size > 500) buscas.delete(buscas.keys().next().value);
        return itens;
      }
    } catch (e) { log("busca rápida falhou, usando yt-dlp: " + e.message); }
  }
  let saida;
  if (ehLink) saida = await yt(["--no-playlist", "--no-warnings", "--skip-download", "--dump-json", q]);
  else if (FONTE === "youtube") saida = await yt(["--flat-playlist", "--no-warnings", "--dump-json", `ytsearch12:${q}`]);
  else saida = await yt(["--no-warnings", "--ignore-errors", "--skip-download", "--dump-json", `scsearch6:${q}`], true);
  const itens = [];
  for (const linha of saida.split("\n")) {
    if (!linha.trim()) continue;
    try { const i = item(JSON.parse(linha)); if (i && !itens.some((x) => x.id === i.id)) itens.push(i); } catch (e) {}
  }
  if (!itens.length) throw new Error("Não achei nenhuma música com essa busca.");
  buscas.set(chave, { ts: Date.now(), itens });
  if (buscas.size > 500) buscas.delete(buscas.keys().next().value);
  return itens;
}

// ───────────── áudio (sem ffmpeg: pega o m4a pronto; se não houver, o melhor áudio) ─────────────
function achar(id) {
  try {
    const n = fs.readdirSync(PASTA).find((f) => f.startsWith(id + ".") && !/\.(part|ytdl|tmp|temp)$/.test(f));
    return n ? path.join(PASTA, n) : null;
  } catch (e) { return null; }
}

function vaga() {
  if (fila < MAX_SIMULTANEOS) { fila++; return Promise.resolve(); }
  return new Promise((r) => espera.push(r));
}
function liberar() { const prox = espera.shift(); if (prox) prox(); else fila--; }

function garantir(id) {
  if (achar(id)) return Promise.resolve();
  if (baixando.has(id)) return baixando.get(id);
  const p = (async () => {
    await vaga();
    try {
      const sc = id.startsWith("sc_");
      if (sc && !reg[id]) throw new Error("Busque a música de novo.");
      await yt([
        "-f", sc ? "http_mp3_128/bestaudio[ext=mp3]/bestaudio" : "bestaudio[ext=m4a]/bestaudio",
        "--no-playlist", "--no-warnings", "--no-part",
        "-o", path.join(PASTA, id + ".%(ext)s"), sc ? reg[id].url : "https://www.youtube.com/watch?v=" + id,
      ]);
    } finally { liberar(); }
    if (!achar(id)) throw new Error("não consegui gerar o áudio");
  })().finally(() => baixando.delete(id));
  baixando.set(id, p);
  return p;
}

// apaga músicas com mais de 3 dias e mantém a pasta abaixo de MAX_CACHE_MB
setInterval(() => {
  try {
    const arqs = fs.readdirSync(PASTA).map((f) => { const fp = path.join(PASTA, f); const s = fs.statSync(fp); return { fp, t: s.mtimeMs, n: s.size }; });
    for (const a of arqs) if (Date.now() - a.t > 3 * 24 * 3600e3) { fs.unlinkSync(a.fp); a.n = 0; }
    let total = arqs.reduce((s, a) => s + a.n, 0);
    for (const a of arqs.filter((x) => x.n).sort((x, y) => x.t - y.t)) {
      if (total <= MAX_CACHE_MB * 1048576) break;
      fs.unlinkSync(a.fp); total -= a.n;
    }
  } catch (e) {}
}, 3600e3).unref();

function proxy(url, res, vezes = 4) {
  https.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (r) => {
    if ([301, 302, 303, 307, 308].includes(r.statusCode) && r.headers.location && vezes > 0) { r.resume(); return proxy(new URL(r.headers.location, url).toString(), res, vezes - 1); }
    if (r.statusCode !== 200) { r.resume(); res.writeHead(404); return res.end(); }
    res.writeHead(200, { "Content-Type": r.headers["content-type"] || "image/jpeg", "Cache-Control": "public, max-age=86400" });
    r.pipe(res);
  }).on("error", () => { if (!res.headersSent) { res.writeHead(502); } res.end(); });
}

const TIPOS = { m4a: "audio/mp4", mp4: "audio/mp4", webm: "audio/webm", opus: "audio/ogg", ogg: "audio/ogg", mp3: "audio/mpeg" };

function json(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

function enviar(req, res, fp) {
  const tam = fs.statSync(fp).size;
  const tipo = TIPOS[path.extname(fp).slice(1).toLowerCase()] || "application/octet-stream";
  const cab = { "Content-Type": tipo, "Accept-Ranges": "bytes" };
  const r = req.headers.range;
  if (r) {
    const m = /bytes=(\d*)-(\d*)/.exec(r);
    let ini = m && m[1] ? parseInt(m[1], 10) : 0;
    let fim = m && m[2] ? parseInt(m[2], 10) : tam - 1;
    if (fim >= tam) fim = tam - 1;
    if (ini > fim) { res.writeHead(416, { "Content-Range": `bytes */${tam}` }); return res.end(); }
    res.writeHead(206, { ...cab, "Content-Range": `bytes ${ini}-${fim}/${tam}`, "Content-Length": fim - ini + 1 });
    fs.createReadStream(fp, { start: ini, end: fim }).pipe(res);
  } else {
    res.writeHead(200, { ...cab, "Content-Length": tam });
    fs.createReadStream(fp).pipe(res);
  }
}

// ───────────── entrada: devolve true se a requisição era de música (e já respondeu) ─────────────
async function tratar(req, res, u, opcoes = {}) {
  try {
    u = u || new URL(req.url, "http://x");
    if (!u.pathname.startsWith("/musica/")) return false;
    const q = u.searchParams;
    const okKey = typeof opcoes.validar === "function" && opcoes.validar(q.get("k"), q.get("d"));
    const okTok = TOKEN && q.get("t") === TOKEN;
    const protegido = typeof opcoes.validar === "function" || !!TOKEN;
    if (protegido && !okKey && !okTok) { json(res, 401, { ok: false, msg: "Key inválida ou expirada." }); return true; }

    if (u.pathname === "/musica/ping") { json(res, 200, { ok: true }); return true; }

    if (u.pathname === "/musica/buscar") {
      const t = (q.get("q") || "").trim();
      if (!t) { json(res, 400, { ok: false, msg: "busca vazia" }); return true; }
      json(res, 200, { ok: true, itens: await buscar(t) });
      return true;
    }

    if (u.pathname === "/musica/capa") {
      const id = q.get("id") || "";
      if (!IDRE.test(id)) { res.writeHead(400); res.end(); return true; }
      const alvo = id.startsWith("sc_") ? (reg[id] && reg[id].thumb) : "https://i.ytimg.com/vi/" + id + "/mqdefault.jpg";
      if (!alvo) { res.writeHead(404); res.end(); return true; }
      proxy(alvo, res);
      return true;
    }

    if (u.pathname === "/musica/preparar" || u.pathname === "/musica/audio") {
      const id = q.get("id") || "";
      if (!IDRE.test(id)) { json(res, 400, { ok: false, msg: "id inválido" }); return true; }
      if (id.startsWith("sc_")) {
        let direta = null;
        try { direta = await urlDireta(id); } catch (e) { log("direto falhou, usando yt-dlp: " + e.message); }
        if (direta) {
          if (u.pathname === "/musica/preparar") json(res, 200, { ok: true, url: direta });   // o app toca direto do CDN (1 só ida ao servidor)
          else { res.writeHead(302, { Location: direta, "Cache-Control": "no-store" }); res.end(); }
          return true;
        }
      }
      await garantir(id);
      if (u.pathname === "/musica/preparar") { json(res, 200, { ok: true }); return true; }
      enviar(req, res, achar(id));
      return true;
    }
    json(res, 404, { ok: false, msg: "não encontrado" });
  } catch (e) {
    log("erro: " + e.message);
    if (!res.headersSent) json(res, 500, { ok: false, msg: e.message });
    else res.destroy();
  }
  return true;
}

function iniciarSozinho() {
  const porta = Number(process.env.MUSICA_PORT || process.env.PORT || 3001);
  const s = http.createServer(async (req, res) => { if (!(await tratar(req, res))) json(res, 404, { ok: false, msg: "não encontrado" }); });
  s.on("error", (e) => log("não abriu a porta " + porta + ": " + e.message));
  s.listen(porta, "0.0.0.0", () => log("no ar (sozinho) na porta " + porta));
}

module.exports = { tratar, iniciarSozinho };
if (require.main === module) iniciarSozinho();
