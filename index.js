require('dotenv').config();
const dns = require('dns');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');
const { execFile } = require('child_process');
const { URL } = require('url');
// discord.js REAL (v14/v13) para o bot principal (BOT_TOKEN);
// selfbot-v13 SEMPRE para os selfbots (user token).
let Client, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle;
let ModalBuilder, TextInputBuilder, TextInputStyle;
let StringSelectMenuBuilder;
let INTENTS_BOT = null;
let USANDO_DISCORD_JS_REAL = false;
// Components V2 (discord.js >= 14.19): permite colocar os selectmenus/botões DENTRO do card (container).
let ContainerBuilder = null, TextDisplayBuilder = null, SeparatorBuilder = null, SeparatorSpacingSize = null;
let MessageFlagsDJS = null;
let V2_OK = false;
// Os selfbots agora rodam em Python (main.py + discord.py-self).
// O sbremoto.js é a ponte: cria um "sb" que fala com o Python por HTTP.
const SbRemoto = require('./sbremoto.js');
const SelfbotClient = SbRemoto.SbRemoto;
// ============================================================
// antidetecao.js (mínimo): variação leve de texto e classificação de
// erros de verificação de segurança da conta de usuário.
// Sem fingerprint, sem headers de navegador, sem simulação de presença.
// ============================================================
const AD = require('./antidetecao.js');
// ===== Fila global Turbofy: 1 chamada por vez, intervalo entre chamadas, máx. 150/min, pausa em 429 =====
const filaTurbofy = (() => {
  const urgentes = [], criticos = [], leituras = [], envios = [];
  let rodando = false, ultimo = 0, pausaAte = 0;
  const dormir = ms => new Promise(r => setTimeout(r, ms));
  async function loop() {
    if (rodando) return; rodando = true;
    try {
      while (urgentes.length || criticos.length || leituras.length) {
        const item = urgentes.length ? urgentes.shift() : criticos.length ? criticos.shift() : leituras.shift();
        let falta = pausaAte - Date.now(); if (falta > 0) await dormir(falta);
        for (;;) { const t = Date.now(); while (envios.length && t - envios[0] > 60000) envios.shift(); if (envios.length < 150) break; await dormir(envios[0] + 60000 - t + 50); }
        falta = ultimo + 200 + Math.random() * 100 - Date.now(); if (falta > 0) await dormir(falta);
        ultimo = Date.now(); envios.push(ultimo);
        try { item.ok(await Promise.race([item.fn(), dormir(40000).then(() => ({ status: 0, erro: 'timeout da fila Turbofy' }))])); } catch (e) { item.erro(e); }
      }
    } finally { rodando = false; if (urgentes.length || criticos.length || leituras.length) setImmediate(loop); }
  }
  return {
    executar(prio, fn) { return new Promise((ok, erro) => { if (prio !== 'critico' && leituras.length >= 80) { ok({ status: 0, erro: 'fila da Turbofy cheia' }); return; } (prio === 'urgente' ? urgentes : prio === 'critico' ? criticos : leituras).push({ fn, ok, erro }); loop(); }); },
    pausar(ms) { pausaAte = Math.max(pausaAte, Date.now() + ms); }
  };
})();
function extrairSaldoCents(json, unidade) {
  const cand = [];
  const andar = (o, prof) => {
    if (!o || typeof o !== 'object' || prof > 4) return;
    for (const [k, v] of Object.entries(o)) {
      if ((typeof v === 'number' || (typeof v === 'string' && /^-?\d+(?:\.\d+)?$/.test(v))) && /avail|dispon|balance|saldo/i.test(k)) {
        cand.push({ k, v: Number(v), prio: /avail|dispon/i.test(k) ? 0 : 1 });
      } else if (v && typeof v === 'object') andar(v, prof + 1);
    }
  };
  andar(json, 0);
  if (!cand.length) return null;
  cand.sort((a, b) => a.prio - b.prio);
  const { k, v } = cand[0];
  if (!Number.isFinite(v)) return null;
  if (/cents|centavos/i.test(k)) return Math.round(v);
  if (!Number.isInteger(v)) return Math.round(v * 100);
  return String(unidade || 'cents').toLowerCase() === 'reais' ? Math.round(v * 100) : Math.round(v);
}
const ESTILO_BOTAO_V13 = { Primary: 'PRIMARY', Secondary: 'SECONDARY', Success: 'SUCCESS', Danger: 'DANGER', Link: 'LINK' };
const ESTILO_TEXTO_V13 = { Short: 'SHORT', Paragraph: 'PARAGRAPH' };
try {
  const djs = require('discord.js');
  if (djs.GatewayIntentBits && djs.EmbedBuilder) {
    Client = djs.Client;
    EmbedBuilder = djs.EmbedBuilder;
    ActionRowBuilder = djs.ActionRowBuilder;
    ButtonBuilder = djs.ButtonBuilder;
    ButtonStyle = djs.ButtonStyle;
    ModalBuilder = djs.ModalBuilder;
    TextInputBuilder = djs.TextInputBuilder;
    TextInputStyle = djs.TextInputStyle;
    StringSelectMenuBuilder = djs.StringSelectMenuBuilder;
    INTENTS_BOT = [djs.GatewayIntentBits.Guilds, djs.GatewayIntentBits.GuildMembers, djs.GatewayIntentBits.GuildMessages, djs.GatewayIntentBits.MessageContent];
    USANDO_DISCORD_JS_REAL = true;
    MessageFlagsDJS = djs.MessageFlags || null;
    if (djs.ContainerBuilder && djs.TextDisplayBuilder && MessageFlagsDJS && MessageFlagsDJS.IsComponentsV2) {
      ContainerBuilder = djs.ContainerBuilder;
      TextDisplayBuilder = djs.TextDisplayBuilder;
      SeparatorBuilder = djs.SeparatorBuilder || null;
      SeparatorSpacingSize = djs.SeparatorSpacingSize || null;
      V2_OK = true;
    }
  } else if (djs.Intents && djs.Intents.FLAGS && djs.Intents.FLAGS.GUILDS && djs.EmbedBuilder) {
    Client = djs.Client;
    EmbedBuilder = djs.EmbedBuilder;
    ActionRowBuilder = djs.ActionRowBuilder;
    ButtonBuilder = djs.ButtonBuilder;
    ButtonStyle = ESTILO_BOTAO_V13;
    ModalBuilder = djs.Modal;
    TextInputBuilder = djs.TextInputBuilder;
    TextInputStyle = ESTILO_TEXTO_V13;
    StringSelectMenuBuilder = djs.MessageSelectMenu || djs.StringSelectMenu;
    INTENTS_BOT = [djs.Intents.FLAGS.GUILDS, djs.Intents.FLAGS.GUILD_MEMBERS];
    USANDO_DISCORD_JS_REAL = true;
  } else {
    throw new Error('discord.js versão não reconhecida');
  }
} catch {
  const sb = require('discord.js-selfbot-v13');
  Client = sb.Client;
  EmbedBuilder = sb.EmbedBuilder;
  ActionRowBuilder = sb.ActionRowBuilder;
  ButtonBuilder = sb.ButtonBuilder;
  ButtonStyle = ESTILO_BOTAO_V13;
  ModalBuilder = sb.Modal;
  TextInputBuilder = sb.TextInputBuilder;
  TextInputStyle = ESTILO_TEXTO_V13;
  StringSelectMenuBuilder = sb.MessageSelectMenu || sb.StringSelectMenu;
  INTENTS_BOT = null;
}
const { google } = require('googleapis');
try { google.options({ timeout: 20000, agent: new https.Agent({ keepAlive: true, maxSockets: 25 }) }); } catch {}
const Tesseract = require('tesseract.js');
try { dns.setDefaultResultOrder('ipv4first'); } catch {}
// ============================================================
// CONFIGURAÇÕES
// ============================================================
const TENTATIVAS_BUSCA = 108;
const INTERVALO_ENTRE_TENTATIVAS = 1500;
// Se existir um pagamento MENOR desse nome, ainda espera o pagamento completo chegar antes de avisar "parcial"
// (a notificação do banco às vezes chega alguns segundos depois do "pg").
const ESPERA_PAGAMENTO_MENOR_MS = 20000;
// Tempo máximo da busca, mesmo com o Gmail em quota (backoff não pode estender a busca por muito tempo).
const PRAZO_MAXIMO_BUSCA_MS = 180000;
const POLL_GMAIL_MS = 4000;
const SYNC_MIN_INTERVALO_MS = 1200;
const LEITURA_CONCORRENCIA = 10;
const MAX_LEITURA_LOTE = 200;
const OCR_WORKERS = 2;
const MAX_EMAILS_POR_TENTATIVA = 50;
const JANELA_BUSCA_GMAIL_MINUTOS = 90;
const CACHE_LISTA_GMAIL_MS = 1000;
const PALAVRAS_BUSCA_GMAIL = [
  'pix', 'recebido', 'recebida', 'recebimento', 'recebeu', 'transferência', 'transferencia',
  'pagamento', 'pagou', 'comprovante', 'depósito', 'deposito', 'conta', 'valor',
  'abraços', 'abracos', 'inter', 'nubank', '"mercado pago"', 'picpay', 'itaú', 'bradesco',
  'santander', 'caixa', 'c6', 'pagbank', 'sicredi', 'sicoob', 'banco'
];
const BANCOS_EMAIL = [
  'inter', 'nubank', 'nu pagamentos', 'mercado pago', 'picpay', 'itau', 'bradesco', 'santander',
  'caixa', 'banco do brasil', 'c6', 'pagbank', 'pagseguro', 'sicredi', 'sicoob', 'safra',
  'original', 'neon', 'next', 'btg', 'bmg', 'pan', 'will bank', 'stone', 'infinitepay',
  'asaas', 'efi', 'digio', 'banrisul', 'banco', 'pix'
];
const INTERVALO_QUOTA_GMAIL = 10000;
const MAX_BACKOFF_QUOTA_GMAIL = 30000;
const MINUTOS_ANTES = 30;
const MINUTOS_DEPOIS = 5;
const CACHE_MINUTOS = 60;
const COOLDOWN_INSTRUCOES_MS = 10000;
const DELAY_ENTRE_SELBFBOTS_MS = 6000;
const PIX_JANELA_MS = 15 * 60 * 1000;
const PIX_LIMITE_HISTORICO = 50;
const PIX_TENTATIVAS_BUSCA = 3;
const PIX_INTERVALO_BUSCA_MS = 1200;
const ultimaBuscaPixPorCanal = new Map(); // Item 7: máx 1 busca por canal a cada 30s
// ============================================================
// OCR / IMAGENS
// ============================================================
const OCR_IDIOMAS = 'por+eng';
// ============================================================
// CONFIGURAÇÃO GMAIL API
// ============================================================
const SCOPES = ['https://mail.google.com/'];
const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');
const TOKEN_PATH = path.join(__dirname, 'token.json');
const OAUTH_PORT = Number(process.env.OAUTH_PORT) || 3000;
const OAUTH_REDIRECT_URI = process.env.OAUTH_REDIRECT_URI || 'https://zeroun-selfbots.shardweb.app/oauth2callback';
let OAUTH_CAMINHO = '/oauth2callback';
try { OAUTH_CAMINHO = new URL(OAUTH_REDIRECT_URI).pathname || '/oauth2callback'; } catch {}
const estadosGmail = new Map();
function obterEstadoGmail(userId) {
  let e = estadosGmail.get(userId);
  if (!e) {
    e = {
      gmail: null, auth: null, inicializado: false, conexaoPromise: null,
      quotaBloqueadoAte: 0, quotaBackoff: 0,
      cacheListaGmail: { ids: [], timestamp: 0 },
      buscaEmAndamento: null, fila: Promise.resolve()
    };
    estadosGmail.set(userId, e);
  }
  return e;
}
const cacheEmailsPorUsuario = new Map();
const emailsProcessadosPorUsuario = new Map();
const emailsEmUsoPorUsuario = new Map();
const emailsEmAnalisePorUsuario = new Map();
const emailsNaFilaDeExclusaoPorUsuario = new Map();
function mapUsuario(map, userId) {
  let m = map.get(userId);
  if (!m) { m = new Map(); map.set(userId, m); }
  return m;
}
function setUsuario(map, userId) {
  let s = map.get(userId);
  if (!s) { s = new Set(); map.set(userId, s); }
  return s;
}
// ===== Histórico de Pix lidos (aparece na tela "Pix lidos" do app) =====
// Guarda os últimos Pix que o bot leu, de qualquer origem: notificação do celular (app) ou e-mail do Gmail.
const PIX_LIDOS_MAX = 60;
const PIX_LIDOS_ARQ = path.join(__dirname, 'pix_lidos.json');
const pixLidosPorUsuario = new Map();
(function carregarPixLidos() {
  try {
    const o = JSON.parse(fs.readFileSync(PIX_LIDOS_ARQ, 'utf8'));
    for (const [uid, arr] of Object.entries(o || {})) if (Array.isArray(arr)) pixLidosPorUsuario.set(uid, arr.slice(0, PIX_LIDOS_MAX));
  } catch {}
})();
let _salvarPixTimer = null;
function salvarPixLidosSoon() {
  if (_salvarPixTimer) return;
  _salvarPixTimer = setTimeout(() => {
    _salvarPixTimer = null;
    try { fs.writeFileSync(PIX_LIDOS_ARQ, JSON.stringify(Object.fromEntries(pixLidosPorUsuario))); } catch {}
  }, 1500);
}
function registrarPixLido(userId, { uid, nome, valor, origem, fonte, ts }) {
  try {
    const id = String(userId);
    const v = Number(valor);
    if (!Number.isFinite(v) || v <= 0) return;
    let arr = pixLidosPorUsuario.get(id);
    if (!arr) { arr = []; pixLidosPorUsuario.set(id, arr); }
    if (uid && arr.some(x => x.uid === uid)) return;
    arr.unshift({ uid: uid || null, nome: nome || null, valor: v, origem: origem || 'app', fonte: fonte || '', ts: Number(ts) || Date.now() });
    if (arr.length > PIX_LIDOS_MAX) arr.length = PIX_LIDOS_MAX;
    salvarPixLidosSoon();
  } catch {}
}
function listarPixLidos(userId) { return (pixLidosPorUsuario.get(String(userId)) || []).slice(0, PIX_LIDOS_MAX); }
const valorDefinidoEmPorCanal = new Map();
const canaisRecriar = new Set();
const valorEsperadoPorCanal = new Map();
const _setValorOriginal = valorEsperadoPorCanal.set.bind(valorEsperadoPorCanal);
valorEsperadoPorCanal.set = (canalId, valor, ts) => {

  const mudou = valorEsperadoPorCanal.get(canalId) !== valor || !valorDefinidoEmPorCanal.has(canalId);
  if (mudou || Number(ts)) valorDefinidoEmPorCanal.set(canalId, Number(ts) || Date.now());
  const r = _setValorOriginal(canalId, valor);
  estadoSalvar();
  return r;
};
const contadorPagamentosPorCanal = new Map();
const pagamentosPendentesPorCanal = new Map();
const verificacoesAtivas = new Set();
// ============================================================
// PERSISTÊNCIA DE ESTADO: filas, valores por canal e pendências sobrevivem ao reinício.
// ============================================================
const ESTADO_PATH = path.join(__dirname, 'estado.json');
const ESTADO_VALOR_TTL_MS = 24 * 3600 * 1000;      // valor esperado do canal: 24h
const ESTADO_PENDENTE_TTL_MS = 24 * 3600 * 1000;   // pagamento parcial pendente: 24h
let _estadoTimer = null;
function estadoSalvar() {
  clearTimeout(_estadoTimer);
  _estadoTimer = setTimeout(() => {
    try {
      const agora = Date.now();
      const o = { salvoEm: agora, valores: {}, pendentes: {}, botPorCanal: {}, contadores: {} };
      for (const [k, v] of valorEsperadoPorCanal) if (v !== undefined && v !== null) o.valores[String(k)] = { v: Number(v), ts: valorDefinidoEmPorCanal.get(k) || agora };
      for (const [k, v] of pagamentosPendentesPorCanal) if (v && typeof v === 'object') o.pendentes[String(k)] = { ...v, ts: v.ts || agora };
      for (const [k, v] of botPorCanal) o.botPorCanal[String(k)] = String(v);
      for (const [k, v] of contadorPagamentosPorCanal) o.contadores[String(k)] = Number(v) || 0;
      const tmp = `${ESTADO_PATH}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(o));
      fs.renameSync(tmp, ESTADO_PATH);
    } catch (e) { aviso(`Estado: não consegui salvar: ${e.message}`); }
  }, 500);
}
function estadoRestaurar() {
  try {
    if (!fs.existsSync(ESTADO_PATH)) return;
    const j = JSON.parse(fs.readFileSync(ESTADO_PATH, 'utf8'));
    const agora = Date.now();
    let nVal = 0, nPen = 0;
    for (const [k, v] of Object.entries(j.valores || {})) {
      if (!(Number(v && v.v) > 0) || agora - Number(v && v.ts) > ESTADO_VALOR_TTL_MS) continue;
      _setValorOriginal(k, Number(v.v));
      valorDefinidoEmPorCanal.set(k, Number(v && v.ts) || agora);
      nVal++;
    }
    for (const [k, v] of Object.entries(j.pendentes || {})) {
      if (!v || typeof v !== 'object' || agora - Number(v.ts || 0) > ESTADO_PENDENTE_TTL_MS) continue;
      pagamentosPendentesPorCanal.set(k, v);
      nPen++;
    }
    for (const [k, v] of Object.entries(j.botPorCanal || {})) botPorCanal.set(k, v);
    for (const [k, v] of Object.entries(j.contadores || {})) contadorPagamentosPorCanal.set(k, Number(v) || 0);
    if (nVal || nPen) sucesso(`♻️ Estado restaurado após reinício: ${nVal} canal(is) com valor, ${nPen} pagamento(s) pendente(s).`);
  } catch (e) { aviso(`Estado: não consegui restaurar: ${e.message}`); }
}
const _setContador = contadorPagamentosPorCanal.set.bind(contadorPagamentosPorCanal);
contadorPagamentosPorCanal.set = (k, v) => { const r = _setContador(k, v); estadoSalvar(); return r; };
const _setPend = pagamentosPendentesPorCanal.set.bind(pagamentosPendentesPorCanal);
pagamentosPendentesPorCanal.set = (k, v) => { const r = _setPend(k, v); estadoSalvar(); return r; };
const _delPend = pagamentosPendentesPorCanal.delete.bind(pagamentosPendentesPorCanal);
pagamentosPendentesPorCanal.delete = (k) => { const r = _delPend(k); estadoSalvar(); return r; };
// Canais que JÁ receberam instruções/Pix. Salvo em disco: reiniciar o bot NÃO libera o canal para gerar de novo.
// Só .rv e .recriar limpam o registro do canal.
const INSTR_PATH = path.join(__dirname, 'instrucoes_canais.json');
const INSTR_TTL_MS = 24 * 3600 * 1000;
class MapaInstrucoes extends Map {
  constructor() {
    super();
    try {
      const j = JSON.parse(fs.readFileSync(INSTR_PATH, 'utf8'));
      const agora = Date.now();
      for (const [k, v] of Object.entries(j || {})) if (agora - Number(v) < INSTR_TTL_MS) super.set(k, Number(v));
    } catch {}
    this._t = null;
  }
  _salvar() {
    clearTimeout(this._t);
    this._t = setTimeout(() => {
      try {
        const o = {}, agora = Date.now();
        for (const [k, v] of this) if (agora - v < INSTR_TTL_MS) o[k] = v;
        fs.writeFileSync(INSTR_PATH, JSON.stringify(o), { mode: 0o600 });
      } catch {}
    }, 400);
  }
  set(k, v) { super.set(k, v); if (this._t !== undefined) this._salvar(); return this; }
  delete(k) { const r = super.delete(k); if (this._t !== undefined) this._salvar(); return r; }
}
const ultimaInstrucaoPorCanal = new MapaInstrucoes();
// Buscas de pagamento em andamento por canal: evita reprocessar "pg" repetido com o mesmo nome
// enquanto a busca já está rodando. A mensagem "TUDO CERTO" é editada quando o pagamento
// for encontrado / não encontrado.
const buscaAtivaPorCanal = new Map();
const MSG_TUDO_CERTO = '# `🟡` TUDO CERTO, JA SEI SEU NOME, AGORA É SO ESPERA EU ENCONTRAR SEU PAGAMENTO!';
const MSG_JA_VERIFICADO = '# `🟡` JA VERIFIQUEI SEU PAGAMENTO, NAO PRECISA ENVIAR SEU NOME NOVAMENTE!';
const JANELA_JA_VERIFICADO_MS = 10 * 60 * 1000;
const verificadosRecentes = new Map();
const pessoasEmBusca = new Map();
function mesmoNomeExato(a, b) {
  const pa = palavrasDoNome(a).sort().join(' ');
  const pb = palavrasDoNome(b).sort().join(' ');
  return !!pa && pa === pb;
}
function registrarVerificado(userId, nome, canalId) {
  if (!nome) return;
  const l = (verificadosRecentes.get(userId) || []).filter(x => Date.now() - x.ts < JANELA_JA_VERIFICADO_MS);
  l.push({ nome, canalId: String(canalId), ts: Date.now() });
  verificadosRecentes.set(userId, l);
}
function jaVerificadoRecente(userId, nome, canalId) {
  const l = (verificadosRecentes.get(userId) || []).filter(x => Date.now() - x.ts < JANELA_JA_VERIFICADO_MS);
  verificadosRecentes.set(userId, l);
  return l.some(x => x.canalId === String(canalId) &&
    (mesmoNomeExato(nome, x.nome) || nomesCorrespondem(nome, x.nome) || nomesCorrespondem(x.nome, nome)));
}
const MAX_BUSCAS_POR_NOME = 3;
const JANELA_BUSCAS_NOME_MS = 10 * 60 * 1000;
const buscasPorNome = new Map();
// Retorna true se ainda pode buscar (e já conta a tentativa); false se estourou as 3 buscas.
function podeBuscarNome(userId, nome, canalId) {
  const chave = `${userId}|${canalId}|${palavrasDoNome(nome).sort().join(' ')}`;
  const agora = Date.now();
  let r = buscasPorNome.get(chave);
  if (!r || agora - r.ts >= JANELA_BUSCAS_NOME_MS) r = { n: 0, ts: agora };
  if (r.n >= MAX_BUSCAS_POR_NOME) { buscasPorNome.set(chave, r); return false; }
  r.n++;
  buscasPorNome.set(chave, r);
  if (buscasPorNome.size > 500) buscasPorNome.delete(buscasPorNome.keys().next().value);
  return true;
}
function limparVerificadosCanal(userId, canalId) {
  const l = (verificadosRecentes.get(userId) || []).filter(x => x.canalId !== String(canalId));
  verificadosRecentes.set(userId, l);
}
function pessoaEmBusca(userId, nome) {
  return (pessoasEmBusca.get(userId) || []).some(n => nomesCorrespondem(nome, n) || nomesCorrespondem(n, nome));
}
function marcarEmBusca(userId, nome) {
  const l = pessoasEmBusca.get(userId) || [];
  l.push(nome);
  pessoasEmBusca.set(userId, l);
}
function desmarcarEmBusca(userId, nome) {
  const l = pessoasEmBusca.get(userId) || [];
  const i = l.indexOf(nome);
  if (i >= 0) l.splice(i, 1);
  pessoasEmBusca.set(userId, l);
}
function automedAtivoNoServidor(cfg, guildId) {
  if (cfg.salasAutomed === true) return true;
  return Array.isArray(cfg.salasAutomedServidores) && cfg.salasAutomedServidores.includes(String(guildId));
}
// Edita a(s) mensagem(ns) "TUDO CERTO" com o resultado final da busca.
// Se nenhuma mensagem de espera existir (ex.: envio falhou), envia uma nova mensagem.
async function enviarOuEditarEspera(mensagem, nome, conteudo) {
  const canalId = mensagem.channel.id;
  const chaveBusca = `${canalId}|${normalizarNome(nome)}`;
  let registros = buscaAtivaPorCanal.get(chaveBusca);
  let chaveReal = chaveBusca;
  if (!registros) {
    for (const [k, v] of buscaAtivaPorCanal) {
      if (k.startsWith(`${canalId}|`)) { registros = v; chaveReal = k; break; }
    }
  }
  if (registros && registros.length) {
    buscaAtivaPorCanal.delete(chaveReal);
    for (const m of registros) {
      if (m && typeof m.edit === 'function') {
        try {
          if (canalEhSelfbot(mensagem.channel)) await delayEdicao();
          await m.edit(canalEhSelfbot(m.channel) ? AD.variarConteudo(conteudo) : conteudo);
          return;
        } catch (e) { aviso(`Editar mensagem de espera: ${e.message}`); }
      }
    }
  }
  try { await enviarCanal(mensagem.channel, conteudo); } catch {}
}
// ============================================================
// LOCK
// ============================================================
const LOCK_FILE = path.join(__dirname, '.verificador-pagamentos.lock');
let encerrando = false;
function adquirirLock() {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      const pidTexto = fs.readFileSync(LOCK_FILE, 'utf8').trim();
      const pid = Number(pidTexto);
      if (Number.isInteger(pid) && pid > 0 && pid !== process.pid) {
        try {
          process.kill(pid, 0);
          console.error(`\n⚠ Já existe outra instância rodando. PID: ${pid}\n`);
          process.exit(1);
        } catch {
          try { fs.unlinkSync(LOCK_FILE); } catch {}
        }
      } else {
        try { fs.unlinkSync(LOCK_FILE); } catch {}
      }
    }
    fs.writeFileSync(LOCK_FILE, String(process.pid), { flag: 'wx' });
  } catch (e) {
    console.error(`Erro ao criar lock: ${e.message}`);
    process.exit(1);
  }
  const limparLock = () => {
    try {
      if (!fs.existsSync(LOCK_FILE)) return;
      const pidAtual = fs.readFileSync(LOCK_FILE, 'utf8').trim();
      if (pidAtual === String(process.pid)) fs.unlinkSync(LOCK_FILE);
    } catch {}
  };
  process.on('exit', limparLock);
  const encerrar = () => {
    if (encerrando) return;
    encerrando = true;
    limparLock();
    process.exit(0);
  };
  process.on('SIGINT', encerrar);
  process.on('SIGTERM', encerrar);
}
adquirirLock();
process.on('unhandledRejection', (e) => { erro(`Rejeição não tratada: ${e?.message || e}`); });
process.on('uncaughtException', (e) => { erro(`Exceção não capturada: ${e?.message || e}`); });
// ============================================================
// CORES / TERMINAL
// ============================================================
const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', cyan: '\x1b[36m', green: '\x1b[32m',
  yellow: '\x1b[33m', red: '\x1b[31m', magenta: '\x1b[35m', blue: '\x1b[34m',
  gray: '\x1b[90m', white: '\x1b[37m'
};
function linha(tamanho = 62, caractere = '─') { return caractere.repeat(tamanho); }
function iniciarTerminal() {
  console.clear();
  console.log(`${C.cyan}${C.bold}╔${linha(62, '═')}╗`);
  console.log(`║${' '.repeat(62)}║`);
  console.log(`║${' '.repeat(14)}💳 VERIFICADOR DE PAGAMENTOS${' '.repeat(21)}║`);
  console.log(`║${' '.repeat(62)}║`);
  console.log(`╠${linha(62, '═')}╣`);
  console.log(`║  📩 Gmail  •  💰 Pagamentos  •  🖼️ OCR  •  💬 Discord   ║`);
  console.log(`║  ⚡ Verificação rápida e processamento simultâneo       ║`);
  console.log(`╚${linha(62, '═')}╝${C.reset}`);
  console.log('');
}
const LOG_ARQUIVO = path.join(__dirname, 'registro.log');
function identidadeRemetente(canal) {
  const c = canal && canal.client;
  for (const [uid, sb] of selfbots) {
    if (sb === c) return { quem: `Selfbot ${(sb.user && sb.user.username) || ''} (<@${uid}>)`, userId: uid };
  }
  if (c && c.user) return { quem: `Bot ${c.user.username}`, userId: null };
  return { quem: '?', userId: null };
}
function obterNomeConta(userId) { return nomeDaConta(userId); }
function logKey(titulo, rec, extra = []) {
  try {
    logEmbed('seguranca', `🔑 ${titulo}`, [
      ['Key', `\`${rec.chave}\``],
      ['Duração', `${rec.dias} dia(s)`, true],
      ['Usuário', rec.usadaPor ? `<@${rec.usadaPor}>` : 'livre', true],
      ['Restante', restanteDaKey(rec), true],
      ...extra
    ]).catch(logErro);
  } catch {}
}
function logKeysDiario() {
  try {
    const hoje = new Date().toISOString().slice(0, 10);
    const c = carregarConfigs();
    if ((c.__admin || {}).keysDia === hoje) return;
    c.__admin = { ...(c.__admin || {}), keysDia: hoje };
    salvarConfigs(c);
    const todas = Object.values(carregarKeys());
    const ativas = todas.filter(r => r.usadaPor && !keyExpirada(r));
    const linhas = ativas.map(r => `<@${r.usadaPor}> • \`${r.chave.slice(-6)}\` • ${restanteDaKey(r)}`).join('\n') || 'Nenhuma';
    logEmbed('seguranca', '📅 Resumo diário das keys', [
      ['Ativas', String(ativas.length), true],
      ['Livres', String(todas.filter(r => !r.usadaPor).length), true],
      ['Detalhe', linhas.slice(0, 1000)]
    ]).catch(logErro);
  } catch {}
}
function logArquivo(texto) {
  try { fs.appendFileSync(LOG_ARQUIVO, `[${new Date().toISOString()}] ${String(texto)}\n`); } catch {}
}
function info(texto) { logArquivo(`INFO  ${texto}`); console.log(`${C.cyan}│${C.reset} ${texto}`); }
function sucesso(texto) { logArquivo(`OK    ${texto}`); console.log(`${C.green}✓${C.reset} ${C.green}${texto}${C.reset}`); }
function aviso(texto) { logArquivo(`AVISO ${texto}`); console.log(`${C.yellow}⚠${C.reset} ${C.yellow}${texto}${C.reset}`); }
function erro(texto) { logArquivo(`ERRO  ${texto}`); console.log(`${C.red}✗${C.reset} ${C.red}${texto}${C.reset}`); }
function blocoComprovante(dados = {}) {
  const titulo = dados.titulo || 'COMPROVANTE';
  const arquivo = dados.arquivo || 'imagem';
  const status = dados.status || '';
  const nome = dados.nome || 'NÃO IDENTIFICADO';
  const motivo = dados.motivo || '';
  console.log('');
  console.log(`${C.magenta}${C.bold}╭${linha(62)}╮`);
  console.log(`│  🖼️ ${titulo}${' '.repeat(Math.max(1, 62 - 6 - titulo.length))}│`);
  console.log(`├${linha(62)}┤`);
  console.log(`${C.magenta}│${C.reset}  📄 Arquivo : ${arquivo}`);
  console.log(`${C.magenta}│${C.reset}  🔎 OCR     : ${status}`);
  console.log(`${C.magenta}│${C.reset}  👤 Pagador : ${nome}`);
  if (motivo) console.log(`${C.magenta}│${C.reset}  ℹ️ ${motivo}`);
  console.log(`${C.magenta}╰${linha(62)}╯${C.reset}`);
  console.log('');
}
function pagamentoEncontrado(nome, valor, canal) {
  console.log('');
  console.log(`${C.green}${C.bold}╭${linha(62)}╮`);
  console.log(`│  💰 PAGAMENTO ENCONTRADO${' '.repeat(37)}│`);
  console.log(`├${linha(62)}┤`);
  console.log(`│  👤 Pagador : ${nome}`);
  console.log(`│  💵 Valor   : ${formatarValor(valor)}`);
  console.log(`│  📌 Canal   : ${canal}`);
  console.log(`╰${linha(62)}╯${C.reset}`);
  console.log('');
}
function esperar(ms) { return new Promise(r => setTimeout(r, ms)); }
const logsVistos = new Set();
function logUmaVez(chave, fn) {
  if (logsVistos.has(chave)) return;
  logsVistos.add(chave);
  if (logsVistos.size > 800) logsVistos.delete(logsVistos.values().next().value);
  try { fn(); } catch {}
}
function logErro(e) {
  aviso('Erro: ' + String((e && e.message) || e).substring(0, 60));
}
// Delay do selfbot: TOTAL de resposta entre 1s e 3s (máximo 3s), sempre aleatório e
// nunca igual ao anterior. Mensagens seguidas no MESMO canal (ex.: 2º Pix) usam um delay
// curto para a resposta toda não passar de ~3s.
let ultimoDelaySelfbot = 0;
const ultimoEnvioPorCanal = new Map();
function delaySelfbot(min = 1000, max = 2000) {
  let ms;
  do {
    ms = min + Math.floor(Math.random() * (max - min + 1));
  } while (ms === ultimoDelaySelfbot);
  ultimoDelaySelfbot = ms;
  return new Promise(r => setTimeout(r, ms));
}
// Edições de mensagem própria: bem curtas (0,3s–0,8s).
function delayEdicao() { return delaySelfbot(300, 800); }
async function delayDigitando(canal) {
  try { if (canal && typeof canal.sendTyping === 'function') canal.sendTyping().catch(() => {}); } catch {}
  const cid = String((canal && canal.id) || '');
  const seguida = cid && (Date.now() - (ultimoEnvioPorCanal.get(cid) || 0) < 4000);
  await (seguida ? delaySelfbot(400, 900) : delaySelfbot(1000, 2000));
  if (cid) {
    ultimoEnvioPorCanal.set(cid, Date.now());
    if (ultimoEnvioPorCanal.size > 500) ultimoEnvioPorCanal.delete(ultimoEnvioPorCanal.keys().next().value);
  }
}
const antibanCtx = new AsyncLocalStorage();
// ===== /central-antiban: conta VIRTUAL (sem token, sem login). O bot oficial lê os cards e responde =====
const abLivreCtx = new AsyncLocalStorage();
function abLivreCfg(u) { return (u && u.antibanLivre && u.antibanLivre.ativo) ? u.antibanLivre : null; }
function abLivreGuilds(userId) {
  const c = abLivreCfg(carregarUsuarios()[userId]);
  const ativos = antibanLista();
  return c && Array.isArray(c.guilds) ? c.guilds.map(String).filter(g => ativos.includes(g)) : [];
}
function abCriarSbLivre(userId) {
  const EE = require('events');
  const sb = new EE();
  sb.__livre = true;
  sb.user = { id: String(userId), username: `antiban-${userId}`, bot: false };
  Object.defineProperty(sb, 'guilds', { get() {
    const cache = new Map();
    if (botClient) for (const g of abLivreGuilds(userId)) { const x = botClient.guilds.cache.get(g); if (x) cache.set(g, x); }
    return { cache };
  } });
  sb.destroy = () => {};
  sb.login = async () => {};
  if (botClient && botClient.users) botClient.users.fetch(String(userId)).then(u => { if (u) sb.user.username = u.username; }).catch(() => {});
  return sb;
}
function abLivreDespachar(mensagem) {
  const gid = String((mensagem && (mensagem.guildId || (mensagem.guild && mensagem.guild.id))) || '');
  if (!gid || !antibanLista().includes(gid)) return;
  const us = carregarUsuarios();
  for (const uid of Object.keys(us)) {
    const c = abLivreCfg(us[uid]);
    if (!c || !Array.isArray(c.guilds) || !c.guilds.map(String).includes(gid)) continue;
    const sb = selfbots.get(uid);
    if (!sb || !sb.__livre) continue;
    varCtx.run({ guildId: gid }, () => abLivreCtx.run({ uid }, () => { sb.emit('messageCreate', mensagem); }));
  }
}
const antibanCanaisLiberados = new Set();
function antibanLista(_userId) {
  const l = (carregarConfigs().__admin || {}).antibanServidores;
  return Array.isArray(l) ? l.map(String) : [];
}
function antibanAtivo(userId, guildId) {
  return !!userId && !!guildId && antibanLista().includes(String(guildId));
}
function antibanSalvar(lista) {
  const c = carregarConfigs();
  c.__admin = { ...(c.__admin || {}), antibanServidores: lista };
  salvarConfigs(c);
}
const IDS_MEDIADOR_EXTRAS = {
  '1561570716820967496': ['1561092984571830295']
};
function antibanIdsDaConta(userId) {
  const ids = new Set([String(userId)]);
  const sb = selfbots.get(String(userId));
  if (sb && sb.user && sb.user.id) ids.add(String(sb.user.id));
  for (const x of (IDS_MEDIADOR_EXTRAS[String(userId)] || [])) ids.add(String(x));
  return ids;
}
function antibanTextoMsg(m) {
  return textoCompletoMensagem(m);
}
// Extrai o MEDIADOR/ADM do card SOMENTE de rótulos explícitos ("Mediador:", "ADM:", "Admin:",
// "Staff:", "Dono:", "Moderador:", "Árbitro:" etc.). Menção solta (ex.: lista de jogadores)
// NUNCA é aceita como mediador. Tolerante a emojis/ícones (<:nome:id>) entre o rótulo e a menção.
// Suporta rótulo + menção na mesma linha, com até 80 chars entre eles, ou na linha seguinte.
function antibanMediadorDoCard(mensagem) {
  try {
    const texto = antibanTextoMsg(mensagem);
    if (!texto) return null;
    const t = String(texto).replace(/<a?:\w+:\d+>/g, ' ');   // emojis/ícones fora
    const RX_ROTULO = /(?:mediador|med\b|adm\b|admin|administrador|staff|dono|moderador|[aá]rbitro|respons[áa]vel|organizador|supervisor)/i;
    // 1) rótulo + menção na MESMA linha (até 80 chars): "**Mediador:** <:setinh:...> <@id>"
    const m1 = t.match(new RegExp(RX_ROTULO.source + '[^<\\n]{0,80}?<@!?(\\d{15,25})>', 'i'));
    if (m1) return m1[1];
    // 2) rótulo numa linha e a menção na MESMA linha depois dele, ou na linha SEGUINTE.
    // NUNCA remover ">" das linhas (quebraria a menção <@id>).
    const linhas = String(t).split(/\r?\n/).map(l => l.trim());
    for (let i = 0; i < linhas.length; i++) {
      if (!RX_ROTULO.test(linhas[i])) continue;
      const mm = linhas[i].match(/<@!?(\d{15,25})>/);
      if (mm) return mm[1];
      if (i + 1 < linhas.length) {
        const m2 = linhas[i + 1].match(/^<@!?(\d{15,25})>$/);
        if (m2) return m2[1];
        const m3 = linhas[i + 1].match(/<@!?(\d{15,25})>/);
        if (m3) return m3[1];
      }
    }
    // Diagnóstico: card com cara de partida/teste, mas sem mediador legível
    if (/partida confirmada|teste do automed|mediador/i.test(t)) {
      logUmaVez(`med|${Math.floor(Date.now() / 60000)}|${t.slice(0, 160)}`, () => aviso(`[medDiag] sem mediador legível no card: "${t.replace(/\s+/g, ' ').slice(0, 160)}"`));
    }
  } catch (e) { aviso(`[medDiag] erro: ${e.message}`); }
  return null;
}
function donoDoMediador(medId) {
  const m = String(medId);
  const us = carregarUsuarios();
  for (const [uid, u] of Object.entries(us)) {
    if (uid === m || String((u && u.contaId) || '') === m || String((u && u.userIdDetectado) || '') === m) return uid;
  }
  return null;
}
function estadoDonoMediador(medId) {
  const uid = donoDoMediador(medId);
  if (!uid) return `o ID ${medId} NÃO pertence a nenhuma conta cadastrada no bot`;
  const u = carregarUsuarios()[uid] || {};
  const a = statusAcesso(uid);
  return `dono=${uid} • key=${a.ok ? (a.congelada ? 'congelada' : 'ativa') : 'SEM key'} • ligado=${u.ligado === true} • online=${selfbots.has(uid)} • automed=${obterConfigUsuario(uid).automedAtivo !== false}`;
}
function antibanMediadorEhDono(userId, mensagem) {
  const medId = antibanMediadorDoCard(mensagem);
  return !!medId && antibanIdsDaConta(userId).has(String(medId));
}
function antibanCanalLiberado(userId, mensagem) {
  const canalId = String((mensagem && mensagem.channel && mensagem.channel.id) || '');
  if (!canalId) return false;
  const k = `${userId}|${canalId}`;
  // Modo antiban: SÓ responde quando a PRÓPRIA conta é o mediador/adm marcado no card.
  // Menção de jogador nunca conta como mediador. O /teste segue a MESMA regra (marca um mediador).
  const medId = antibanMediadorDoCard(mensagem);
  if (medId) {
    // Card marcando OUTRA conta como mediador: bloqueia SEMPRE (mesmo que o canal já foi liberado antes).
    if (!antibanIdsDaConta(userId).has(String(medId))) return false;
    antibanCanaisLiberados.add(k);
    if (antibanCanaisLiberados.size > 5000) antibanCanaisLiberados.delete(antibanCanaisLiberados.values().next().value);
    return true;
  }
  // Sem rótulo de mediador no card: só libera se o canal já foi liberado para esta conta
  // (ex.: confirmação "pg nome" depois do card, mensagens do próprio fluxo).
  return antibanCanaisLiberados.has(k);
}
async function antibanCanalDoBot(canal) {
  if (!botClient || !canal) return null;
  const id = String(canal.id);
  const c = botClient.channels.cache.get(id) || await botClient.channels.fetch(id).catch(() => null);
  return c && typeof c.send === 'function' ? c : null;
}
function canalEhSelfbot(canal) {
  const u = canal && canal.client && canal.client.user;
  return !!(u && !u.bot);
}
// Edição segura anti-detecção (item 5): delay humano + mínimo 15s entre
// edições da MESMA mensagem. Só para mensagens do selfbot (conta de usuário).
const ultimaEdicaoMsg = new Map();
async function editarMsgSegura(m, conteudo, semVariar = false) {
  if (!m || typeof m.edit !== 'function') return null;
  const canal = m.channel;
  if (canalEhSelfbot(canal)) {
    await delayEdicao();
  }
  return m.edit(canalEhSelfbot(canal) && !semVariar ? AD.variarConteudo(conteudo) : conteudo);
}
function formatarValor(valor) { return `R$ ${Number(valor).toFixed(2).replace('.', ',')}`; }
function valorApenas(valor) { return Number(valor).toFixed(2).replace('.', ','); }
// ============================================================
// MENSAGENS PADRÃO
// ============================================================
const DEFAULT_MSG_CONFIRMADO = [
  '✅ **PAGAMENTO CONFIRMADO!**',
  '',
  '👤 Jogador: `{nome}`',
  '💰 Valor: **R$ {valor}**',
  '',
  '> 🎮 Pagamento validado com sucesso! Boa sorte!!!'
].join('\n');

const DEFAULT_MSG_NAO_ENCONTRADO = [
  '# ❌ PAGAMENTO NÃO ENCONTRADO!',
  '',
  '### ⚠️ VERIFIQUE SE O NOME ESTÁ CORRETO!',
  '',
  '> 💡 **LEMBRE-SE:** NÃO precisa enviar o nome do banco na mensagem do `pg` / `pago` !',
  '',
  '### ✅ COMO RESOLVER:',
  '> 📝 Mande novamente apenas seu **NOME E SOBRENOME** que o BOT irá achar seu pagamento!',
  '',
  '━━━━━━━━━━━━━━━━━━━━━━',
  '🔍 Exemplo correto: `pg João Silva`',
  '❌ Exemplo errado: `pg João Silva Nubank`',
  '━━━━━━━━━━━━━━━━━━━━━━'
].join('\n');

const DEFAULT_MSG_INSTRUCOES = [
  '# 🤖 PAGAMENTOS AUTOMÁTICOS - ZEROUN',
  '',
  '> Para confirmar seu pagamento, basta enviar `pg` ou `pago` + seu nome completo.',
  '',
  '### 💸 COMO CONFIRMAR:',
  '',
  '**✅ JEITO CERTO:**',
  '`pg nome e sobrenome`',
  '`pago nome e sobrenome`',
  '',
  '**❌ JEITO ERRADO:**',
  '`pago` - Faltou o nome',
  '`joão silva` - Faltou o pg/pago',
  '`pago` + nome em outra mensagem - Tem que ser tudo na mesma mensagem',
  '',
  '### ⚠️ ATENÇÃO:',
  '> 🔹 Use o mesmo nome que aparece no banco',
  '> 🔹 Não precisa enviar comprovante',
  '> 🔹 Não precisa enviar o nome do banco',
  '',
  '-# Zeroun Store - A melhor escolha. Sempre em outro nível.'
].join('\n');

const DEFAULT_MSG_PARCIAL = [
  '✅ **PAGAMENTO PARCIAL VERIFICADO**',
  '✅ **ACHEI SEU PAGAMENTO __MAS__ FALTOU R$ `{restante}` MANDE O VALOR E ENVIE NOVAMENTE `PG NOME E SOBRENOME` QUE EU IREI CRIAR A SALA.**'
].join('\n');

const DEFAULT_COMANDO_SALA_NORMAL = '!cs';
const DEFAULT_COMANDO_SALA_INFINITO = '!cs 2';

const TIPOS_SALA = {
  normal: { rotulo: 'Sala normal', emoji: '<:1002682629:1556637954431000606>', descricao: 'Canal/tópico sem nome especial' },
  infinito: { rotulo: 'Sala infinita', emoji: '<:1002682628:1556636937815720017>', descricao: 'Canal/tópico com "infinito" no nome' },
  fullcapa: { rotulo: 'Sala full capa', emoji: '<:1002682629:1556637954431000606>', descricao: 'Canal/tópico com "full capa" no nome' },
  tatico: { rotulo: 'Sala tática', emoji: '<:1002682629:1556637954431000606>', descricao: 'Canal/tópico com "tático" no nome' },
  speed: { rotulo: 'Sala speed', emoji: '<:1002682629:1556637954431000606>', descricao: 'Canal/tópico com "speed" no nome' },
  meet: { rotulo: 'MEET (tela)', emoji: '🎥', descricao: 'Comando enviado quando falarem "tela"' }
};
const DEFAULT_COMANDOS_SALA = {
  
normal: '!cs', infinito: '!cs 2', tatico: '!cs 3', fullcapa: '!cs 4', speed: '!cs 5', meet: '.tela'
};
const TIPOS_MENSAGEM = {
  conf: { campo: 'msgConfirmado', rotulo: 'Pagamento encontrado', emoji: '✅', descricao: 'Enviada quando o pagamento é confirmado', padrao: DEFAULT_MSG_CONFIRMADO, placeholders: '{nome} {valor} {valor_real}' },
  nao: { campo: 'msgNaoEncontrado', rotulo: 'Pagamento não encontrado', emoji: '❌', descricao: 'Quando o pagamento não é encontrado', padrao: DEFAULT_MSG_NAO_ENCONTRADO, placeholders: '{nome} {valor} {valor_real}' },
  parcial: { campo: 'msgParcial', rotulo: 'Pagamento parcial', emoji: '⚠️', descricao: 'Quando o valor pago é menor que o devido', padrao: DEFAULT_MSG_PARCIAL, placeholders: '{nome} {valor} {restante}' },
  instr: { campo: 'msgInstrucoes', rotulo: 'Mensagem de instruções', emoji: '🤖', descricao: 'Texto (e foto opcional) enviado com o valor a pagar', padrao: DEFAULT_MSG_INSTRUCOES, placeholders: '{nome} {valor} {valor_real}' }
};

const DEFAULT_MSG_WIN = '## `🟢` BOA, JA PERCEBI QUE VOCE GANHOU, ENVIE O SEU HISTÓRICO DE WIN, ESPERE 3 MINUTOS MANDE SEU PIX E ME MARQUE 1 VEZ';
TIPOS_MENSAGEM.win = { campo: 'msgWin', rotulo: 'Mensagem de WIN', emoji: '🏆', descricao: 'Quando alguém fala win, ganhei ou gg adm', padrao: DEFAULT_MSG_WIN, placeholders: '{nome}' };
// ============================================================
// VARIANTES DE MENSAGENS — ANTI-DETECÇÃO (adaptado do discord.py-self)
// Cada tipo de mensagem tem VÁRIAS versões diferentes. O bot sorteia
// uma a cada envio e NUNCA repete a última usada — assim o Discord
// não percebe que é um selfbot (mensagem idêntica sempre = script).
// Placeholders funcionam igual: {nome}, {valor}, {restante}, {valor_real}.
// ============================================================
const VARIANTES = {
  confirmado: [
    DEFAULT_MSG_CONFIRMADO,
    [
      '# `🟢` PAGAMENTO VERIFICADO!',
      '',
      '`👤` Jogador: `{nome}`',
      '`💵` Valor: **R$ {valor}**',
      '',
      '> ✅ Tudo certo, pode jogar! Boa sorte!!!'
    ].join('\n'),
    [
      '✅ **PAGAMENTO APROVADO!**',
      '',
      '> 👤 Jogador: `{nome}`',
      '> 💰 Valor: **R$ {valor}**',
      '',
      '🎮 Pagamento validado com sucesso! Aproveite o jogo!'
    ].join('\n'),
    [
      '# `🟢` RECEBI SEU PAGAMENTO!',
      '',
      '### NOME: `{nome}`',
      '### VALOR: **R$ {valor}**',
      '',
      '> ✅ Confirmado, pode entrar na partida!'
    ].join('\n')
  ],
  naoEncontrado: [
    DEFAULT_MSG_NAO_ENCONTRADO,
    [
      '# ❌ NÃO ACHEI SEU PAGAMENTO!',
      '',
      '### ⚠️ VERIFIQUE SE O NOME ESTÁ CORRETO!',
      '',
      '> 📝 Envie novamente **apenas seu NOME E SOBRENOME** com `pg`:',
      '',
      '━━━━━━━━━━━━━━━━━━━━━━',
      '🔍 Exemplo: `pg João Silva`',
      '❌ Não inclua o nome do banco!',
      '━━━━━━━━━━━━━━━━━━━━━━'
    ].join('\n'),
    [
      '# ❌ PAGAMENTO NÃO LOCALIZADO!',
      '',
      '### 🚨 ATENÇÃO!',
      '> Verifique se digitou **nome e sobrenome** corretamente.',
      '',
      '### ✅ COMO RESOLVER:',
      '> Mande novamente: `pg Seu Nome Sobrenome`',
      '> **Sem** o nome do banco, sem abreviações.',
      '',
      '-# Zeroun Store - A melhor escolha.'
    ].join('\n'),
    [
      '# ❌ NÃO ENCONTREI NENHUM PAGAMENTO COM ESSE NOME!',
      '',
      '### ⚠️ Confira:',
      '> 🔹 O nome precisa ser igual ao do banco',
      '> 🔹 Envie `pg` + **nome e sobrenome**',
      '> 🔹 Não precisa enviar comprovante',
      '',
      '### ✅ EXEMPLO CERTO:',
      '> `pg Maria Souza`',
      '',
      '-# Tente novamente, irei procurar de novo!'
    ].join('\n')
  ],
  parcial: [
    DEFAULT_MSG_PARCIAL,
    [
      '✅ **PAGAMENTO PARCIAL ENCONTRADO!**',
      '',
      '> 👤 Jogador: `{nome}`',
      '> 💰 Valor recebido: **R$ {valor}**',
      '> ⚠️ Faltou: **R$ {restante}**',
      '',
      '> 📝 Pague o restante e envie `pg Nome Sobrenome` de novo que eu completo!'
    ].join('\n'),
    [
      '# `🟡` PAGAMENTO INCOMPLETO!',
      '',
      '### 👤 {nome} — recebi **R$ {valor}**',
      '### ❗ Ainda falta **R$ {restante}**',
      '',
      '> 💡 Complete o valor e mande `pg nome e sobrenome` novamente para eu liberar sua sala!'
    ].join('\n')
  ],
  instrucoes: [
    DEFAULT_MSG_INSTRUCOES,
    [
      '# 🤖 PAGAMENTOS AUTOMÁTICOS - ZEROUN',
      '',
      '> Para confirmar seu pagamento, envie `pg` ou `pago` + seu nome completo.',
      '',
      '### 💸 COMO CONFIRMAR:',
      '',
      '**✅ JEITO CERTO:**',
      '`pg nome e sobrenome`',
      '`pago nome e sobrenome`',
      '',
      '**❌ JEITO ERRADO:**',
      '`pago` - Faltou o nome',
      '`joão silva` - Faltou o pg/pago',
      '`pago` + nome em outra mensagem - Tem que ser tudo na mesma mensagem',
      '',
      '### ⚠️ ATENÇÃO:',
      '> 🔹 Use o mesmo nome que aparece no banco',
      '> 🔹 Não precisa enviar comprovante',
      '> 🔹 Não precisa enviar o nome do banco',
      '',
      '-# Zeroun Store - Sempre em outro nível.'
    ].join('\n'),
    [
      '# `🟢` SALA AUTOMÁTICA',
      '',
      '> Para confirmar seu pagamento mande corretamente como as instruções abaixo:',
      '',
      '> ` Pg nome e sobrenome`',
      '> `Pago nome e sobrenome`',
      '',
      '## `🟡` ATENÇÃO',
      '> ENVIE **somente o nome e sobrenome** junto com `pago` ou `pg`.',
      '> Não adicione nome do banco.',
      '',
      '-# ZEROUN APPS - SEMPRE EM OUTRO NÍVEL'
    ].join('\n')
  ],
  win: [
    DEFAULT_MSG_WIN,
    '## `🟢` BOA, VI QUE VOCÊ GANHOU! ENVIE SEU HISTÓRICO DE WIN, AGUARDE 3 MINUTOS, MANDE SEU PIX E ME MARQUE 1 VEZ',
    '## `🟢` PARABÉNS PELA WIN! Manda seu histórico, espera 3 min, envia seu pix e me marca 1 vez!'
  ],
  tudoCerto: [
    MSG_TUDO_CERTO,
    '# `🟡` BELEZA, JA SEI SEU NOME, AGUARDA SÓ UM POUCO QUE EU VOU ACHAR SEU PAGAMENTO!',
    '# `🟡` ANOTEI SEU NOME, AGORA É SÓ ESPERAR EU ENCONTRAR SEU PAGAMENTO!',
    '# `🟡` OK, PEGUEI SEU NOME! SO AGUARDAR EU ACHAR SEU PAGAMENTO AQUI!'
  ],
  jaVerificado: [
    MSG_JA_VERIFICADO,
    '# `🟡` SEU PAGAMENTO JÁ FOI VERIFICADO AGORA MESMO, NAO PRECISA ENVIAR O NOME DE NOVO!',
    '# `🟡` JÁ VERIFIQUEI AGORA, PODE FICAR TRANQUILO!'
  ],
  pgSemNome: [
    [
      '# `🟡` ENVIE `pg` NOME E SOBRENOME, O BOT NÃO ACEITA APENAS `pg`',
      '',
      '## `🚨` IMPORTANTE!!',
      '## NÃO ENVIE O NOME DO BANCO NA MENSAGEM, NÃO PRECISA!'
    ].join('\n'),
    [
      '# `🟡` FALTOU SEU NOME! Envie `pg` + seu nome e sobrenome.',
      '',
      '## `🚨` LEMBRETE:',
      '## SEM nome do banco, só nome e sobrenome!'
    ].join('\n')
  ],
  pixTitulo: [
    (total, valor, n = 1) => total === 1 ? `# 💳 PAGAMENTO — ${valor}` : `# 💳 JOGADOR ${n}/2 — ${valor}`,
    (total, valor, n = 1) => total === 1 ? `# 💳 PIX — ${valor}` : `# 💳 PIX JOGADOR ${n}/2 — ${valor}`,
    (total, valor, n = 1) => total === 1 ? `# 💳 COBRANÇA — ${valor}` : `# 💳 COBRANÇA JOGADOR ${n}/2 — ${valor}`
  ],
  pixCopiaCola: [
    ['**Copia e cola:**', '-# ⚠️ Este código é só do jogador acima. Não pague o código do outro.'],
    ['**Copie e cole:**', '-# ⚠️ Código pessoal e intransferível. Use apenas o seu.'],
    ['**PIX copia e cola:**', '-# ⚠️ Atenção: cada jogador tem seu próprio código. Pague só o seu.'],
    ['**Código copia e cola:**', '-# ⚠️ Este Pix é exclusivo do jogador citado acima.']
  ],
  pago: [
    (rot) => `# \`🟢\`${rot} — PAGO`,
    (rot) => `# \`🟢\`${rot} — PAGAMENTO CONFIRMADO`,
    (rot) => `# \`🟢\`${rot} — PAGO ✅`
  ],
  pagoConfirmadoMsg: [
    (rot, quem, nPag, totalG) => `✅ **${rot} — ${quem} — pagamento confirmado${totalG === 1 ? '' : ` (${nPag}/${totalG})`}.**${''}`,
    (rot, quem, nPag, totalG) => `✅ **${rot} — ${quem} — pagamento recebido com sucesso${totalG === 1 ? '' : ` (${nPag}/${totalG})`}!**${''}`,
    (rot, quem, nPag, totalG) => `🟢 **${rot} — ${quem} — PIX confirmado${totalG === 1 ? '' : ` (${nPag}/${totalG})`}!**${''}`
  ],
  expirado: [
    (rot) => `# ⏰ ${rot} — COPIA E COLA EXPIRADO\n-# Este código expirou.`,
    (rot) => `# ⏰ ${rot} — CÓDIGO EXPIRADO\n-# O prazo acabou, este código não vale mais.`
  ],
  bancoProibido: [
    (ids, extraTxt, i) => `## \`🟢\` BOA! VERIFIQUEI SEU PAGAMENTO!\n### MAS VOCÊ PAGOU COM BANCO PROIBIDO \`😞\` vou gerar mais um pagamento de apenas ${extraTxt} para você pagar <@${ids[i]}>`,
    (ids, extraTxt, i) => `## \`🟢\` ACHEI SEU PAGAMENTO!\n### PORÉM O BANCO USADO É PROIBIDO \`😕\` gerei um Pix extra de só ${extraTxt} — pague e libero a sala <@${ids[i]}>`,
    (ids, extraTxt, i) => `## \`🟢\` VI SEU PAGAMENTO!\n### MAS FOI DE UM BANCO PROIBIDO \`😞\` preciso que pague mais ${extraTxt} (Pix extra) pra liberar a sala <@${ids[i]}>`
  ],
  resumo: [
    (linhas) => `# 🧾 RESUMO DOS PAGAMENTOS\n${linhas}`,
    (linhas) => `# 📋 RESUMO FINAL\n${linhas}`,
    (linhas) => `# ✅ RESUMO DOS PIX\n${linhas}`
  ]
};
// SEMPRE usa a PRIMEIRA (original) de cada conjunto — respostas fixas, sem variação.
function sortearVariante(tipo) {
  const pool = VARIANTES[tipo];
  if (!pool || !pool.length) return null;
  return pool[0];
}
// Para mensagens editáveis (funções): aplica a variante escolhida à função correspondente.
function sortearFuncao(tipo) {
  const f = sortearVariante(tipo);
  return typeof f === 'function' ? f : null;
}
// Respeita mensagem personalizada do usuário; senão usa uma variante.
function obterMensagemVariada(userId, guildId, campo, tipo) {
  const msg = obterMensagem(userId, guildId, campo);
  const padroes = {
    msgConfirmado: DEFAULT_MSG_CONFIRMADO,
    msgNaoEncontrado: DEFAULT_MSG_NAO_ENCONTRADO,
    msgParcial: DEFAULT_MSG_PARCIAL,
    msgInstrucoes: DEFAULT_MSG_INSTRUCOES,
    msgWin: DEFAULT_MSG_WIN
  };
  if (antibanAtivo(userId, guildId)) return msg || padroes[campo] || '';
  if (msg && msg !== (padroes[campo] || '')) return msg; // personalizada: respeita
  const v = sortearVariante(tipo);
  return v || msg || '';
}
const telaEnviadaPorCanal = new Map();
const onRespondidoPorCanal = new Map();
const quantoRespondidoPorCanal = new Map();
const CANAIS_BLOQUEADOS = new Set(['1492908368581492916', '1492939142412370130']);
const winPorCanal = new Map();
const CONFIG_PADRAO = {
  msgWin: DEFAULT_MSG_WIN,
  comandoMeet: '.tela',
  comandoSalaNormal: DEFAULT_COMANDO_SALA_NORMAL,
  comandoSalaInfinito: DEFAULT_COMANDO_SALA_INFINITO,
  comandosSala: {},
  comandosSalaTipo: {},
  msgsServidor: {},
  msgConfirmado: DEFAULT_MSG_CONFIRMADO,
  msgNaoEncontrado: DEFAULT_MSG_NAO_ENCONTRADO,
  msgInstrucoes: DEFAULT_MSG_INSTRUCOES,
  msgParcial: DEFAULT_MSG_PARCIAL,
  imagemInstrucoes: '',
  chavePix: '',
  tolerancia: 0,
  ganhoFila: 0,
  lucro: 0,
  modoSilencioso: false,
  automedAtivo: true,
  valorBancoProibido: 0.10   // extra cobrado de quem paga com Inter / PicPay / Mercado Pago (0 = desativado)
};

const CONFIGS_PATH = path.join(__dirname, 'configs.json');
let configsCache = null;
function carregarConfigs() {
  if (configsCache) return configsCache;
  try {
    if (fs.existsSync(CONFIGS_PATH)) {
      configsCache = JSON.parse(fs.readFileSync(CONFIGS_PATH, 'utf8'));
      return configsCache;
    }
  } catch (e) { aviso(`configs.json corrompido: ${e.message}`); }
  configsCache = {};
  return configsCache;
}
function salvarConfigs(c) {
  configsCache = c;
  fs.writeFileSync(CONFIGS_PATH, JSON.stringify(c, null, 2), { mode: 0o600 });
}
function obterConfigUsuario(userId) {
  const todas = carregarConfigs();
  const doUsuario = todas[userId] || {};
  return { ...CONFIG_PADRAO, ...doUsuario };
}
function salvarConfigUsuario(userId, patch) {
  const todas = carregarConfigs();
  const atual = { ...(todas[userId] || {}) };
  for (const [chave, valor] of Object.entries(patch)) {
    if (valor === null || valor === undefined || String(valor).trim() === '') {
      delete atual[chave];
    } else {
      atual[chave] = valor;
    }
  }
  if (Object.keys(atual).length === 0) delete todas[userId];
  else todas[userId] = atual;
  salvarConfigs(todas);
}
function salvarComandoSalaServidor(userId, guildId, tipo, comando) {
  const todas = carregarConfigs();
  const atual = { ...(todas[userId] || {}) };
  const porServidor = { ...(atual.comandosSala || {}) };
  const doServidor = { ...(porServidor[guildId] || {}) };
  const valor = String(comando || '').trim();
  if (!valor) delete doServidor[tipo];
  else doServidor[tipo] = valor;
  if (Object.keys(doServidor).length === 0) delete porServidor[guildId];
  else porServidor[guildId] = doServidor;
  if (Object.keys(porServidor).length === 0) delete atual.comandosSala;
  else atual.comandosSala = porServidor;
  if (Object.keys(atual).length === 0) delete todas[userId];
  else todas[userId] = atual;
  salvarConfigs(todas);
}
function salvarMensagemServidor(userId, guildId, patch) {
  const todas = carregarConfigs();
  const atual = { ...(todas[userId] || {}) };
  const porServidor = { ...(atual.msgsServidor || {}) };
  const doServidor = { ...(porServidor[guildId] || {}) };
  for (const [campo, valor] of Object.entries(patch)) {
    if (valor === null || valor === undefined || String(valor).trim() === '') delete doServidor[campo];
    else doServidor[campo] = String(valor);
  }
  if (Object.keys(doServidor).length === 0) delete porServidor[guildId];
  else porServidor[guildId] = doServidor;
  if (Object.keys(porServidor).length === 0) delete atual.msgsServidor;
  else atual.msgsServidor = porServidor;
  if (Object.keys(atual).length === 0) delete todas[userId];
  else todas[userId] = atual;
  salvarConfigs(todas);
}
function mensagemGlobalAtiva(userId) {
  const g = (carregarConfigs()[userId] || {}).msgsGlobal;
  return !!(g && Object.keys(g).length);
}
function textoModalGlobal(userId, campo) {
  const g = (carregarConfigs()[userId] || {}).msgsGlobal;
  return g && g[campo] ? String(g[campo]) : '';
}
function salvarMensagemGlobal(userId, patch) {
  const todas = carregarConfigs();
  const atual = { ...(todas[userId] || {}) };
  const g = { ...(atual.msgsGlobal || {}) };
  for (const [campo, valor] of Object.entries(patch)) {
    if (valor === null || valor === undefined || String(valor).trim() === '') delete g[campo];
    else g[campo] = String(valor);
  }
  if (Object.keys(g).length === 0) delete atual.msgsGlobal;
  else atual.msgsGlobal = g;
  if (Object.keys(atual).length === 0) delete todas[userId];
  else todas[userId] = atual;
  salvarConfigs(todas);
}
function msgAdmin(campo) {
  const m = (carregarConfigs().__admin || {}).msgs || {};
  return m[campo] ? String(m[campo]) : '';
}
function salvarMsgAdmin(patch) {
  const todas = carregarConfigs();
  const a = { ...(todas.__admin || {}) };
  const m = { ...(a.msgs || {}) };
  for (const [c, v] of Object.entries(patch)) {
    if (!v || !String(v).trim()) delete m[c];
    else m[c] = String(v);
  }
  a.msgs = m;
  todas.__admin = a;
  salvarConfigs(todas);
}
function obterMensagem(userId, guildId, campo) {
  const doAdmin = msgAdmin(campo);
  if (doAdmin) return doAdmin;
  const bruto = carregarConfigs()[userId] || {};
  const doGlobal = bruto.msgsGlobal && bruto.msgsGlobal[campo];
  if (doGlobal && String(doGlobal).trim()) return String(doGlobal);
  const doServidor = guildId && bruto.msgsServidor && bruto.msgsServidor[guildId]
    ? bruto.msgsServidor[guildId][campo]
    : null;
  if (doServidor && String(doServidor).trim()) return String(doServidor);
  const cfg = obterConfigUsuario(userId);
  return cfg[campo];
}
function textoModalServidor(userId, guildId, campo) {
  const bruto = carregarConfigs()[userId] || {};
  const v = bruto.msgsServidor && bruto.msgsServidor[guildId] ? bruto.msgsServidor[guildId][campo] : '';
  return v ? String(v) : '';
}
function comandoSalaDoServidor(userId, guildId, tipo) {
  const bruto = carregarConfigs()[userId] || {};
  const v = bruto.comandosSala && bruto.comandosSala[guildId] ? bruto.comandosSala[guildId][tipo] : '';
  return v ? String(v) : '';
}
function obterComandoSala(userId, guildId, tipo) {
  const cfg = obterConfigUsuario(userId);
  const doServidor = guildId && cfg.comandosSala && cfg.comandosSala[guildId]
    ? cfg.comandosSala[guildId][tipo]
    : null;
  if (doServidor && String(doServidor).trim()) return String(doServidor).trim();
  const doTipo = cfg.comandosSalaTipo ? cfg.comandosSalaTipo[tipo] : null;
  if (doTipo && String(doTipo).trim()) return String(doTipo).trim();
  if (tipo === 'meet') return cfg.comandoMeet || DEFAULT_COMANDOS_SALA.meet;
  if (tipo === 'normal') return cfg.comandoSalaNormal || DEFAULT_COMANDOS_SALA.normal;
  if (tipo === 'infinito') return cfg.comandoSalaInfinito || DEFAULT_COMANDOS_SALA.infinito;
  return DEFAULT_COMANDOS_SALA[tipo] || DEFAULT_COMANDOS_SALA.normal;
}
function salvarArgSalaServidor(userId, guildId, tipo, arg) {
  const todas = carregarConfigs();
  const atual = { ...(todas[userId] || {}) };
  const porServidor = { ...(atual.comandosSala || {}) };
  const doServidor = { ...(porServidor[guildId] || {}) };
  const valor = String(arg || '').trim();
  if (!valor) delete doServidor[`${tipo}_arg`];
  else doServidor[`${tipo}_arg`] = valor;
  if (Object.keys(doServidor).length === 0) delete porServidor[guildId];
  else porServidor[guildId] = doServidor;
  if (Object.keys(porServidor).length === 0) delete atual.comandosSala;
  else atual.comandosSala = porServidor;
  if (Object.keys(atual).length === 0) delete todas[userId];
  else todas[userId] = atual;
  salvarConfigs(todas);
}
function argSalaDoServidor(userId, guildId, tipo) {
  const bruto = carregarConfigs()[userId] || {};
  const v = bruto.comandosSala && bruto.comandosSala[guildId] ? bruto.comandosSala[guildId][`${tipo}_arg`] : '';
  return v ? String(v) : '';
}
const ONDE_MAX = 8;
const ONDE_POR_PAG = 25;
function ondeConfig(userId, guildId) {
  const o = (carregarConfigs()[userId] || {}).onde;
  const g = (o && o[guildId]) || {};
  return {
    categorias: Array.isArray(g.categorias) ? g.categorias : [],
    canais: Array.isArray(g.canais) ? g.canais : [],
    desativado: g.desativado === true
  };
}
function salvarOnde(userId, guildId, tipo, lista) {
  const todas = carregarConfigs();
  const atual = { ...(todas[userId] || {}) };
  const onde = { ...(atual.onde || {}) };
  const g = { ...(onde[guildId] || {}) };
  const campo = tipo === 'cat' ? 'categorias' : 'canais';
  if (lista.length) g[campo] = lista; else delete g[campo];
  if (Object.keys(g).length === 0) delete onde[guildId]; else onde[guildId] = g;
  if (Object.keys(onde).length === 0) delete atual.onde; else atual.onde = onde;
  if (Object.keys(atual).length === 0) delete todas[userId]; else todas[userId] = atual;
  salvarConfigs(todas);
}
function salvarOndeDesativado(userId, guildId, flag) {
  const todas = carregarConfigs();
  const atual = { ...(todas[userId] || {}) };
  const onde = { ...(atual.onde || {}) };
  const g = { ...(onde[guildId] || {}) };
  if (flag) g.desativado = true; else delete g.desativado;
  if (Object.keys(g).length === 0) delete onde[guildId]; else onde[guildId] = g;
  if (Object.keys(onde).length === 0) delete atual.onde; else atual.onde = onde;
  if (Object.keys(atual).length === 0) delete todas[userId]; else todas[userId] = atual;
  salvarConfigs(todas);
}
// ============================================================
// SÓ RESPONDE EM CANAL COM VALOR DEFINIDO + DESATIVAÇÃO POR INATIVIDADE
// A conta de usuário NÃO fica 24h ativa sozinha: se passar 60 minutos sem
// nenhum canal com valor ativo em nenhum servidor da conta, ela se desativa
// automaticamente (desconecta só a conta; o bot principal/ShardCloud segue rodando). Reativa no painel:
// /central → Gerenciar sistema → Ativar.
// ============================================================
// 0 = nunca desliga por inatividade. Para o comportamento antigo, defina a variável INATIVIDADE_MIN=60
const INATIVIDADE_MS = Number(process.env.INATIVIDADE_MIN || 0) * 60000;
const ultimaAtividadeValorPorUsuario = new Map();
const contasDesativadasInatividade = new Set();
function registrarAtividadeValor(userId) {
  if (userId) {
    ultimaAtividadeValorPorUsuario.set(String(userId), Date.now());
    contasDesativadasInatividade.delete(String(userId));
  }
}
// Desliga SÓ a conta do usuário (desconecta o selfbot e para o Gmail dela).
// O processo principal / ShardCloud continua rodando normalmente.
function desligarContaPorInatividade(id) {
  contasDesativadasInatividade.add(id);
  aviso(`[${id}] Nenhum canal com valor ativo há 60 min — conta DESLIGADA automaticamente (o bot principal continua online). Reative em /central → Gerenciar sistema → Ativar.`);
  try { desligarUsuario(id); } catch (e) { erro(`Desligar [${id}] por inatividade: ${e.message}`); }
  logEvento('geral', `⏸️ Conta desligada automaticamente por inatividade (60 min sem valor ativo). Reative em /central → Gerenciar sistema → Ativar.`, id).catch(logErro);
}
function contaInativaPorUso(userId, guildId) {
  if (INATIVIDADE_MS <= 0) return false;
  const id = String(userId);
  // Antiban ativo neste servidor: quem responde é o bot oficial, então nunca desativa por inatividade.
  if (guildId && antibanAtivo(id, guildId)) return false;
  // Conta /central-antiban (sem token): é virtual, não há o que "poupar" — nunca desliga por inatividade,
  // senão o poller do Gmail para e os pagamentos deixam de ser lidos.
  { const uAb = carregarUsuarios()[id]; if (uAb && !uAb.token && abLivreCfg(uAb)) { contasDesativadasInatividade.delete(id); return false; } }
  if (contasDesativadasInatividade.has(id)) return true;
  const u = carregarUsuarios()[id] || {};
  if (u.ligado !== true) return false;
  const t = ultimaAtividadeValorPorUsuario.get(id) || 0;
  if (!t) {   // conta recém-iniciada (boot): começa a contar agora — NUNCA desliga instantaneamente
    ultimaAtividadeValorPorUsuario.set(id, Date.now());
    return false;
  }
  if (Date.now() - t > INATIVIDADE_MS) {
    desligarContaPorInatividade(id);
    return true;
  }
  return false;
}
// Varredura periódica: desliga a conta mesmo sem chegar mensagem nenhuma.
setInterval(() => {
  try {
    const usuarios = carregarUsuarios();
    for (const id of Object.keys(usuarios)) {
      if (usuarios[id].ligado !== true) continue;
      if (!ultimaAtividadeValorPorUsuario.has(id)) {       // conta ligada sem registro: começa a contar agora
        ultimaAtividadeValorPorUsuario.set(id, Date.now());
        continue;
      }
      contaInativaPorUso(id);
    }
  } catch (e) { logErro(e); }
}, 60 * 1000);
// Servidor desativado = não responde. Só responde em canal que tenha valor definido.
// Canal/categoria selecionado vale também para os tópicos do canal e canais da categoria.
function podeResponderAqui(userId, mensagem) {
  const guildId = guildIdDaMensagem(mensagem);
  if (contaInativaPorUso(userId, guildId)) return false;
  if (!guildId) return false;
  const canal = mensagem.channel;
  if (!canal) return false;
  if (!valorEsperadoPorCanal.has(canal.id)) {
    let define = false;
    try {
      define = !!extrairValorConta(mensagem, userId);
      if (!define) {
        const chaveP = String(obterConfigUsuario(userId).chavePix || '').trim();
        define = !!chaveP && textoContemChavePix(extrairTextoComEmbeds(mensagem), chaveP);
      }
    } catch {}
    if (!define) {
      try {
        if (mensagem.author && mensagem.author.bot) {
          const visto = textoLinhasMensagem(mensagem).join(' | ');
          const k = `diag|${mensagem.id}`;
          if (/aposta|taxa de sala|valor/i.test(visto) && !ultimaBuscaPixPorCanal.get(k)) {
            ultimaBuscaPixPorCanal.set(k, Date.now());
            aviso(`[${userId}] [diag] motivo: ${MOTIVO_VALOR.v} • canal=#${canal.name} guild=${guildId} • card com Aposta/Taxa/Valor, mas valor NÃO lido. components=${(mensagem.components || []).length} embeds=${(mensagem.embeds || []).length} texto="${visto.slice(0, 400)}"`);
          }
        }
      } catch {}
      return false;
    }
  }
  const c = ondeConfig(userId, guildId);
  if (c.desativado) return false;
  // Sem canais/categorias configurados: vale o critério de "tem valor definido" acima.
  if (!c.categorias.length && !c.canais.length) return true;
  const guild = mensagem.guild || (canal && canal.guild);
  const buscar = id => (id && guild && guild.channels ? guild.channels.cache.get(String(id)) : null);
  const ids = new Set();
  let atualCanal = canal;
  for (let i = 0; i < 3 && atualCanal; i++) {
    ids.add(String(atualCanal.id));
    atualCanal = atualCanal.parent || buscar(atualCanal.parentId);
  }
  const liberado = c.canais.some(x => ids.has(x)) || c.categorias.some(x => ids.has(x));
  if (!liberado) {
    try {
      const kO = `onde|${userId}|${canal.id}`;
      if (Date.now() - (ultimaBuscaPixPorCanal.get(kO) || 0) > 60000) {
        ultimaBuscaPixPorCanal.set(kO, Date.now());
        aviso(`[${userId}] Card LIDO, mas BLOQUEADO por "Onde responder": canal=#${canal.name} (${canal.id}) categoria=${canal.parentId || 'nenhuma'} • liberados: canais=[${c.canais.join(',')}] categorias=[${c.categorias.join(',')}]. Libere esta categoria/canal ou limpe "Onde responder" deste servidor no painel.`);
      }
    } catch {}
  }
  return liberado;
}
function canaisDoServidor(userId, guildId, tipo) {
  const sb = selfbots.get(userId);
  const g = sb && sb.guilds && sb.guilds.cache.get(String(guildId));
  if (!g) return [];
  const CATS = ['GUILD_CATEGORY', 'CATEGORY', '4'];
  const TXT = ['GUILD_TEXT', 'GUILD_NEWS', 'GUILD_ANNOUNCEMENT', 'TEXT', 'NEWS', '0', '5'];
  const lista = tipo === 'cat' ? CATS : TXT;
  return Array.from(g.channels.cache.values())
    .filter(c => lista.includes(String(c.type)))
    .sort((a, b) => ((a.parent ? a.parent.rawPosition : -1) - (b.parent ? b.parent.rawPosition : -1)) ||
      ((a.rawPosition || 0) - (b.rawPosition || 0)))
    .map(c => ({ id: String(c.id), nome: String(c.name || c.id), cat: c.parent ? String(c.parent.name) : '' }));
}
function ondePagina(userId, guildId, tipo, pag, escopo = '') {
  const todosBrutos = canaisDoServidor(userId, guildId, tipo);
  const todos = escopo ? buscaFiltrar(todosBrutos, buscaTermo(userId, escopo), c => `${c.nome} ${c.cat}`) : todosBrutos;
  const paginas = Math.max(1, Math.ceil(todos.length / ONDE_POR_PAG));
  const p = Math.min(Math.max(0, Number(pag) || 0), paginas - 1);
  return { itens: todos.slice(p * ONDE_POR_PAG, (p + 1) * ONDE_POR_PAG), pag: p, paginas, total: todos.length, totalGeral: todosBrutos.length };
}
function aplicarPlaceholders(texto, dados = {}) {
  let t = String(texto || '');
  const nome = String(dados.nome ?? '');
  const vNum = valorApenas(dados.valor ?? 0);
  const vReal = `R$ ${vNum}`;
  t = t.replace(/\{nome\}/gi, nome);
  t = t.replace(/\{restante\}/gi, valorApenas(dados.restante ?? 0));
  t = t.replace(/\{valor_real\}/gi, vReal).replace(/\{valorbr\}/gi, vReal).replace(/\{valor_reais\}/gi, vReal);
  t = t.replace(/\{valor\}/gi, vNum);
  return t;
}
// ============================================================
function normalizarNumero(valor) {
  if (valor === null || valor === undefined) return null;
  let texto = String(valor).trim().replace(/\s/g, '').replace(/R\$/gi, '').replace(/\$/g, '');
  texto = texto.replace(/^[.,]+|[.,]+$/g, '');
  if (!texto) return null;
  if (texto.includes('.') && texto.includes(',')) {
    texto = texto.replace(/\./g, '').replace(',', '.');
  } else if (texto.includes(',')) {
    texto = texto.replace(',', '.');
  }
  const numero = Number(texto);
  if (!Number.isFinite(numero)) return null;
  return Number(numero.toFixed(2));
}
const ENTIDADES_HTML = {
  nbsp: ' ', amp: '&', lt: '<', gt: ' ', quot: '"', apos: "'",
  aacute: 'á', agrave: 'à', acirc: 'â', atilde: 'ã', auml: 'ä',
  eacute: 'é', egrave: 'è', ecirc: 'ê', iacute: 'í', icirc: 'î',
  oacute: 'ó', ocirc: 'ô', otilde: 'õ', uacute: 'ú', ucirc: 'û', ccedil: 'ç',
  Aacute: 'Á', Agrave: 'À', Acirc: 'Â', Atilde: 'Ã', Eacute: 'É', Ecirc: 'Ê',
  Iacute: 'Í', Oacute: 'Ó', Ocirc: 'Ô', Otilde: 'Õ', Uacute: 'Ú', Ccedil: 'Ç'
};
function decodificarEntidadesHtml(texto) {
  return String(texto || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return ' '; } })
    .replace(/&#(\d+);/g, (_, d) => { try { return String.fromCodePoint(parseInt(d, 10)); } catch { return ' '; } })
    .replace(/&([a-zA-Z]+);/g, (m, n) => (n in ENTIDADES_HTML ? ENTIDADES_HTML[n] : m));
}
function limparTexto(texto) {
  return decodificarEntidadesHtml(String(texto || '')
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' '))
    .replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\u00A0/g, ' ')
    .replace(/\u202F/g, ' ').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function decodificarBase64Url(valor) {
  if (!valor) return '';
  try {
    let texto = String(valor).replace(/-/g, '+').replace(/_/g, '/');
    while (texto.length % 4 !== 0) texto += '=';
    return Buffer.from(texto, 'base64').toString('utf8');
  } catch { return ''; }
}
function normalizarNome(nome) {
  return limparTexto(nome).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}
// Gatilhos com menção (<@id>): o limparTexto apaga <...> como se fosse HTML, então converte antes.
function normalizarGatilho(t) {
  return normalizarNome(String(t || '').replace(/<@[!&]?(\d+)>/g, ' mencao$1 '));
}
const PALAVRAS_IGNORADAS_NOME = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);
function palavrasDoNome(nome) {
  return normalizarNome(nome).split(' ')
    .filter(p => p.length >= 2 && !PALAVRAS_IGNORADAS_NOME.has(p));
}
function pareceUuidOuCodigo(texto) {
  const s = String(texto || '');
  if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(s)) return true;
  if (/\b[0-9a-f]{32}\b/i.test(s)) return true;
  if (/[0-9a-f]{8}-[0-9a-f]{4}-/i.test(s)) return true;
  return false;
}
function nomeEhPessoa(nome) {
  const bruto = String(nome || '');
  if (!bruto.trim()) return false;
  if (bruto.includes('@')) return false;
  if (pareceUuidOuCodigo(bruto)) return false;
  const palavras = normalizarNome(bruto).split(' ').filter(Boolean);
  if (!palavras.length) return false;
  if (palavras.some(p => /\d/.test(p))) return false;
  return true;
}
function nomeValidoParaBusca(nome) {
  if (!nomeEhPessoa(nome)) return false;
  const pal = palavrasDoNome(nome);
  return pal.length >= 2 && pal.join('').length >= 5;
}
// TODAS as palavras do nome digitado precisam estar no nome do pagador.
function nomesCorrespondem(nomeComando, nomeEmail) {
  const pa = palavrasDoNome(nomeComando);
  const pb = palavrasDoNome(nomeEmail);
  if (pa.length < 2 || !pb.length) return false;
  return pa.every(p => pb.includes(p));
}
const ROTULOS_PAGADOR = [
  'quem pagou', 'quem enviou', 'pagador', 'remetente', 'enviado por', 'recebido de',
  'recebida de', 'recebeu um pix de', 'recebeu uma transferencia de', 'pix de',
  'transferencia de', 'pagamento de', 'nome do pagador', 'origem'
];
function nomeCompletoNoContexto(nomeDigitado, textoNorm) {
  const pa = palavrasDoNome(nomeDigitado);
  if (pa.length < 2 || !textoNorm) return null;
  for (const rotulo of ROTULOS_PAGADOR) {
    let pos = textoNorm.indexOf(rotulo);
    while (pos !== -1) {
      let janela = textoNorm.slice(pos + rotulo.length, pos + rotulo.length + 70).split(' ').filter(Boolean);
      if (janela[0] === 'nome') janela = janela.slice(1);
      const fim = janela.findIndex(w => ['cpf', 'cnpj', 'valor', 'data', 'hora', 'chave', 'instituicao', 'banco', 'id', 'nome'].includes(w));
      const palavras = fim === -1 ? janela : janela.slice(0, fim);
      if (pa.every(p => palavras.includes(p))) {
        return palavras.map(w => (PALAVRAS_IGNORADAS_NOME.has(w) ? w : w[0].toUpperCase() + w.slice(1))).join(' ');
      }
      pos = textoNorm.indexOf(rotulo, pos + 1);
    }
  }
  return null;
}
function nomePagadorGenerico(textoNorm) {
  if (!textoNorm) return null;
  for (const rotulo of ROTULOS_PAGADOR) {
    let pos = textoNorm.indexOf(rotulo);
    while (pos !== -1) {
      let janela = textoNorm.slice(pos + rotulo.length, pos + rotulo.length + 70).split(' ').filter(Boolean);
      if (janela[0] === 'nome') janela = janela.slice(1);
      const fim = janela.findIndex(w => ['cpf', 'cnpj', 'valor', 'data', 'hora', 'chave', 'instituicao', 'banco', 'id', 'nome', 'tipo', 'documento'].includes(w));
      const palavras = (fim === -1 ? janela : janela.slice(0, fim)).filter(w => !/\d/.test(w));
      if (palavras.length >= 2 && palavras.length <= 7) {
        const nome = palavras.map(w => (PALAVRAS_IGNORADAS_NOME.has(w) ? w : w[0].toUpperCase() + w.slice(1))).join(' ');
        if (nomeExtraidoSeguro(nome)) return nome;
      }
      pos = textoNorm.indexOf(rotulo, pos + 1);
    }
  }
  return null;
}
function nomeApareceNoTexto(nomeDigitado, textoNorm) {
  return nomeCompletoNoContexto(nomeDigitado, textoNorm) !== null;
}
function textoTemBanco(textoNorm) {
  if (!textoNorm) return false;
  const padded = ` ${textoNorm} `;
  return BANCOS_EMAIL.some(b => padded.includes(` ${b} `));
}
function extrairNomePagador(texto) {
  const conteudo = limparTexto(texto);
  const padroes = [
    /você\s+recebeu\s+(?:uma\s+)?transferência\s+de\s+(.+?)(?=\s+(?:e\s+o\s+valor|no\s+valor|no\s+valor\s+de|valor\s+de|foi|em\s+\d{1,2}[\/\-])|[.,;]|$)/i,
    /voce\s+recebeu\s+(?:uma\s+)?transferencia\s+de\s+(.+?)(?=\s+(?:e\s+o\s+valor|no\s+valor|no\s+valor\s+de|valor\s+de|foi|em\s+\d{1,2}[\/\-])|[.,;]|$)/i,
    /você\s+recebeu\s+(?:um\s+)?pix\s+de\s+(.+?)(?=\s+(?:e\s+o\s+valor|no\s+valor|no\s+valor\s+de|valor\s+de|foi|em\s+\d{1,2}[\/\-])|[.,;]|$)/i,
    /voce\s+recebeu\s+(?:um\s+)?pix\s+de\s+(.+?)(?=\s+(?:e\s+o\s+valor|no\s+valor|no\s+valor\s+de|valor\s+de|foi|em\s+\d{1,2}[\/\-])|[.,;]|$)/i,
    /recebeu\s+um\s+pix\s+de\s+(.+?)(?=\s+(?:e\s+o\s+valor|no\s+valor|no\s+valor\s+de|valor\s+de|foi)|[.,;]|$)/i,
    /pix\s+recebido\s+de\s+(.+?)(?=\s+(?:e\s+o\s+valor|no\s+valor|valor\s+de|foi)|[.,;]|$)/i,
    /pix\s+(?:recebido|recebida)\s*[:\-]?\s*(?:de\s+)?(.+?)(?=\s+(?:valor|data|hora|em)\b|[.,;]|$)/i,
    /transferência\s+recebida\s+de\s+(.+?)(?=\s+(?:e\s+o\s+valor|no\s+valor|valor\s+de|foi)|[.,;]|$)/i,
    /transferencia\s+recebida\s+de\s+(.+?)(?=\s+(?:e\s+o\s+valor|no\s+valor|valor\s+de|foi)|[.,;]|$)/i,
    /pagamento\s+recebido\s+de\s+(.+?)(?=\s+(?:e\s+o\s+valor|no\s+valor|valor\s+de|foi)|[.,;]|$)/i,
    /dinheiro\s+recebido\s+de\s+(.+?)(?=\s+(?:e\s+o\s+valor|no\s+valor|valor\s+de|foi)|[.,;]|$)/i,
    /quem\s+pagou\s*[:\-]?\s*(.+?)(?=\s+(?:valor|data|hora|cpf|cnpj|chave|institui[cç][aã]o|banco)\b|[.,;]|$)/i,
    /quem\s+enviou\s*[:\-]?\s*(.+?)(?=\s+(?:valor|data|hora|cpf|cnpj|chave)\b|[.,;]|$)/i,
    /pagamento\s+de\s+(.+?)(?=\s+(?:valor|data|hora|no\s+valor|em\s+\d{1,2}[\/\-])|[.,;]|$)/i,
    /nome\s+(?:do\s+)?(?:pagador|remetente|quem\s+pagou)\s*[:\-]?\s*(.+?)(?=\s+(?:cpf|cnpj|chave|valor|data|hora)\b|$)/i,
    /(?:remetente|pagador|cliente|origem)\s*[:\-]\s*(.+?)(?=\s+(?:valor|data|hora|cpf|cnpj|chave)\b|$)/i
  ];
  for (const regex of padroes) {
    const match = conteudo.match(regex);
    if (!match) continue;
    let nome = limparTexto(match[1]);
    nome = nome
      .replace(/^nome\s*[:\-]?\s*/i, '')
      .replace(/\s+e\s+o\s+valor.*$/i, '').replace(/\s+já\s+está.*$/i, '')
      .replace(/\s+ja\s+esta.*$/i, '')
      .replace(/\s+(?:valor|data|hora|cpf|cnpj|chave)\s*:?.*$/i, '')
      .replace(/[.,;:]+$/, '').trim();
    if (nome && nome.length >= 2 && !nome.includes('@') && !/^chave\b/i.test(nome) &&
        !/\d/.test(nome) && !/R\$/i.test(nome) &&
        !/^(?:valor|data|hora|cpf|cnpj|nome|banco|institui|id)\b/i.test(nome)) {
      return nome;
    }
  }
  return null;
}
function extrairValorPagamento(texto) {
  const conteudo = limparTexto(texto);
  const DEC = '(\\d{1,3}(?:\\.\\d{3})+,\\d{2}|\\d+[.,]\\d{2})';
  const RS = '(?:R\\$\\s*|BRL\\s*)*';
  const padroes = [
    new RegExp('valor[^\\d]{0,40}?' + RS + DEC, 'i'),
    new RegExp('(?:recebeu|recebid[oa]|recebimento|creditad[oa]|depositad[oa]|dispon[ií]vel)[^\\d]{0,60}?' + RS + DEC, 'i'),
    new RegExp('(?:R\\$|BRL)\\s*' + RS + DEC, 'i'),
    new RegExp(DEC + '\\s*(?:reais|real|BRL)', 'i'),
    new RegExp('conta[^\\d]{0,40}?' + RS + DEC, 'i'),
    /(?<![\d.,/*-])(\d{1,3}(?:\.\d{3})+,\d{2}|\d+[.,]\d{2})(?![\d/*-])/,
    /(?:R\$|BRL)\s*(?:R\$\s*)*(\d{1,6})(?![\d,.])/i
  ];
  for (const regex of padroes) {
    const match = conteudo.match(regex);
    if (!match) continue;
    const valor = normalizarNumero(match[1]);
    if (valor !== null && valor > 0) return valor;
  }
  return null;
}
const BANCOS_SUFIXO = ['banco do brasil', 'banco inter', 'mercado pago', 'mercadopago', 'nubank', 'picpay',
  'itau', 'bradesco', 'santander', 'caixa', 'c6', 'pagbank', 'pagseguro', 'neon', 'sicoob', 'sicredi', 'safra', 'inter'];
function removerBancoDoFim(nome) {
  let atual = limparTexto(nome);
  let mudou = true;
  while (mudou) {
    mudou = false;
    const n = normalizarNome(atual);
    for (const b of BANCOS_SUFIXO) {
      if (!n.endsWith(' ' + b)) continue;
      const toks = atual.split(/\s+/);
      const qtd = b.split(' ').length;
      if (toks.length - qtd >= 2) {
        atual = toks.slice(0, toks.length - qtd).join(' ');
        mudou = true;
        break;
      }
    }
  }
  return atual;
}
const PALAVRAS_NAO_NOME_PG = new Set([
  'pg', 'pago', 'paga', 'paguei', 'pagou', 'pagamento', 'pix', 'feito', 'feita', 'ja', 'ok', 'okay', 'sim',
  'ta', 'pronto', 'enviado', 'enviei', 'mandei', 'fiz', 'agora', 'aqui', 'ae', 'confirma', 'confirmado',
  'verifica', 'verificar', 'confere', 'conferir', 'comprovante', 'banco', 'por', 'favor', 'pfv', 'pf',
  'obrigado', 'obrigada', 'vlw', 'valeu', 'ss', 'kk', 'kkk', 'kkkk'
]);
function limparNomePg(nome) {
  let t = String(nome || '')
    .replace(/<a?:\w+:\d+>/g, ' ')
    .replace(/<[@#&!][^>]*>/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ');
  t = limparTexto(t);
  const toks = t.split(/\s+/).filter(tok => {
    const n = normalizarNome(tok);
    return n && !PALAVRAS_NAO_NOME_PG.has(n);
  });
  const resultado = removerBancoDoFim(toks.join(' '));
  return nomeEhPessoa(resultado) ? resultado : '';
}
function extrairDadosPg(texto) {
  const conteudo = limparTexto(texto).replace(/`/g, '').trim();
  if (!conteudo) return null;
  if (/^(?:pg|pago)[\s.!]*$/i.test(conteudo)) return { nome: '', tipo: 'pagamento', semNome: true };
  let match = conteudo.match(/^(?:pg|pago)\s+(.+)$/i);
  if (match) {
    const nome = limparNomePg(match[1]);
    if (nome) return { nome, tipo: 'pagamento' };
    return { nome: '', tipo: 'pagamento', semNome: true };
  }
  match = conteudo.match(/^(.+?)\s+(?:pg|pago)$/i);
  if (match) {
    const nome = limparNomePg(match[1]);
    if (nome) return { nome, tipo: 'pagamento' };
  }
  return null;
}
async function baixarImagem(urlImagem) {
  const resposta = await httpNatural(urlImagem, {
    headers: {
      'User-Agent': httpUAAleatorio(),
      'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      'Accept-Language': HTTP_ACCEPT_LANG,
      'Referer': 'https://discord.com/'
    },
    signal: AbortSignal.timeout(15000)
  }, 3);
  if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
  return Buffer.from(await resposta.arrayBuffer());
}
const ocrWorkers = [];
function obterOCRWorkerDoPool() {
  const todosOcupados = ocrWorkers.every(w => w.ocupados > 0);
  if (ocrWorkers.length < OCR_WORKERS && todosOcupados) {
    const w = { ocupados: 0, promise: null };
    w.promise = Tesseract.createWorker(OCR_IDIOMAS, 1, { logger: () => {} })
      .then(async worker => {
        try {
          if (typeof worker.setParameters === 'function') {
            await worker.setParameters({ preserve_interword_spaces: '1' });
          }
        } catch {}
        return worker;
      })
      .catch(e => {
        const i = ocrWorkers.indexOf(w);
        if (i >= 0) ocrWorkers.splice(i, 1);
        throw e;
      });
    ocrWorkers.push(w);
    return w;
  }
  return ocrWorkers.reduce((a, b) => (b.ocupados < a.ocupados ? b : a));
}
async function extrairTextoImagem(buffer) {
  const w = obterOCRWorkerDoPool();
  w.ocupados++;
  try {
    const worker = await w.promise;
    const resultado = await worker.recognize(buffer);
    return String(resultado?.data?.text || '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
  } finally {
    w.ocupados--;
  }
}
function identificarComprovante(texto) {
  const conteudo = normalizarNome(texto);
  if (!conteudo) return false;
  const indicadores = [
    'pix', 'comprovante', 'transferencia', 'transferencia realizada',
    'transferencia recebida', 'pagamento', 'pagamento realizado',
    'pagamento recebido', 'valor', 'recebido', 'recebida', 'enviado',
    'enviada', 'destinatario', 'favorecido', 'remetente', 'pagador',
    'data', 'hora', 'cpf', 'cnpj', 'chave', 'origem', 'destino', 'banco',
    'nome do pagador', 'recebido de', 'enviado por', 'pix de',
    'nubank', 'mercado pago', 'picpay', 'pagbank', 'inter', 'itau',
    'bradesco', 'santander', 'caixa', 'banco do brasil', 'c6', 'safra',
    'original', 'neon', 'btg', 'sicredi', 'sicoob', 'asaas', 'stone'
  ];
  let encontrados = 0;
  for (const ind of indicadores) {
    if (conteudo.includes(normalizarNome(ind))) encontrados++;
  }
  if (encontrados >= 2) return true;
  const possuiValor = /\d+[.,]\d{2}/.test(conteudo);
  if (conteudo.includes('pix') && possuiValor) return true;
  if (conteudo.includes('transferencia') && possuiValor) return true;
  if (conteudo.includes('pagamento') && possuiValor) return true;
  return false;
}
const INSTITUICOES_FINANCEIRAS = new Set([
  'nubank', 'nu pagamentos', 'nu', 'itau', 'itaú', 'banco itau',
  'bradesco', 'santander', 'caixa', 'caixa economica', 'cef',
  'banco do brasil', 'bb', 'inter', 'banco inter', 'c6', 'c6 bank',
  'mercado pago', 'mercado livre', 'picpay', 'pagbank', 'pagseguro',
  'safra', 'banco safra', 'original', 'banco original', 'pan',
  'banco pan', 'neon', 'next', 'btg', 'btg pactual', 'sicredi',
  'sicoob', 'bmg', 'will bank', 'iti', '99pay', 'ame', 'asaas',
  'efi', 'stone', 'infinitepay', 'digio', 'modal', 'xp', 'banrisul'
]);
function nomeComprovanteValido(nome) {
  if (!nome) return false;
  let c = limparTexto(nome).replace(/[|•·]+/g, ' ').replace(/\s+/g, ' ')
    .replace(/^[\s:;\-,.]+|[\s:;\-,.]+$/g, '').trim();
  if (c.length < 3 || c.length > 100) return false;
  if (c.includes('@') || /https?:\/\//i.test(c)) return false;
  if (/\d{4,}/.test(c)) return false;
  if (!nomeEhPessoa(c)) return false;
  if (/^\+?\d[\d\s().-]{7,}$/.test(c)) return false;
  if (/^\d[\d\s./-]*$/.test(c)) return false;
  const n = normalizarNome(c);
  if (!n) return false;
  if (INSTITUICOES_FINANCEIRAS.has(n)) return false;
  const proibidas = new Set([
    'pix', 'comprovante', 'pagamento', 'transferencia', 'valor', 'data',
    'hora', 'banco', 'destino', 'origem', 'cpf', 'cnpj', 'chave',
    'favorecido', 'destinatario', 'remetente', 'pagador', 'recebido',
    'enviado', 'cliente', 'nome', 'tipo', 'documento', 'transacao',
    'qr code', 'agencia', 'conta', 'chave pix'
  ]);
  if (proibidas.has(n)) return false;
  const tokens = c.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return false;
  let letras = 0;
  for (const t of tokens) {
    const sl = t.replace(/[^A-Za-zÀ-ÿ]/g, '');
    if (sl.length >= 2) letras += sl.length;
  }
  if (letras < 4) return false;
  if (tokens.filter(t => /[A-Za-zÀ-ÿ]{2,}/.test(t)).length < 2) return false;
  return true;
}
function limparCandidatoNome(nome) {
  if (!nome) return '';
  let r = limparTexto(nome);
  r = r
    .replace(/^(?:nome\s+(?:do\s+)?(?:pagador|remetente|cliente))\s*[:\-]?\s*/i, '')
    .replace(/^(?:nome\s+de\s+quem\s+enviou|quem\s+enviou)\s*[:\-]?\s*/i, '')
    .replace(/^(?:pagador|remetente|cliente|favorecido)\s*[:\-]?\s*/i, '')
    .replace(/^(?:enviado\s+por|recebido\s+de|pix\s+de|transfer[êe]ncia\s+de|pagamento\s+de)\s*[:\-]?\s*/i, '')
    .replace(/^(?:origem)(?:\s+nome)?\s*[:\-]?\s*/i, '')
    .replace(/^nome\s*[:\-]?\s*/i, '');
  r = r.replace(
    /\s+(?:institui[cç][aã]o|cpf|cnpj|chave|data|valor|tipo|destino|origem|hora|banco|documento|transa[cç][aã]o|id)\b.*$/i,
    ''
  );
  return r.replace(/[|•·]+/g, ' ').replace(/\s+/g, ' ')
    .replace(/^[\-:|]+|[\-:|]+$/g, '').trim();
}
function extrairNomeDoComprovante(texto) {
  const original = String(texto || '');
  if (!original.trim()) return null;
  const conteudo = limparTexto(original);
  const validar = c => {
    if (!c) return null;
    let nome = limparCandidatoNome(c);
    nome = nome.replace(/\s+(?:CPF|CNPJ|CHAVE|DATA|HORA|VALOR|TIPO|BANCO|INSTITUIÇÃO|INSTITUICAO|DESTINO|ORIGEM|DOCUMENTO|TRANSAÇÃO|TRANSACAO|ID)\b.*$/i, '')
      .replace(/\s{2,}/g, ' ').trim();
    return nomeComprovanteValido(nome) ? nome : null;
  };
  const ehEtiqueta = v => {
    const n = normalizarNome(v);
    if (!n) return true;
    return ['nome','cpf','cnpj','chave','valor','data','hora','instituicao',
      'destino','origem','tipo','pix','transferencia','comprovante','pagamento',
      'pagador','remetente','cliente','favorecido','destinatario','banco',
      'agencia','conta','documento','transacao','chave pix'].includes(n);
  };
  const padroes = [
    /(?:você|voce)\s+recebeu\s+(?:um|uma)?\s*pix\s+de\s+(.+?)(?=\s+(?:no|valor|data|hora|em|às|as)\b|[.,;]|$)/i,
    /(?:você|voce)\s+recebeu\s+(?:uma\s+)?transfer[êe]ncia\s+de\s+(.+?)(?=\s+(?:no|valor|data|hora|em|às|as)\b|[.,;]|$)/i,
    /pix\s+recebid[oa]\s+de\s+(.+?)(?=\s+(?:no|valor|data|hora|em|às|as)\b|[.,;]|$)/i,
    /transfer[êe]ncia\s+recebid[ao]\s+de\s+(.+?)(?=\s+(?:no|valor|data|hora|em|às|as)\b|[.,;]|$)/i,
    /pagamento\s+recebid[oa]\s+de\s+(.+?)(?=\s+(?:no|valor|data|hora|em|às|as)\b|[.,;]|$)/i,
    /recebid[oa]\s+de\s+(.+?)(?=\s+(?:no|valor|data|hora|em|às|as)\b|[.,;]|$)/i,
    /enviad[oa]\s+por\s+(.+?)(?=\s+(?:no|valor|data|hora|em|às|as)\b|[.,;]|$)/i,
    /quem\s+pagou\s*[:\-|]?\s*(?:nome\s*[:\-|]?\s*)?(.+?)(?=\s+(?:cpf|cnpj|chave|valor|data|hora|institui[cç][aã]o|banco|destino|origem)\b|$)/i,
    /(?:nome\s+do\s+)?pagador\s*[:\-|]?\s*(.+?)(?=\s+(?:cpf|cnpj|chave|valor|data|hora|institui[cç][aã]o|banco|destino|origem)\b|$)/i,
    /(?:nome\s+do\s+)?remetente\s*[:\-|]?\s*(.+?)(?=\s+(?:cpf|cnpj|chave|valor|data|hora|institui[cç][aã]o|banco|destino|origem)\b|$)/i,
    /enviado\s+por\s*[:\-|]?\s*(.+?)(?=\s+(?:cpf|cnpj|chave|valor|data|hora|institui[cç][aã]o|banco|destino|origem)\b|$)/i,
    /recebido\s+de\s*[:\-|]?\s*(.+?)(?=\s+(?:cpf|cnpj|chave|valor|data|hora|institui[cç][aã]o|banco|destino|origem)\b|$)/i,
    /nome\s*[:\-|]\s*(.+?)(?=\s+(?:cpf|cnpj|chave|valor|data|hora|institui[cç][aã]o|banco|destino|origem)\b|$)/i,
    /cliente\s*[:\-|]\s*(.+?)(?=\s+(?:cpf|cnpj|chave|valor|data|hora|institui[cç][aã]o|banco|destino|origem)\b|$)/i
  ];
  for (const regex of padroes) {
    const m = conteudo.match(regex);
    if (m) {
      const n = validar(m[1]);
      if (n) return n;
    }
  }
  const linhas = original.split(/\r?\n/).map(l => limparTexto(l)).filter(Boolean);
  const padroesLinha = [
    /^(?:nome\s+do\s+pagador|nome\s+pagador)\s*[:\-|]\s*(.+)$/i,
    /^(?:nome\s+do\s+remetente|nome\s+remetente)\s*[:\-|]\s*(.+)$/i,
    /^(?:nome\s+de\s+quem\s+enviou|quem\s+enviou)\s*[:\-|]\s*(.+)$/i,
    /^pagador\s*[:\-|]\s*(.+)$/i,
    /^remetente\s*[:\-|]\s*(.+)$/i,
    /^enviado\s+por\s*[:\-|]\s*(.+)$/i,
    /^recebido\s+de\s*[:\-|]\s*(.+)$/i,
    /^pix\s+de\s*[:\-|]\s*(.+)$/i,
    /^transfer[êe]ncia\s+de\s*[:\-|]\s*(.+)$/i,
    /^pagamento\s+de\s*[:\-|]\s*(.+)$/i,
    /^cliente\s*[:\-|]\s*(.+)$/i,
    /^nome\s*[:\-|]\s*(.+)$/i,
    /^origem(?:\s+nome)?\s*[:\-|]\s*(.+)$/i
  ];
  for (const linhaAtual of linhas) {
    for (const regex of padroesLinha) {
      const m = linhaAtual.match(regex);
      if (m) {
        const n = validar(m[1]);
        if (n) return n;
      }
    }
  }
  const etiquetas = ['pagador','nome pagador','nome do pagador','remetente',
    'nome remetente','nome do remetente','nome de quem enviou','quem enviou',
    'enviado por','recebido de','pix de','transferencia de','transferência de',
    'pagamento de','cliente','origem','origem nome','nome'];
  for (let i = 0; i < linhas.length; i++) {
    if (!etiquetas.includes(normalizarNome(linhas[i]))) continue;
    for (let d = 1; d <= 4; d++) {
      const prox = limparTexto(linhas[i + d]);
      if (!prox || ehEtiqueta(prox)) continue;
      if (/^(?:cpf|cnpj|chave|valor|data|hora|tipo|destino|origem|institui[cç][aã]o|banco|agência|agencia|conta)\b/i.test(prox)) break;
      const n = validar(prox);
      if (n) return n;
    }
  }
  const semDoisPontos = [
    /^(?:pagador|remetente|cliente|favorecido|origem)\s+(.+)$/i,
    /^(?:nome\s+do\s+pagador|nome\s+do\s+remetente)\s+(.+)$/i,
    /^(?:enviado\s+por|recebido\s+de)\s+(.+)$/i,
    /^(?:pix\s+de|transfer[êe]ncia\s+de|pagamento\s+de)\s+(.+)$/i
  ];
  for (const linhaAtual of linhas) {
    for (const regex of semDoisPontos) {
      const m = linhaAtual.match(regex);
      if (m) {
        const n = validar(m[1]);
        if (n) return n;
      }
    }
  }
  const padroesDe = [
    /\b(?:pix|transfer[êe]ncia|pagamento)\s+(?:recebido|recebida|enviado|enviada)?\s*de\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ.'-]*(?:\s+[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ.'-]*){1,8})(?=\s+(?:valor|data|hora|cpf|cnpj|chave|institui[cç][aã]o|banco)\b|[.,;]|$)/i,
    /\b(?:recebido|recebida)\s+de\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ.'-]*(?:\s+[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ.'-]*){1,8})(?=\s+(?:valor|data|hora|cpf|cnpj|chave|institui[cç][aã]o|banco)\b|[.,;]|$)/i,
    /\b(?:enviado|enviada)\s+por\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ.'-]*(?:\s+[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ.'-]*){1,8})(?=\s+(?:valor|data|hora|cpf|cnpj|chave|institui[cç][aã]o|banco)\b|[.,;]|$)/i
  ];
  for (const linhaAtual of linhas) {
    for (const regex of padroesDe) {
      const m = linhaAtual.match(regex);
      if (m) {
        const n = validar(m[1]);
        if (n) return n;
      }
    }
  }
  for (let i = 0; i < linhas.length; i++) {
    const n = normalizarNome(linhas[i]);
    if (n === 'pagador' || n === 'remetente' || n === 'quem enviou' ||
        n === 'nome do pagador' || n === 'nome do remetente') {
      for (const c of [linhas[i+1], linhas[i+2], linhas[i+3]]) {
        if (!c || ehEtiqueta(c)) continue;
        const nome = validar(c);
        if (nome) return nome;
      }
    }
  }
  return null;
}
function limparLinhaParaValor(linha) {
  return String(linha || '')
    .replace(/<a?:\w+:\d+>/g, ' ')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{FE0F}\u{200D}]/gu, ' ')
    .replace(/^\s*(?:-#|[-•])\s+/, '')   // subtexto (-# ...) e marcador de lista
    .replace(/[*_~`#>|]+/g, ' ')
    .replace(/\s+/g, ' ').trim();
}
function extrairValorENomeBot(texto) {
  const linhas = String(texto || '').split(/\r?\n/).map(l => limparTexto(l)).filter(Boolean);
  for (let i = 0; i < linhas.length; i++) {
    const linhaLimpa = limparLinhaParaValor(linhas[i]);
    const m = linhaLimpa.match(
      /valor\s+(?:a\s+ser\s+|a\s+|ser\s+)?pag(?:o|ar)\b[^0-9]{0,30}?(\d(?:[\d.,]*\d)?)/i
    );
    if (!m) continue;
    const valor = normalizarNumero(m[1]);
    if (valor === null) continue;
    let nome = '';
    for (let j = i - 1; j >= Math.max(0, i - 8); j--) {
      let c = limparLinhaParaValor(linhas[j]);
      if (!c) continue;
      if (/^chave\s*:/i.test(c) || /^pix\s*:/i.test(c)) continue;
      if (/^e-?mail\s*:/i.test(c) || c.includes('@')) continue;
      c = c.replace(/^cliente\s*:\s*/i, '').replace(/^nome\s*:\s*/i, '').trim();
      if (/^chave\b/i.test(c)) continue;
      if (pareceUuidOuCodigo(c)) continue;
      if (c.length >= 2 && c.length <= 100) { nome = c; break; }
    }
    return { nome, valor };
  }
  return null;
}
const MOTIVO_VALOR = { v: '' };
function extrairValorEmbeds(mensagem) {
  MOTIVO_VALOR.v = 'rótulo de valor sem número legível (ou nenhum rótulo reconhecido)';
  const embeds = (mensagem && mensagem.embeds) || [];
  const contentBot = (mensagem && mensagem.author && mensagem.author.bot) ? String(mensagem.content || '') : '';
  // Cards em Components V2 (container/text display) não vêm em embeds: o texto está nos components.
  let textoComp = [];
  try { textoComp = textoComponentes(mensagem && mensagem.components, [], new WeakSet(), 0, true).filter(t => String(t || '').trim()); } catch {}  // semOpcoes: opções do menu do mediador ("Confirmar pagamento"...) não contam como texto do card
  if (!embeds.length && !contentBot.trim() && !textoComp.length && !textoExtraMensagem(mensagem).length) return null;
  const partes = [];
  if (contentBot.trim()) partes.push(contentBot);
  for (const t of textoComp) partes.push(t);
  try { for (const t of textoExtraMensagem(mensagem)) partes.push(t); } catch {}
  for (const e0 of embeds) {
    const e = (e0 && e0.data && typeof e0.data === 'object') ? { ...e0.data, ...e0 } : (e0 || {});
    if (e.author && e.author.name) partes.push(e.author.name);
    if (e.title) partes.push(e.title);
    if (e.description) partes.push(e.description);
    for (const f of (e.fields || [])) { partes.push(f.name || ''); partes.push(f.value || ''); }
    if (e.footer && e.footer.text) partes.push(e.footer.text);
  }
  const extrasEspera = [String((mensagem && mensagem.content) || '')];
  const textoEmbedNorm = normalizarNome([...partes, ...extrasEspera].join(' '));
  // Mediador definido no card ("Mediador: <@id>") — card de espera COM mediador pode responder.
  const temMediadorNoCard = /mediador[^<]{0,60}<@!?\d{15,25}>/i.test(textoEmbedNorm);
  // Aceita mensagem de confirmação/início OU mensagem com rótulo explícito de valor
  // a pagar ("valor a ser pago", "valor a pagar", "valor da aposta", "valor da sala",
  // "valor da taxa", "taxa", "taxa de adm", "taxa do adm").
  const temConfirmacao = /\b(confirmad[oa]|iniciad[oa])\b/.test(textoEmbedNorm);
  // Cards de ESPERA ("Esperando Confirmar", "aguardando", "pendente"...): NÃO respondem,
  // a menos que o mediador esteja definido no card ou a aposta já esteja confirmada/iniciada.
  { const mEsp = textoEmbedNorm.match(/\b(aguard\w*|esper\w*|pendente|confirmar|confirmacao)\b/);
    if (mEsp && !temMediadorNoCard && !temConfirmacao) { MOTIVO_VALOR.v = `card de ESPERA (palavra "${mEsp[1]}") sem mediador nem confirmação`; return null; } }
  const textoRotulo = partes.join('\n').split(/\r?\n/).map(l => limparLinhaParaValor(l)).filter(Boolean).join('\n');
  const temRotuloValor = /valor\s+(?:a\s+(?:ser\s+)?pago|a\s+pagar|da\s+aposta|da\s+sala|da\s+taxa(?:\s+(?:do|de)\s+adm\w*)?|total)\s*[:–-]?\s*(?:r\$\s*)?\d|^valor\s*[:–-]?\s*(?:r\$\s*)?\d|taxa(?:\s+(?:do|de)\s+adm\w*)?\s*[:–-]?\s*(?:r\$\s*)?\d/im.test(textoRotulo);
  // Card de fila: "Aposta: R$ 1,00" + "Taxa de Sala (Total)" (a taxa é dividida entre os 2 jogadores).
  const temRotuloAposta = /^\s*(?:aposta|partida)\s*:?\s*(?:r\$\s*)?\d/im.test(textoRotulo.replace(/[*_~`]/g, ''));
  // Fallback universal: aceita TODO tipo de embed/card do Discord — qualquer card de mediação
  // (aposta/partida/sala/jogador/mediador/taxa/valor/pix) com ao menos um valor em R$ legível.
  // Cards de espera sem mediador/confirmação já foram bloqueados acima.
  const textoBrutoCard = partes.join(' ');
  const temContexto = /aposta|partida|fila|jogador|mediador|sala|taxa|valor|pix/i.test(textoBrutoCard);
  const temUmValorR$ = /(?:r\$|brl)\s*\d(?:[\d.,]*\d)?/i.test(textoBrutoCard);
  if (!temConfirmacao && !temRotuloValor && !temRotuloAposta && !(temContexto && temUmValorR$)) { MOTIVO_VALOR.v = 'sem "confirmada/iniciada" e sem rótulo de valor'; return null; }
  const linhas = partes.join('\n').split(/\r?\n/).map(l => limparLinhaParaValor(l)).filter(Boolean);
  const RX_RS_BASE = /^(?:(?:r\$|brl)\s*(\d(?:[\d.,]*\d)?)|(\d(?:[\d.,]*\d)?)\s*(?:brl|reais?))\s*$/i;
  const RX_RS = { exec: s => { const m = RX_RS_BASE.exec(s); return m ? [m[0], m[1] || m[2]] : null; } };
  for (let i = 0; i < linhas.length; i++) {
    const m = linhas[i].match(/^(?:valor(?:\s+(?:a\s+(?:ser\s+)?pago|a\s+pagar|da\s+aposta|da\s+sala|da\s+partida|da\s+entrada|da\s+fila|da\s+taxa(?:\s+(?:do|de)\s+adm\w*)?|total))?|(?:valor\s+da\s+)?(?:aposta|partida)\b|valor\s+por\s+jogador|pre[cç]o|quantia|montante|total\s+a\s+pagar|entrada)\s*:?\s*(.*)$/i);
    if (!m) continue;
    const resto = m[1].trim();
    let numTxt = null;
    if (resto) {
      const mr = RX_RS.exec(resto);
      if (!mr) continue;
      numTxt = mr[1];
    } else if (linhas[i + 1]) {
      const mn = RX_RS.exec(linhas[i + 1]);
      if (mn) numTxt = mn[1];
    }
    if (!numTxt) continue;
    const valor = normalizarNumero(numTxt);
    if (!(valor !== null && valor > 0)) continue;
    let taxa = 0;
    const RX_NUM = /^(?:(?:r\$|brl)\s*)?(\d(?:[\d.,]*\d)?)\s*$/i;
    const RX_TAXA = /^(?:valor\s+da\s+taxa(?:\s+(?:do|de)\s+adm\w*)?|valor\s+da\s+sala|taxa\s+(?:de|da|do)\s+sala(?:\s*\(total\))?|taxa\s*\(total\)|taxa(?:\s+(?:do|de)\s+adm\w*)?)\s*:?\s*(.*)$/i;
    for (let j = 0; j < linhas.length; j++) {
      const mt = linhas[j].match(RX_TAXA);
      if (!mt) continue;
      const resto2 = mt[1].trim();
      const mn2 = resto2 ? resto2.match(RX_NUM) : (linhas[j + 1] ? linhas[j + 1].match(RX_NUM) : null);
      if (!mn2) continue;
      const t = normalizarNumero(mn2[1]);
      if (t !== null && t > 0) { taxa = t; break; }
    }
    return { nome: '', valor: Number((valor + taxa / 2).toFixed(2)), taxaNoCard: taxa > 0 };
  }
  // Último recurso: QUALQUER card de mediação com UM único valor em R$ (aceita todo tipo de embed).
  if (temUmValorR$ && temContexto) {
    const vals = new Set();
    for (const l of linhas) for (const mm of l.matchAll(/(?:r\$|brl)\s*(\d(?:[\d.,]*\d)?)/ig)) {
      const v = normalizarNumero(mm[1]);
      if (v !== null && v > 0) vals.add(v);
    }
    if (vals.size === 1) return { nome: '', valor: [...vals][0] };
  }
  return null;
}
const COMP_CHAVES_TEXTO = new Set(['content', 'text', 'description', 'title', 'name', 'value']);
const COMP_CHAVES_IGNORAR = new Set(['options', 'emoji', 'custom_id', 'customId', 'style', 'placeholder', 'label', 'url', 'media', 'client', 'message', 'channel', 'guild', 'parent', 'author', 'member', 'user', 'users', 'roles']);
// Leitor universal: percorre QUALQUER componente (action row, container, section, text display, media gallery,
// objetos da biblioteca com .data, versões snake_case/camelCase) e junta todo texto visível, na ordem.
function textoComponentes(comps, saida = [], vistos = new WeakSet(), prof = 0, semOpcoes = false) {
  try {
    if (comps === null || comps === undefined || prof > 14) return saida;
    if (Array.isArray(comps)) { for (const c of comps) textoComponentes(c, saida, vistos, prof + 1, semOpcoes); return saida; }
    if (typeof comps !== 'object') return saida;
    if (vistos.has(comps)) return saida;
    vistos.add(comps);
    if (typeof comps.toJSON === 'function' && !Array.isArray(comps.components) && !comps.data) {
      try { const j = comps.toJSON(); if (j && j !== comps) { textoComponentes(j, saida, vistos, prof + 1, semOpcoes); return saida; } } catch {}
    }
    // Opções de menu (string select): texto visível de cada opção.
    if (!semOpcoes && Array.isArray(comps.options)) {
      for (const o of comps.options) {
        if (o && typeof o === 'object') for (const kk of ['label', 'description']) if (typeof o[kk] === 'string' && o[kk].trim()) saida.push(o[kk]);
      }
    }
    // Rótulo de componente que NÃO é botão (Label/TextInput do Components V2): é conteúdo, não ação.
    if (typeof comps.label === 'string' && comps.label.trim() && comps.style === undefined && comps.type !== 2 && (saida.length === 0 || saida[saida.length - 1] !== comps.label)) saida.push(comps.label);
    for (const k of Object.keys(comps)) {
      const v = comps[k];
      if (COMP_CHAVES_IGNORAR.has(k)) continue;
      if (typeof v === 'string') {
        if (COMP_CHAVES_TEXTO.has(k) && v.trim() && (saida.length === 0 || saida[saida.length - 1] !== v)) saida.push(v);
      } else if (v && typeof v === 'object') {
        textoComponentes(v, saida, vistos, prof + 1, semOpcoes);
      }
    }
  } catch {}
  return saida;
}
// ---- LEITOR UNIVERSAL: embeds (todos os campos), Components V2 (container/section/text display/galeria/...),
// mensagens encaminhadas (snapshots) e enquetes. Aceita objetos do discord.js e JSON cru (snake_case).
function textoDeEmbeds(embeds) {
  const partes = [];
  for (const e0 of (embeds || [])) {
    try {
      const e = (e0 && e0.data && typeof e0.data === 'object') ? { ...e0.data, ...e0 } : (e0 || {});
      if (e.author && e.author.name) partes.push(e.author.name);
      if (e.title) partes.push(e.title);
      if (e.description) partes.push(e.description);
      for (const f of (e.fields || [])) partes.push(`${f.name || ''} ${f.value || ''}`.trim());
      if (e.footer && e.footer.text) partes.push(e.footer.text);
      if (e.provider && e.provider.name) partes.push(e.provider.name);
    } catch {}
  }
  return partes;
}
function textoExtraMensagem(m, prof = 0) {
  const partes = [];
  if (!m || prof > 3) return partes;
  try {
    const snaps = m.messageSnapshots || m.message_snapshots;
    const lista = !snaps ? [] : (typeof snaps.values === 'function' ? [...snaps.values()] : (Array.isArray(snaps) ? snaps : []));
    for (const sn of lista) {
      const sm = (sn && sn.message) || sn;
      if (!sm) continue;
      if (sm.content) partes.push(String(sm.content));
      partes.push(...textoDeEmbeds(sm.embeds));
      partes.push(...textoComponentes(sm.components));
      partes.push(...textoExtraMensagem(sm, prof + 1));
    }
  } catch {}
  try {
    const p = m.poll;
    if (p) {
      const q = p.question && (p.question.text || p.question);
      if (typeof q === 'string' && q) partes.push(q);
      const resp = p.answers || [];
      for (const a of (typeof resp.values === 'function' ? [...resp.values()] : resp)) {
        const t = a && ((a.poll_media && a.poll_media.text) || (a.pollMedia && a.pollMedia.text) || a.text);
        if (typeof t === 'string' && t) partes.push(t);
      }
    }
  } catch {}
  return partes;
}
function textoCompletoMensagem(m) {
  const partes = [String((m && m.content) || '')];
  partes.push(...textoDeEmbeds(m && m.embeds));
  try { partes.push(...textoComponentes(m && m.components)); } catch {}
  partes.push(...textoExtraMensagem(m));
  return partes.filter(x => String(x || '').trim()).join('\n');
}
function textoLinhasMensagem(mensagem) {
  const partes = [];
  if (mensagem && mensagem.author && mensagem.author.bot && mensagem.content) partes.push(String(mensagem.content));
  for (const e of ((mensagem && mensagem.embeds) || [])) {
    if (e.title) partes.push(e.title);
    if (e.description) partes.push(e.description);
    for (const f of (e.fields || [])) { partes.push(f.name || ''); partes.push(f.value || ''); }
    if (e.footer && e.footer.text) partes.push(e.footer.text);
  }
  partes.push(...textoComponentes(mensagem && mensagem.components));
  partes.push(...textoExtraMensagem(mensagem));
  return partes.join('\n').split(/\r?\n/).map(l => limparLinhaParaValor(l)).filter(Boolean);
}
function linhaModeloParaRegex(linha) {
  const num = '(\\d(?:[\\d.,]*\\d)?)';
  const campos = [];
  let rx = '';
  for (const p of String(linha).split(/(\{valor\}|\{taxa\})/i)) {
    if (/^\{valor\}$/i.test(p)) { campos.push('valor'); rx += '(?:r\\$\\s*)?' + num; }
    else if (/^\{taxa\}$/i.test(p)) { campos.push('taxa'); rx += '(?:r\\$\\s*)?' + num; }
    else rx += p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*');
  }
  return { rx: new RegExp('^' + rx + '$', 'i'), campos };
}
function extrairValorPorModelo(mensagem, modelo) {
  const tpl = String(modelo || '').split(/\r?\n/).map(l => limparLinhaParaValor(l)).filter(Boolean);
  if (!tpl.length) return null;
  const msg = textoLinhasMensagem(mensagem);
  if (!msg.length) return null;
  const temCampo = l => /\{(valor|taxa)\}/i.test(l);
  if (!temCampo(tpl[0])) {
    const cab = normalizarNome(tpl[0]);
    if (!msg.some(l => normalizarNome(l).includes(cab))) return null;
  }
  const achou = {};
  for (let k = 0; k < tpl.length; k++) {
    if (!temCampo(tpl[k])) continue;
    const { rx, campos } = linhaModeloParaRegex(tpl[k]);
    const semTexto = tpl[k].replace(/\{(valor|taxa)\}/ig, '').replace(/r\$/ig, '').replace(/[\s:\-]/g, '');
    for (let i = 0; i < msg.length; i++) {
      const m = msg[i].match(rx);
      if (!m) continue;
      if (!semTexto && k > 0) {
        if (i === 0 || normalizarNome(msg[i - 1]) !== normalizarNome(tpl[k - 1])) continue;
      }
      campos.forEach((c, n) => {
        if (achou[c] !== undefined) return;
        const v = normalizarNumero(m[n + 1]);
        if (v !== null && v >= 0) achou[c] = v;
      });
      break;
    }
  }
  if (!(achou.valor > 0)) return null;
  const taxa = achou.taxa > 0 ? achou.taxa : 0;
  return { nome: '', valor: Number((achou.valor + taxa / 2).toFixed(2)), taxaNoCard: taxa > 0 };
}
function modeloDoServidor(userId, guildId) {
  const bruto = carregarConfigs()[userId] || {};
  const v = bruto.modelosBusca && bruto.modelosBusca[String(guildId)];
  return v ? String(v) : '';
}
function salvarModeloServidor(userId, guildId, modelo) {
  const todas = carregarConfigs();
  const atual = { ...(todas[userId] || {}) };
  const m = { ...(atual.modelosBusca || {}) };
  const valor = String(modelo || '').trim();
  if (!valor) delete m[String(guildId)]; else m[String(guildId)] = valor;
  if (Object.keys(m).length === 0) delete atual.modelosBusca; else atual.modelosBusca = m;
  if (Object.keys(atual).length === 0) delete todas[userId]; else todas[userId] = atual;
  salvarConfigs(todas);
}
function extrairValorConta(mensagem, userId) {
  const guildId = guildIdDaMensagem(mensagem);
  // Leitura 100% automática de QUALQUER card (embed, Components V1/V2/V3, encaminhada...): sem modelo manual.
  let d = extrairValorEmbeds(mensagem);
  return d;
}
function extrairValorManual(texto) {
  const m = limparTexto(texto).match(/^\.v\s+(.+)$/i);
  if (!m) return null;
  return normalizarNumero(m[1]);
}
function extrairTextoComEmbeds(mensagem) {
  return textoCompletoMensagem(mensagem);
}
// ----- Habilitar PIX -----
function chaveEhNumerica(chave) {
  return /^[\d\s.\-\/()+]+$/.test(String(chave || '').trim());
}
function textoContemChavePix(texto, chave) {
  const k = String(chave || '').trim();
  if (!k || !texto) return false;
  if (chaveEhNumerica(k)) {
    const kd = k.replace(/\D/g, '');
    if (kd.length < 8) return String(texto).includes(k);
    const trechos = String(texto).match(/\d[\d\s.\-\/()+]{6,}\d/g) || [];
    for (const tr of trechos) {
      const td = tr.replace(/\D/g, '');
      if (td.includes(kd) || (td.length >= 10 && kd.endsWith(td))) return true;
    }
    return false;
  }
  const limpa = s => String(s).toLowerCase().replace(/[\s`*_~|]+/g, '');
  return limpa(texto).includes(limpa(k));
}
function mascararChavePix(chave) {
  const s = String(chave || '');
  if (s.length <= 8) return s;
  return `${s.slice(0, 4)}••••${s.slice(-4)}`;
}
function abrirNavegador(url) {
  return new Promise(resolve => {
    execFile('termux-open-url', [url], { timeout: 10000 }, e1 => {
      if (!e1) { resolve(true); return; }
      execFile('am', ['start','-a','android.intent.action.VIEW','-d',url], { timeout: 10000 }, e2 => {
        resolve(!e2);
      });
    });
  });
}
function carregarCredenciaisOAuth() {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    const e = new Error(`credentials.json não encontrado em ${CREDENTIALS_PATH}`);
    e.code = 'GMAIL_CREDENTIALS_NOT_FOUND';
    throw e;
  }
  let arquivo;
  try { arquivo = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8')); }
  catch (e) { throw new Error(`Não foi possível ler credentials.json: ${e.message}`); }
  const cfg = arquivo.installed || arquivo.web;
  if (!cfg) throw new Error('credentials.json inválido. Use OAuth de aplicativo desktop.');
  if (!cfg.client_id || !cfg.client_secret) {
    throw new Error('credentials.json sem client_id/client_secret.');
  }
  return cfg;
}
function tokenPossuiEscopoExclusao(token) {
  if (!token) return false;
  return String(token.scope || '').split(/\s+/).filter(Boolean)
    .includes('https://mail.google.com/');
}
function ehErroQuotaGmail(e) {
  if (!e) return false;
  const status = Number(e.response?.status || e.status || e.code || 0);
  const msg = String(e.message || e).toLowerCase();
  if (status === 429) return true;
  if (status === 403 && (msg.includes('quota exceeded') || msg.includes('units per minute') ||
      msg.includes('total query cost') || msg.includes('rate limit'))) return true;
  return msg.includes('quota exceeded') || msg.includes('units per minute');
}
function registrarQuotaGmail(userId) {
  const e = obterEstadoGmail(userId);
  e.quotaBackoff = e.quotaBackoff <= 0
    ? INTERVALO_QUOTA_GMAIL
    : Math.min(e.quotaBackoff * 2, MAX_BACKOFF_QUOTA_GMAIL);
  e.quotaBloqueadoAte = Date.now() + e.quotaBackoff;
  aviso(`Gmail [${userId}] limitado ~${Math.ceil(e.quotaBackoff/1000)}s.`);
}
async function aguardarQuotaGmail(userId) {
  const e = obterEstadoGmail(userId);
  const r = e.quotaBloqueadoAte - Date.now();
  if (r > 0) await esperar(r);
}
function registrarSucessoGmail(userId) {
  const e = obterEstadoGmail(userId);
  if (e.quotaBloqueadoAte && Date.now() >= e.quotaBloqueadoAte) {
    e.quotaBloqueadoAte = 0;
    e.quotaBackoff = 0;
  }
}
function limparEmailsProcessados(userId) {
  const m = mapUsuario(emailsProcessadosPorUsuario, userId);
  const limite = Date.now() - CACHE_MINUTOS * 60 * 1000;
  for (const [id, ts] of m) if (ts < limite) m.delete(id);
}
function limparCacheAntigo(userId) {
  const cache = mapUsuario(cacheEmailsPorUsuario, userId);
  const limite = Date.now() - CACHE_MINUTOS * 60 * 1000;
  for (const [uid, p] of cache) {
    if (!p || !p.data || p.data.getTime() < limite) cache.delete(uid);
  }
  limparEmailsProcessados(userId);
}
function ativarPersistenciaOAuthUsuario(auth, userId) {
  auth.on('tokens', tokens => {
    try {
      const usuarios = carregarUsuarios();
      const u = usuarios[userId];
      if (!u) return;
      u.gmailToken = { ...(u.gmailToken || {}), ...tokens };
      if (!u.gmailToken.refresh_token && tokens.refresh_token) {
        u.gmailToken.refresh_token = tokens.refresh_token;
      }
      salvarUsuarios(usuarios);
    } catch {}
  });
}
async function conectarGmailAPI(userId) {
  const estado = obterEstadoGmail(userId);
  if (estado.gmail && estado.inicializado) return estado.gmail;
  if (estado.conexaoPromise) return estado.conexaoPromise;
  estado.conexaoPromise = (async () => {
    const usuarios = carregarUsuarios();
    const usuario = usuarios[userId];
    if (!usuario || !usuario.gmailToken) {
      throw new Error(`Conta ${userId} sem Gmail conectado. Use o painel /central.`);
    }
    const credenciais = carregarCredenciaisOAuth();
    const auth = new google.auth.OAuth2(credenciais.client_id, credenciais.client_secret);
    auth.setCredentials(usuario.gmailToken);
    ativarPersistenciaOAuthUsuario(auth, userId);
    const gmailApi = google.gmail({ version: 'v1', auth });
    const perfil = await gmailApi.users.getProfile({ userId: 'me' });
    estado.auth = auth;
    estado.gmail = gmailApi;
    estado.inicializado = true;
    sucesso(`Gmail [${userId}] conectado: ${perfil?.data?.emailAddress || usuario.email || ''}`);
    return gmailApi;
  })();
  try { return await estado.conexaoPromise; }
  finally { estado.conexaoPromise = null; }
}
function erroDeConexaoGmail(e) {
  if (!e) return false;
  const codigo = String(e.code || '').toUpperCase();
  const status = Number(e.response?.status || e.status || 0);
  const msg = String(e.message || '').toLowerCase();
  if (status === 401) return true;
  if (['ECONNRESET','ETIMEDOUT','ENETUNREACH','EHOSTUNREACH','ENOTFOUND'].includes(codigo)) return true;
  return msg.includes('timeout') || msg.includes('socket hang up') || msg.includes('connection reset');
}
function invalidarGmail(instancia, userId) {
  const e = obterEstadoGmail(userId);
  if (instancia && e.gmail !== instancia) return;
  e.gmail = null; e.auth = null; e.inicializado = false;
  e.cacheListaGmail = { ids: [], timestamp: 0 };
}
async function executarGmail(funcao, userId) {
  return await funcao();
}
async function executarGmailComReconexao(funcao, tentativas, userId) {
  let ultimo = null;
  for (let t = 1; t <= tentativas; t++) {
    let svc = null;
    try {
      svc = await conectarGmailAPI(userId);
      if (!svc) throw new Error('Gmail não está pronta.');
      return await executarGmail(() => funcao(svc), userId);
    } catch (e) {
      ultimo = e;
      const m = String(e.message || '').toLowerCase();
      if (m.includes('insufficient authentication scopes') || m.includes('insufficient scope')) throw e;
      if (ehErroQuotaGmail(e)) throw e;
      if (!erroDeConexaoGmail(e)) throw e;
      invalidarGmail(svc, userId);
      if (t < tentativas) await esperar(500);
    }
  }
  throw ultimo;
}
async function listarIdsGmail(gmailApi, q, userId) {
  let paginaToken = undefined;
  const ids = [];
  do {
    await aguardarQuotaGmail(userId);
    const r = await gmailApi.users.messages.list({
      userId: 'me', q, maxResults: MAX_EMAILS_POR_TENTATIVA,
      pageToken: paginaToken, includeSpamTrash: true,
      fields: 'messages(id),nextPageToken'
    });
    for (const m of (r.data.messages || [])) {
      if (m && m.id) ids.push(String(m.id));
    }
    paginaToken = r.data.nextPageToken || null;
    if (ids.length >= MAX_EMAILS_POR_TENTATIVA) break;
  } while (paginaToken);
  return [...new Set(ids)].slice(0, MAX_EMAILS_POR_TENTATIVA);
}
function janelaEpoch() {
  return Math.floor((Date.now() - JANELA_BUSCA_GMAIL_MINUTOS * 60 * 1000) / 1000);
}
async function pesquisarGmail(gmailApi, nome, userId) {
  await aguardarQuotaGmail(userId);
  const e = obterEstadoGmail(userId);
  const agora = Date.now();
  if (e.cacheListaGmail.ids.length && agora - e.cacheListaGmail.timestamp < CACHE_LISTA_GMAIL_MS) {
    return e.cacheListaGmail.ids;
  }
  if (e.buscaEmAndamento) return await e.buscaEmAndamento;
  e.buscaEmAndamento = (async () => {
    try {
      const unicos = await listarIdsGmail(gmailApi, `after:${janelaEpoch()} {${PALAVRAS_BUSCA_GMAIL.join(' ')}}`, userId);
      e.cacheListaGmail = { ids: unicos, timestamp: Date.now() };
      registrarSucessoGmail(userId);
      return unicos;
    } catch (err) {
      if (ehErroQuotaGmail(err)) registrarQuotaGmail(userId);
      throw err;
    } finally { e.buscaEmAndamento = null; }
  })();
  return await e.buscaEmAndamento;
}
async function pesquisarGmailAmplo(gmailApi, nome, userId) {
  await aguardarQuotaGmail(userId);
  try {
    const unicos = await listarIdsGmail(gmailApi, `after:${janelaEpoch()}`, userId);
    registrarSucessoGmail(userId);
    return unicos;
  } catch (err) {
    if (ehErroQuotaGmail(err)) registrarQuotaGmail(userId);
    throw err;
  }
}
function obterHeader(headers, nome) {
  if (!Array.isArray(headers)) return '';
  const p = String(nome).toLowerCase();
  const e = headers.find(h => String(h.name || '').toLowerCase() === p);
  return e?.value || '';
}
function extrairPartesMensagem(payload, resultado = { plain: [], html: [], subject: '' }) {
  if (!payload) return resultado;
  const headers = payload.headers || [];
  const subject = obterHeader(headers, 'Subject');
  if (subject) resultado.subject = subject;
  if (payload.body && payload.body.data) {
    const conteudo = decodificarBase64Url(payload.body.data);
    if (String(payload.mimeType || '').toLowerCase().includes('html')) {
      resultado.html.push(conteudo);
    } else {
      resultado.plain.push(conteudo);
    }
  }
  if (Array.isArray(payload.parts)) {
    for (const p of payload.parts) extrairPartesMensagem(p, resultado);
  }
  return resultado;
}
async function executarComLimite(itens, limite, fn) {
  const resultados = new Array(itens.length);
  let idx = 0;
  const trabalhador = async () => {
    while (true) {
      const i = idx++;
      if (i >= itens.length) return;
      try { resultados[i] = { status: 'fulfilled', value: await fn(itens[i]) }; }
      catch (reason) { resultados[i] = { status: 'rejected', reason }; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limite, itens.length) }, trabalhador));
  return resultados;
}
async function lerEmailsEmLote(gmailApi, ids, userId) {
  if (!ids || !ids.length) return [];
  const lista = [...new Set(ids.map(String).filter(Boolean))].slice(0, MAX_LEITURA_LOTE);
  if (!lista.length) return [];
  await aguardarQuotaGmail(userId);
  try {
    const resultados = await executarComLimite(lista, LEITURA_CONCORRENCIA, async id => {
      const r = await gmailApi.users.messages.get({ userId: 'me', id, format: 'full' });
      const completar = async p => {
        if (!p) return;
        if (p.body && !p.body.data && p.body.attachmentId && /^text\//i.test(p.mimeType || '')) {
          try {
            const a = await gmailApi.users.messages.attachments.get({
              userId: 'me', messageId: id, id: p.body.attachmentId
            });
            p.body.data = a.data.data;
          } catch {}
        }
        await Promise.all((p.parts || []).map(f => completar(f)));
      };
      await completar(r.data.payload);
      return { id, mensagem: r.data };
    });
    const rej = resultados.filter(r => r.status === 'rejected');
    const eq = rej.find(r => ehErroQuotaGmail(r.reason));
    if (eq) { registrarQuotaGmail(userId); throw eq.reason; }
    registrarSucessoGmail(userId);
    return resultados.filter(r => r.status === 'fulfilled').map(r => r.value);
  } catch (e) {
    if (ehErroQuotaGmail(e)) registrarQuotaGmail(userId);
    throw e;
  }
}
function extrairDadosEmail(email) {
  if (!email || !email.mensagem) return null;
  const mensagem = email.mensagem;
  const partes = extrairPartesMensagem(mensagem.payload);
  const headers = mensagem.payload?.headers || [];
  const dataHeader = obterHeader(headers, 'Date');
  const messageId = obterHeader(headers, 'Message-ID');
  let dataEmail = null;
  if (mensagem.internalDate) dataEmail = new Date(Number(mensagem.internalDate));
  if (!dataEmail || !Number.isFinite(dataEmail.getTime())) {
    if (dataHeader) dataEmail = new Date(dataHeader);
  }
  if (!dataEmail || !Number.isFinite(dataEmail.getTime())) dataEmail = new Date();
  const texto = [partes.plain.join('\n'), partes.html.join('\n'), partes.subject || '', mensagem.snippet || ''].join('\n');
  const limpo = limparTexto(texto);
  const textoNorm = normalizarNome(limpo).slice(0, 20000);
  const nome = nomeExtraidoSeguro(extrairNomePagador(limpo)) || nomeExtraidoSeguro(extrairNomeDoComprovante(texto)) || nomePagadorGenerico(textoNorm) || null;

  const valorBruto = extrairValorPagamento(limpo);
  const ehRecebimento = /receb(?:eu|id[oa]|imento)|credit(?:ad[oa]|o)/.test(textoNorm);
  const ehEnvio = /voce (?:enviou|pagou)|pix enviado|transferencia enviada|enviou um pix/.test(textoNorm);
  const valor = (ehRecebimento && !ehEnvio) ? valorBruto : null;
  const temBanco = textoTemBanco(textoNorm);
  const banco = evtDetectarBanco(obterHeader(headers, 'From'), partes.subject, mensagem.snippet, textoNorm);
  const assunto = String(partes.subject || mensagem.snippet || 'sem assunto').slice(0, 60);
  if (valor === null) {
    if (temBanco) aviso(`📧 E-mail de banco SEM valor legível (mantido no cache): ${assunto}`);
  } else if (!nome) {
    info(`📧 Pagamento SEM NOME — ${formatarValor(valor)} (${assunto}). NÃO será aceito (precisa de nome E valor).`);
  } else {
    info(`📧 Lido: ${nome} • ${formatarValor(valor)} (${assunto})`);
  }
  return { uid: String(email.id), nome, valor, data: dataEmail, messageId: messageId || null, textoNorm, temBanco, banco };
}
const PALAVRAS_LIXO_NOME = new Set([
  'email', 'mail', 'transacional', 'website', 'site', 'ola', 'equipe', 'abracos', 'atendimento',
  'central', 'ouvidoria', 'sac', 'blog', 'instagram', 'conta', 'kids', 'transacao', 'pix',
  'comprovante', 'confira', 'detalhes', 'recebimento', 'inter', 'nubank', 'banco', 'mercado', 'pago'
]);
function nomeExtraidoSeguro(nome) {
  if (!nome) return null;
  if (!nomeEhPessoa(nome)) return null;
  const palavras = normalizarNome(nome).split(' ').filter(Boolean);
  if (palavras.length < 2 || palavras.length > 8) return null;
  if (palavras.some(p => PALAVRAS_LIXO_NOME.has(p))) return null;
  return nome;
}
function pagamentoDisponivel(p, inicio, fim, emUso, emAnalise, naFila) {
  if (!p || !p.data) return false;
  const t = p.data.getTime();
  if (t < inicio || t > fim) return false;
  if (emUso.has(p.uid) || emAnalise.has(p.uid) || naFila.has(p.uid)) return false;
  const v = Number(p.valor);
  return p.valor !== null && p.valor !== undefined && Number.isFinite(v) && v > 0;
}
// REGRA ÚNICA: só aceita se o NOME bater (todas as palavras digitadas estão no nome do pagador)
// E o VALOR for maior ou igual ao esperado (menos a tolerância, se configurada).
// Notificação do app é um texto curto (só tem o nome do pagador, valor e frases fixas do banco). Então, se a extração
// do nome falhou ou veio diferente, aceita quando TODAS as palavras digitadas aparecem no texto (e não são palavras
// genéricas de notificação, para ninguém "casar" digitando "pix recebido"). Se o banco cortou o nome com "…",
// a última palavra do texto vale como prefixo.
const PALAVRAS_GENERICAS_NOTIF = new Set(['pix', 'recebido', 'recebida', 'recebeu', 'voce', 'transferencia', 'pagamento', 'valor', 'banco',
  'para', 'pra', 'enviou', 'pagou', 'mandou', 'transferiu', 'conta', 'sua', 'seu', 'nova', 'novo', 'dinheiro', 'credito', 'creditado',
  'compra', 'saldo', 'reais', 'real', 'inter', 'nubank', 'itau', 'bradesco', 'santander', 'caixa', 'picpay', 'mercado', 'pago', 'pagbank', 'c6']);
function nomeNoTextoApp(nomeDigitado, textoNorm, truncado) {
  const pal = palavrasDoNome(nomeDigitado);
  if (pal.length < 2 || !textoNorm) return false;
  if (pal.some(w => PALAVRAS_GENERICAS_NOTIF.has(w))) return false;
  const toks = textoNorm.split(' ').filter(Boolean);
  const set = new Set(toks);
  const ult = toks[toks.length - 1] || '';
  return pal.every((w, i) => set.has(w) || (truncado && ult.length >= 2 && w.length > ult.length && w.startsWith(ult)));
}
function pagamentoBateNomeEValor(p, nomeProcurado, valorBusca, tolerancia = 0) {
  if (!p) return false;
  if (!nomeProcurado || !nomeEhPessoa(nomeProcurado)) return false;
  const nomeBusca = palavrasDoNome(nomeProcurado);
  if (nomeBusca.length < 2) return false;
  let nomeOk = false;
  if (p.nome && nomeEhPessoa(p.nome)) {
    const nomePagamento = palavrasDoNome(p.nome);
    nomeOk = nomeBusca.every(palavra => nomePagamento.includes(palavra));
  }
  if (!nomeOk && p.textoNorm) nomeOk = nomeApareceNoTexto(nomeProcurado, p.textoNorm);
  if (!nomeOk && p.textoNorm && (p.via === 'app' || (!p.nome && p.textoNorm.length <= 1500))) nomeOk = nomeNoTextoApp(nomeProcurado, p.textoNorm, p.truncado === true);
  if (!nomeOk) return false;
  const valorPagamento = Number(p.valor);
  if (!Number.isFinite(valorPagamento) || valorPagamento <= 0) return false;
  const tol = Math.max(0, Number(tolerancia) || 0);
  if (valorPagamento + tol + 0.005 < valorBusca) return false;
  return true;
}
function encontrarPagamentoNoCache(nomeProcurado, valorProcurado, userId, tolerancia = 0, minTs = 0) {
  limparCacheAntigo(userId);
  const cache = mapUsuario(cacheEmailsPorUsuario, userId);
  const emUso = setUsuario(emailsEmUsoPorUsuario, userId);
  const emAnalise = setUsuario(emailsEmAnalisePorUsuario, userId);
  const naFila = setUsuario(emailsNaFilaDeExclusaoPorUsuario, userId);
  const agora = Date.now();
  const inicio = Math.max(agora - MINUTOS_ANTES * 60 * 1000, minTs);
  const fim = agora + MINUTOS_DEPOIS * 60 * 1000;
  if (!nomeProcurado || !nomeEhPessoa(nomeProcurado)) return null;
  if (palavrasDoNome(nomeProcurado).length < 2) return null;
  const valorBusca = Number(valorProcurado);
  if (!Number.isFinite(valorBusca) || valorBusca <= 0) return null;
  for (const p of cache.values()) {
    if (!pagamentoDisponivel(p, inicio, fim, emUso, emAnalise, naFila)) continue;
    if (!pagamentoBateNomeEValor(p, nomeProcurado, valorBusca, tolerancia)) continue;
    if (!p.nome) p.nome = nomeCompletoNoContexto(nomeProcurado, p.textoNorm) || null;
    emUso.add(p.uid);
    return p;
  }
  return null;
}
function acharPagamentoMenor(nomeProcurado, userId, minTs = 0, valorMax = Infinity) {
  const cache = mapUsuario(cacheEmailsPorUsuario, userId);
  const emUso = setUsuario(emailsEmUsoPorUsuario, userId);
  const emAnalise = setUsuario(emailsEmAnalisePorUsuario, userId);
  const naFila = setUsuario(emailsNaFilaDeExclusaoPorUsuario, userId);
  const agora = Date.now();
  const inicio = Math.max(agora - MINUTOS_ANTES * 60 * 1000, minTs);
  const fim = agora + MINUTOS_DEPOIS * 60 * 1000;
  for (const p of cache.values()) {
    if (!pagamentoDisponivel(p, inicio, fim, emUso, emAnalise, naFila)) continue;
    if (!pagamentoBateNomeEValor(p, nomeProcurado, 0.01, 0)) continue;
    if (Number(p.valor) + 0.005 >= valorMax) continue;
    if (!p.nome) p.nome = nomeCompletoNoContexto(nomeProcurado, p.textoNorm) || null;
    emUso.add(p.uid);
    return p;
  }
  return null;
}
// Só confere se existe pagamento MENOR desse nome (não reserva o e-mail).
function existePagamentoMenor(nomeProcurado, userId, minTs = 0, valorMax = Infinity) {
  const cache = mapUsuario(cacheEmailsPorUsuario, userId);
  const emUso = setUsuario(emailsEmUsoPorUsuario, userId);
  const emAnalise = setUsuario(emailsEmAnalisePorUsuario, userId);
  const naFila = setUsuario(emailsNaFilaDeExclusaoPorUsuario, userId);
  const agora = Date.now();
  const inicio = Math.max(agora - MINUTOS_ANTES * 60 * 1000, minTs);
  const fim = agora + MINUTOS_DEPOIS * 60 * 1000;
  for (const p of cache.values()) {
    if (!pagamentoDisponivel(p, inicio, fim, emUso, emAnalise, naFila)) continue;
    if (!pagamentoBateNomeEValor(p, nomeProcurado, 0.01, 0)) continue;
    if (Number(p.valor) + 0.005 >= valorMax) continue;
    return true;
  }
  return false;
}
const esperandoNovosEmails = new Map();
function notificarNovosEmails(userId) {
  const s = esperandoNovosEmails.get(userId);
  if (!s || !s.size) return;
  esperandoNovosEmails.delete(userId);
  for (const f of Array.from(s)) { try { f(); } catch {} }
}
function esperarNovosEmailsOuTempo(userId, ms) {
  return new Promise(resolve => {
    let s = esperandoNovosEmails.get(userId);
    if (!s) { s = new Set(); esperandoNovosEmails.set(userId, s); }
    let timer = null;
    const acordar = () => {
      if (timer) clearTimeout(timer);
      s.delete(acordar);
      resolve();
    };
    timer = setTimeout(acordar, ms);
    s.add(acordar);
  });
}
async function lerNovosEmails(ids, userId) {
  const processados = mapUsuario(emailsProcessadosPorUsuario, userId);
  const cache = mapUsuario(cacheEmailsPorUsuario, userId);
  const emUso = setUsuario(emailsEmUsoPorUsuario, userId);
  const emAnalise = setUsuario(emailsEmAnalisePorUsuario, userId);
  limparEmailsProcessados(userId);
  const novos = ids.filter(
    id => !cache.has(id) && !emUso.has(id) && !emAnalise.has(id) && !processados.has(id)
  ).slice(0, MAX_LEITURA_LOTE);
  if (!novos.length) return [];
  novos.forEach(id => emAnalise.add(id));
  try {
    const emails = await executarGmailComReconexao(g => lerEmailsEmLote(g, novos, userId), 2, userId);
    for (const em of emails) {
      const dados = extrairDadosEmail(em);
      if (dados) {
        const jaTinha = cache.has(dados.uid);
        cache.set(dados.uid, dados);
        if (!jaTinha) registrarPixLido(userId, { uid: dados.uid, nome: dados.nome, valor: dados.valor, origem: 'gmail', fonte: 'Gmail (e-mail)', ts: dados.data ? new Date(dados.data).getTime() : Date.now() });
      }
      processados.set(String(em.id), Date.now());
    }
  } finally {
    novos.forEach(id => emAnalise.delete(id));
  }
  notificarNovosEmails(userId);
  return novos.filter(id => !processados.has(id));
}
async function obterIdsNovos(gmailApi, userId, jaTentouFallback = false) {
  const e = obterEstadoGmail(userId);
  await aguardarQuotaGmail(userId);
  try {
    if (!e.historyId) {
      const perfil = await gmailApi.users.getProfile({ userId: 'me' });
      const hid = String(perfil.data.historyId || '');
      const ids = await listarIdsGmail(gmailApi, `after:${janelaEpoch()}`, userId);
      registrarSucessoGmail(userId);
      return { ids, commit: () => { if (hid) e.historyId = hid; } };
    }
    const novos = new Set();
    let pageToken = undefined;
    let ultimo = e.historyId;
    do {
      const r = await gmailApi.users.history.list({
        userId: 'me', startHistoryId: e.historyId, historyTypes: ['messageAdded'],
        maxResults: 500, pageToken,
        fields: 'history(messagesAdded(message(id))),nextPageToken,historyId'
      });
      for (const h of (r.data.history || [])) {
        for (const m of (h.messagesAdded || [])) {
          if (m && m.message && m.message.id) novos.add(String(m.message.id));
        }
      }
      if (r.data.historyId) ultimo = String(r.data.historyId);
      pageToken = r.data.nextPageToken || undefined;
    } while (pageToken);
    registrarSucessoGmail(userId);
    return { ids: [...novos], commit: () => { e.historyId = ultimo; } };
  } catch (err) {
    const status = Number(err.response?.status || err.status || err.code || 0);
    if (status === 404 && e.historyId && !jaTentouFallback) {
      e.historyId = null;
      return obterIdsNovos(gmailApi, userId, true);
    }
    if (ehErroQuotaGmail(err)) registrarQuotaGmail(userId);
    throw err;
  }
}
const sincronizacoesGmail = new Map();
// OAuth recusado (unauthorized_client / invalid_grant...): não adianta tentar de novo a cada 2s. Pausa 3 min, loga 1x a cada 10 min.
const RX_GMAIL_OAUTH = /invalid_grant|invalid_client|unauthorized_client|token has been expired|invalid credentials/i;
const gmailOauthBloq = new Map();   // userId -> { ate, logadoEm }
function gmailRegistrarFalha(userId, e) {
  const msg = String((e && e.message) || e);
  if (!RX_GMAIL_OAUTH.test(msg)) { logErro(e); return; }
  const b = gmailOauthBloq.get(userId) || { ate: 0, logadoEm: 0 };
  b.ate = Date.now() + 3 * 60 * 1000;
  if (Date.now() - b.logadoEm > 10 * 60 * 1000) {
    b.logadoEm = Date.now();
    aviso(`Gmail [${userId}]: Google recusou o login (${msg.slice(0, 30)}) — o token dessa conta não bate com o credentials.json atual. Reconecte o Gmail pelo /central. Tentativas pausadas por 3 min (este aviso repete a cada 10 min).`);
  }
  gmailOauthBloq.set(userId, b);
}
async function sincronizarEmails(userId, minIntervaloMs = SYNC_MIN_INTERVALO_MS) {
  // Modo app ligado: só deixa de ler e-mail se a conta NÃO tiver Gmail conectado. Com Gmail, lê os dois (celular + e-mail).
  if (appNotifAtivo(userId) && !(carregarUsuarios()[userId] || {}).gmailToken) return 0;
  if (!(carregarUsuarios()[userId] || {}).gmailToken && appVinculado(userId)) return 0;   // sem Gmail, mas com o celular vinculado: só notificações
  const bq = gmailOauthBloq.get(userId);
  if (bq && Date.now() < bq.ate) { const eB = new Error('unauthorized_client: Gmail com OAuth recusado — reconecte pelo /central'); eB.oauthBloqueado = true; throw eB; }
  let s = sincronizacoesGmail.get(userId);
  if (!s) { s = { promise: null, ultimo: 0, retry: new Map() }; sincronizacoesGmail.set(userId, s); }
  if (s.promise) return s.promise;
  if (Date.now() - s.ultimo < minIntervaloMs) return 0;
  const trabalho = (async () => {
    const { ids, commit } = await executarGmailComReconexao(g => obterIdsNovos(g, userId), 2, userId);
    const todos = [...new Set([...ids, ...s.retry.keys()])];
    const falhas = todos.length ? await lerNovosEmails(todos, userId) : [];
    commit();
    const novoRetry = new Map();
    for (const id of falhas) {
      const n = (s.retry.get(id) || 0) + 1;
      if (n < 4) novoRetry.set(id, n);
    }
    s.retry = novoRetry;
    return todos.length;
  })();
  trabalho.catch(e => gmailRegistrarFalha(userId, e));
  let timer;
  const limite = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('Gmail sem resposta (timeout 15s)')), 15000); });
  const p = Promise.race([trabalho, limite]).finally(() => {
    clearTimeout(timer);
    s.ultimo = Date.now();
    if (s.promise === p) s.promise = null;
  });
  s.promise = p;
  return p;
}
const pollersGmail = new Map();
const ultimoErroPollerGmail = new Map();
function iniciarPollerGmail(userId) {
  if (pollersGmail.has(userId)) return;
  const agendar = () => {
    const jitter = Math.round(POLL_GMAIL_MS * (0.8 + Math.random() * 0.6));
    pollersGmail.set(userId, setTimeout(tick, jitter));
  };
  const tick = async () => {
      if (!pollersGmail.has(userId)) return;
      try {
        if (contaInativaPorUso(userId)) return;   // desativada por inatividade: não lê e-mail
        if (!(carregarUsuarios()[userId] || {}).gmailToken) return;   // sem Gmail conectado: não lê e-mail
        if (obterConfigUsuario(userId).automedAtivo === false) return;
        if (obterEstadoGmail(userId).quotaBloqueadoAte > Date.now()) return;
        await sincronizarEmails(userId);
        alertaOk(userId, 'gmail');
        alertaOk(userId, 'oauth');
    } catch (e) {
      if (ehErroQuotaGmail(e)) return;
      const oauthRecusado = /invalid_grant|invalid_client|unauthorized_client|sem gmail conectado|token has been expired|invalid credentials/i.test(String((e && e.message) || e));
      if (oauthRecusado) alertaFalha(userId, 'oauth');
      else alertaFalha(userId, 'gmail');
      const ult = ultimoErroPollerGmail.get(userId) || 0;
      if (!oauthRecusado && Date.now() - ult > 60000) {   // OAuth recusado já foi avisado (1x/10min) por gmailRegistrarFalha
        ultimoErroPollerGmail.set(userId, Date.now());
        aviso(`Leitura em segundo plano [${userId}]: ${e.message}`);
      }
    } finally {
      if (pollersGmail.has(userId)) agendar();
    }
  };
  pollersGmail.set(userId, setTimeout(tick, POLL_GMAIL_MS));
}
function pararPollerGmail(userId) {
  const h = pollersGmail.get(userId);
  if (h) clearTimeout(h);
  pollersGmail.delete(userId);
  gmailOauthBloq.delete(userId);
  sincronizacoesGmail.delete(userId);
  ultimoErroPollerGmail.delete(userId);
}
async function buscarPagamento(nome, valor, userId, canalId) {
  const minTs = (valorDefinidoEmPorCanal.get(canalId) || 0) - 300000;
  const tolerancia = Math.max(0, Number(obterConfigUsuario(userId).tolerancia) || 0);
  let pagamento = encontrarPagamentoNoCache(nome, valor, userId, tolerancia, minTs);
  if (pagamento) {
    info(`⚡ [${userId}] Pagamento no cache.`);
    return pagamento;
  }
  let qtdQuotas = 0;
  const inicioBusca = Date.now();
  for (let tent = 1; tent <= TENTATIVAS_BUSCA; tent++) {
    if (tent > 1 && Date.now() - inicioBusca > PRAZO_MAXIMO_BUSCA_MS) { aviso(`[${userId}] Busca encerrada: prazo máximo de ${Math.round(PRAZO_MAXIMO_BUSCA_MS / 1000)}s.`); break; }
    try {
      if (tent === 1 || tent % 20 === 0) info(`🔎 [${userId}] ${appNotifAtivo(userId) ? ((carregarUsuarios()[userId] || {}).gmailToken ? 'App + Gmail' : 'Notificações do app') : 'Gmail'} ${tent}/${TENTATIVAS_BUSCA} • ${nome || '(sem nome)'} • ${formatarValor(valor)}`);
      await sincronizarEmails(userId);
      pagamento = encontrarPagamentoNoCache(nome, valor, userId, tolerancia, minTs);
      if (pagamento) return pagamento;
    } catch (e) {
      const msg = String(e.message || e);
      if (ehErroQuotaGmail(e)) {
        qtdQuotas++;
        if (qtdQuotas === 1) {
          registrarQuotaGmail(userId);
          aviso(`Gmail [${userId}] ${tent}: quota limitada.`);
        } else {
          aviso(`Gmail [${userId}] ${tent}: quota continua limitada.`);
        }
        if (qtdQuotas >= 10) { aviso(`[${userId}] Verificação encerrada (quota).`); break; }
      } else if (msg.toLowerCase().includes('insufficient authentication scopes') ||
                 msg.toLowerCase().includes('insufficient scope')) {
        erro(`[${userId}] Token sem escopo https://mail.google.com/.`);
        break;
      } else if (e.oauthBloqueado || RX_GMAIL_OAUTH.test(msg)) {
        alertaFalha(userId, 'oauth');   // já avisado no log; só segue esperando
      } else {
        alertaFalha(userId, 'gmail');
        aviso(`Busca [${userId}] ${tent}: ${e.code || ''} ${msg}`);
      }
    }
    if (Date.now() - inicioBusca > ESPERA_PAGAMENTO_MENOR_MS && existePagamentoMenor(nome, userId, minTs, valor - tolerancia)) {
      info(`⚠️ [${userId}] Achei pagamento MENOR de "${nome}" e o completo não chegou em ${Math.round(ESPERA_PAGAMENTO_MENOR_MS / 1000)}s — encerrando a busca para avisar pagamento parcial.`);
      return null;
    }
    if (tent < TENTATIVAS_BUSCA) await esperarNovosEmailsOuTempo(userId, INTERVALO_ENTRE_TENTATIVAS);
  }
  diagnosticarFalhaBusca(nome, valor, userId);
  return null;
}
function diagnosticarFalhaBusca(nome, valor, userId) {
  try {
    const cache = mapUsuario(cacheEmailsPorUsuario, userId);
    const emUso = setUsuario(emailsEmUsoPorUsuario, userId);
    const agora = Date.now();
    aviso(`🔍 [${userId}] Não casou "${nome}" (${formatarValor(valor)}). E-mails lidos na memória: ${cache.size}`);
    for (const p of cache.values()) {
      const idade = (agora - p.data.getTime()) / 60000;
      let motivo = 'OK';
      if (p.valor === null || p.valor === undefined) motivo = 'sem valor legível';
      else if (idade > MINUTOS_ANTES) motivo = `fora da janela (${idade.toFixed(1)} min atrás, limite ${MINUTOS_ANTES})`;
      else if (emUso.has(p.uid)) motivo = 'já usado por outro pg';
      else if (!pagamentoBateNomeEValor(p, nome, 0.01, 0)) motivo = p.nome ? `nome não bate (pagador lido: "${p.nome}")` : 'sem nome extraído e as palavras digitadas não aparecem no texto';
      else if (Number(p.valor) + 0.005 < Number(valor)) motivo = 'valor menor que o esperado';
      const vtxt = (p.valor === null || p.valor === undefined) ? '(sem valor)' : formatarValor(p.valor);
      info(`   • ${p.nome || '(sem nome)'} • ${vtxt} • ${p.via === 'app' ? '📱 ' + (p.banco || 'app') + ' • texto: "' + String(p.textoNorm || '').slice(0, 110) + '"' : (p.temBanco ? 'banco' : 'outro')} • ${motivo}`);
    }
  } catch {}
}
async function apagarEmailGmailAPI(pagamento, userId) {
  if (!pagamento) return false;
  const uid = String(pagamento.uid || '').trim();
  if (!uid) return false;
  if (uid.startsWith('app-')) return false;
  try {
    const gmailApi = await conectarGmailAPI(userId);
    if (!gmailApi) return false;
    const inicio = Date.now();
    const conferencia = await executarGmail(
      () => gmailApi.users.messages.get({ userId: 'me', id: uid, format: 'full' }),
      userId
    );
    const dadosConf = extrairDadosEmail({ id: uid, mensagem: conferencia.data });
    const nomeConfOk = dadosConf && (dadosConf.nome
      ? normalizarNome(dadosConf.nome) === normalizarNome(pagamento.nome)
      : nomeApareceNoTexto(pagamento.nome, dadosConf.textoNorm));
    if (!dadosConf || !nomeConfOk || Number(dadosConf.valor) !== Number(pagamento.valor)) {
      aviso(`🗑️ [${userId}] E-mail ${uid} NÃO apagado: o conteúdo não confere com o pagamento (${pagamento.nome} • ${formatarValor(pagamento.valor)}).`);
      return false;
    }
    await executarGmail(
      () => gmailApi.users.messages.delete({ userId: 'me', id: uid }),
      userId
    );
    mapUsuario(cacheEmailsPorUsuario, userId).delete(uid);
    mapUsuario(emailsProcessadosPorUsuario, userId).delete(uid);
    setUsuario(emailsEmUsoPorUsuario, userId).delete(uid);
    setUsuario(emailsEmAnalisePorUsuario, userId).delete(uid);
    setUsuario(emailsNaFilaDeExclusaoPorUsuario, userId).delete(uid);
    info(`🗑️ [${userId}] E-mail ${uid} apagado em ${Date.now() - inicio}ms.`);
    logEmbed('geral', '🗑️ E-mail do pagamento apagado', [['Pagador', String(pagamento.nome)], ['Valor', formatarValor(pagamento.valor)], ['Tempo', `${Date.now() - inicio}ms`, true]], userId).catch(logErro);
    return true;
  } catch (e) {
    if (ehErroQuotaGmail(e)) {
      aviso(`🗑️ [${userId}] Quota ao apagar ${uid}.`);
      registrarQuotaGmail(userId);
    } else {
      aviso(`🗑️ [${userId}] Não apagou ${uid}: ${e.message}`);
    }
    setUsuario(emailsEmNaFilaDeExclusaoPorUsuarioSafe(), userId).delete(uid);
    return false;
  }
}
function emailsEmNaFilaDeExclusaoPorUsuarioSafe() { return emailsNaFilaDeExclusaoPorUsuario; }
function apagarEmailBackground(pagamento, userId) {
  if (!pagamento) return;
  const uid = String(pagamento.uid || '').trim();
  if (!uid) return;
  const naFila = setUsuario(emailsNaFilaDeExclusaoPorUsuario, userId);
  if (naFila.has(uid)) return;
  naFila.add(uid);
  setImmediate(async () => {
    try {
      const ok = await apagarEmailGmailAPI(pagamento, userId);
      if (ok) return;
      naFila.delete(uid);
    } catch (e) {
      naFila.delete(uid);
      aviso(`🗑️ [${userId}] Erro exclusão: ${e.message}`);
    }
  });
}
function modoSilencioso(userId) {
  return obterConfigUsuario(userId).modoSilencioso === true;
}
const conteudosProprios = new Set();

const GRUPOS_SINONIMOS = [
  ['confirmado', 'aprovado', 'validado', 'verificado'],
  ['confirmada', 'aprovada', 'validada', 'verificada'],
  ['encontrado', 'localizado'],
  ['encontrada', 'localizada'],
  ['encontrei', 'localizei', 'achei'],
  ['encontrar', 'localizar', 'achar'],
  ['enviar', 'mandar'], ['envie', 'mande'], ['enviei', 'mandei'],
  ['enviado', 'mandado'], ['enviada', 'mandada'],
  ['novamente', 'de novo'],
  ['correto', 'certo'], ['incorreto', 'errado'],
  ['verifique', 'confira'],
  ['espere', 'aguarde'], ['esperar', 'aguardar'],
  ['irei', 'vou'],
  ['procurar', 'buscar'],
  ['precisa', 'necessita'],
  ['beleza', 'entendido', 'anotado'],
  ['bom jogo', 'boa partida']
];
const MAPA_SINONIMOS = new Map();
for (const g of GRUPOS_SINONIMOS) for (const w of g) MAPA_SINONIMOS.set(w, g.filter(x => x !== w));
const RX_SINONIMOS = new RegExp(
  '(?<![\\p{L}\\p{N}_])(' + Array.from(MAPA_SINONIMOS.keys()).sort((a, b) => b.length - a.length).join('|') + ')(?![\\p{L}\\p{N}_])',
  'giu'
);
const RX_PROTEGIDO = /```[\s\S]*?```|`[^`\n]*`|<(?:@!?|@&|#|a?:)[^>\s]*>|https?:\/\/\S+|\{[^{}\n]*\}|R\$\s*[\d.,]+|\d[\d.,:]*/g;
function casarCaixa(orig, novo) {
  const letras = orig.replace(/[^\p{L}]/gu, '');
  if (letras.length > 1 && orig === orig.toUpperCase()) return novo.toUpperCase();
  if (orig[0] !== orig[0].toLowerCase()) return novo[0].toUpperCase() + novo.slice(1);
  return novo;
}
function variarTextoSeguro(texto) {
  try {
    const t = String(texto || '');
    if (t.length < 12 || !/\s/.test(t) || /^[.!\/]\S/.test(t.trim())) return t;
    const guardados = [];
    let tmp = t.replace(RX_PROTEGIDO, m => { guardados.push(m); return '\u0001' + (guardados.length - 1) + '\u0001'; });
    tmp = tmp.replace(RX_SINONIMOS, m => {
      const alts = MAPA_SINONIMOS.get(m.toLowerCase());
      if (!alts || !alts.length || Math.random() > 0.65) return m;
      return casarCaixa(m, alts[Math.floor(Math.random() * alts.length)]);
    });
    tmp = tmp.replace(/!!!/g, () => ['!!!', '!!', '!'][Math.floor(Math.random() * 3)]);
    return tmp.replace(/\u0001(\d+)\u0001/g, (_, i) => guardados[Number(i)]);
  } catch { return texto; }
}
const ctxEnvio = new AsyncLocalStorage();

// ANTIBAN: quem envia é o bot oficial, então os emojis Unicode das mensagens (💳 ⚠️ ✅ ❌ ⏰ …) viram os
// emojis da pasta `emojis/` (emojis do aplicativo). Se o emoji não existir na pasta, mantém o Unicode.
// Não mexe em nada dentro de `código` / ```bloco``` (o Pix copia e cola nunca é alterado).
const ANTIBAN_EMOJI_MAPA = [
  ['⚠️', 'triangle_alert'], ['⚠', 'triangle_alert'], ['💳', 'credit_card'], ['✅', 'circle_check'], ['❌', 'circle_x'],
  ['⏰', 'clock'], ['⏳', 'hourglass'], ['💸', 'hand_coins'], ['💰', 'piggy_bank'], ['💵', 'banknote'], ['👤', 'user_round'],
  ['👥', 'users'], ['🔑', 'key_round'], ['🎮', 'gamepad_2'], ['🏆', 'trophy'], ['📋', 'clipboard_list'], ['🚨', 'siren'], ['🧾', 'receipt']
];
function antibanEmojificar(texto) {
  if (typeof texto !== 'string' || !texto) return texto;
  try {
    const mapa = [];
    for (const [u, nome] of ANTIBAN_EMOJI_MAPA) {
      let c = '';
      try { c = E.get(nome); } catch {}
      if (c && String(c).startsWith('<')) mapa.push([u, c]);
    }
    if (!mapa.length) return texto;
    return texto.split(/(```[\s\S]*?```|`[^`\n]*`)/g).map((parte, i) => i % 2 ? parte : mapa.reduce((t, [u, c]) => t.split(u).join(c), parte)).join('');
  } catch { return texto; }
}

// Obsoleto: enviarCanal aplica delaySelfbot() e ignora delayMs.
function apDelayMsg() { return 0; }
  async function enviarCanal(canal, conteudo, opcoes = {}) {
  const gidAb = String((canal && (canal.guildId || (canal.guild && canal.guild.id))) || '');
  if (gidAb && canalEhSelfbot(canal)) {
    const uidAb = userIdDoCanal(canal);
    if (uidAb && antibanAtivo(uidAb, gidAb) && !(opcoes && opcoes.forcarSelfbot)) {
      const payloadAb = typeof conteudo === 'string'
        ? { content: antibanEmojificar(conteudo), allowedMentions: { parse: [], repliedUser: false } }
        : { ...(conteudo || {}), allowedMentions: { parse: [], repliedUser: false } };
      if (typeof payloadAb.content === 'string') payloadAb.content = antibanEmojificar(payloadAb.content);
      return enviarNaFila(canal, async () => {
        const canalBot = await antibanCanalDoBot(canal);
        if (!canalBot) throw new Error('Antiban: o bot oficial não tem acesso a este canal (a conta NÃO enviou nada).');
        return enviarComRetry(() => canalBot.send(payloadAb));
      });
    }
  }
  // Message spinning (adaptado do discord.py-self): varia levemente o texto
  // enviado pelo selfbot (sinônimos + pontuação) para quebrar pattern matching.
  // Só para mensagens de texto simples; objetos (QR, embed, arquivo) não são alterados.
  let conteudoFinal = conteudo;
  let payload;
  if (canalEhSelfbot(canal)) {
    conteudoFinal = opcoes.semVariar ? conteudo : AD.variarConteudo(conteudo);
  }
  payload = typeof conteudoFinal === 'string'
    ? { content: conteudoFinal, allowedMentions: { parse: [], repliedUser: false } }
    : { ...(conteudoFinal||{}), allowedMentions: { parse: [], repliedUser: false } };
  // Registra o texto FINAL (já variado) como conteúdo próprio, para o selfbot
  // ignorar a própria mensagem ao recebê-la de volta.
  const chave = typeof conteudoFinal === 'string' ? conteudoFinal.trim() : String(conteudoFinal?.content||'').trim();
  if (chave) {
    conteudosProprios.add(chave);
    if (conteudosProprios.size > 300) conteudosProprios.delete(conteudosProprios.values().next().value);
  }
  return enviarNaFila(canal, async () => {
    if (canalEhSelfbot(canal)) {
      const uidSb = userIdDoCanal(canal);
      if (uidSb) {
        if (contaPausada(uidSb)) throw new Error('Conta pausada por verificação de segurança — envio cancelado.');
        await sbAguardarLimite(uidSb, canal.id);
        if (contaPausada(uidSb)) throw new Error('Conta pausada por verificação de segurança — envio cancelado.');
      }
      await delayDigitando(canal);
    }
    return enviarComRetry(() => canal.send(payload));
  });
}
// ------------------------------------------------------------
// LIMITE DE ENVIO — SOMENTE conta de usuário (selfbot). O bot oficial nunca passa por aqui.
// ------------------------------------------------------------
const SB_MAX_POR_MIN_CANAL = 30;
const SB_MAX_POR_MIN_TOTAL = 60;
const SB_PAUSA_LIMITE_MS = 2500;
const SB_MAX_SEGUIDAS = 3;
const SB_PAUSA_SEGUIDAS_MS = 30000;
const sbEnvios = new Map();
function userIdDoCanal(canal) {
  const c = canal && canal.client;
  for (const [uid, sb] of selfbots) if (sb === c) return String(uid);
  const v = abLivreCtx.getStore();
  if (v && c && botClient && c === botClient) return String(v.uid);
  return null;
}
function sbEstado(userId) {
  const id = String(userId);
  let e = sbEnvios.get(id);
  if (!e) { e = { total: [], canais: new Map(), seguidas: new Map() }; sbEnvios.set(id, e); }
  return e;
}
function sbHumanoInteragiu(userId, canalId) {
  const e = sbEnvios.get(String(userId));
  if (e) e.seguidas.delete(String(canalId));
}
async function sbAguardarLimite(userId, canalId) {
  const e = sbEstado(userId);
  const cid = String(canalId);
  // sem pausa por respostas seguidas: vale só o delay de 2,5–5s do envio
  e.seguidas.set(cid, 0);
  for (;;) {
    const agora = Date.now();
    e.total = e.total.filter(t => agora - t < 60000);
    const lc = (e.canais.get(cid) || []).filter(t => agora - t < 60000);
    e.canais.set(cid, lc);
    if (lc.length < SB_MAX_POR_MIN_CANAL && e.total.length < SB_MAX_POR_MIN_TOTAL) {
      lc.push(agora);
      e.total.push(agora);
      e.seguidas.set(cid, (e.seguidas.get(cid) || 0) + 1);
      return;
    }
    aviso(`[${userId}] Limite de envio atingido (canal ${lc.length}/${SB_MAX_POR_MIN_CANAL}, total ${e.total.length}/${SB_MAX_POR_MIN_TOTAL} por min) — aguardando ${SB_PAUSA_LIMITE_MS / 1000}s.`);
    await esperar(SB_PAUSA_LIMITE_MS);
  }
}const filasEnvio = new Map();
function enviarNaFila(canal, tarefa) {
  const chave = String((canal && canal.id) || 'x');
  const anterior = filasEnvio.get(chave) || Promise.resolve();
  const atual = anterior.catch(e=>{erro(`[FilaEnvio] A tarefa anterior falhou: ${e?.message||e}`);}).then(tarefa);
  const marcador = atual.finally(()=>{if (filasEnvio.get(chave) === marcador) filasEnvio.delete(chave);});
  filasEnvio.set(chave, marcador);
  return atual;
}
// Rate limit do Discord (429) e erros 5xx: respeita o Retry-After e tenta de novo (máx. 3x).
// Tenta APENAS 1 vez. Se falhar, avisa e para (sem repetir, para não duplicar mensagens).
async function enviarComRetry(fn) {
  try {
    return await fn();
  } catch (e) {
    const status = Number(e?.httpStatus || e?.status || e?.response?.status || 0);
    erro(`[Envio] Falhou (HTTP ${status || '?'}): ${String(e?.message || e).slice(0, 150)} — não será repetido.`);
    throw e;
  }
}
// Reações ✅/❌ SOMENTE no modo fantasma (silencioso). Fora dele não reage: as respostas em texto são enviadas pelos chamadores.
// Se o antiban estiver ativo no servidor, quem reage é o bot oficial (a conta não faz nada).
async function reagirResultado(mensagem, emoji) {
  try {
    if (!mensagem || !mensagem.id || !mensagem.channel) return false;
    await esperar(250 + Math.floor(Math.random() * 450));
    const gid = guildIdDaMensagem(mensagem);
    const uid = userIdDoCanal(mensagem.channel);
    if (uid && gid && antibanAtivo(uid, gid)) {
      const canalBot = await antibanCanalDoBot(mensagem.channel);
      const msgBot = canalBot ? await canalBot.messages.fetch(mensagem.id).catch(() => null) : null;
      if (!msgBot) return false;
      await msgBot.react(emoji);
      return true;
    }
    if (typeof mensagem.react !== 'function') return false;
    await mensagem.react(emoji);
    return true;
  } catch (e) {
    aviso(`Reação ${emoji}: ${String(e && e.message).slice(0, 100)}`);
    return false;
  }
}
async function enviarResultado(mensagem, emoji, silencioso = false) {
  if (silencioso !== true) return false;
  reagirResultado(mensagem, emoji).catch(logErro);   // não segura o fluxo de verificação
  return true;
}
async function apagarComando(mensagem) {
  // Não apaga mensagens automaticamente.
  return;
}
const RX_API_URL = String(process.env.RX_API_URL || 'https://api.rushxclub.com').replace(/\/+$/, '');
const RX_API_KEY = String(process.env.RX_API_KEY || '').trim();
const CUPULA_API_URL = String(process.env.CUPULA_API_URL || 'https://cupula.online').replace(/\/+$/, '');
const CUPULA_API_KEY = String(process.env.CUPULA_API_KEY || '').trim();
// Provedores de sala em ordem de prioridade: Cúpula (principal) -> Nix -> RushClub (fallback em caso de erro).
const NIX_API_URL = String(process.env.NIX_API_URL || 'https://salas.nixbot.vip').replace(/\/+$/, '');
const NIX_API_KEY = String(process.env.NIX_API_KEY || '').trim();
// Ordem de tentativa na criação: Cúpula (principal, até 3,5s) > Nix > RushClub. Cada provedor só entra se tiver chave no .env.
const PROVEDORES_SALA = [
  { nome: 'cupula', url: CUPULA_API_URL, key: CUPULA_API_KEY },
  { nome: 'nix', url: NIX_API_URL, key: NIX_API_KEY },
  { nome: 'rx', url: RX_API_URL, key: RX_API_KEY }
].filter(p => p.key);
const NOME_API_SALA = { cupula: 'CÚPULA (principal)', nix: 'NIX (2ª opção)', rx: 'RUSHCLUB (fallback)' };
const CUPULA_LIMITE_MS = Number(process.env.CUPULA_LIMITE_MS) || 3500;   // se a Cúpula não entregar a sala nesse prazo, pula para a Nix
const provedorPorNome = n => PROVEDORES_SALA.find(p => p.nome === n) || PROVEDORES_SALA.find(p => p.nome === 'rx') || PROVEDORES_SALA[0];
// Cada sessão precisa continuar sendo consultada no provedor que a criou.
const provedorPorSid = new Map();
const RX_ITENS_NORMAL = [
  'UMP',
  'XM8',
  'MP40',
  'M1014',
  'USP2',
  'DESERT_EAGLE',
  'HELMET_2',
  'VEST_2',
  'VEST_3',
  'MUSHROOM_3',
  'REPAIR_KIT',
  'GLOO_WALL',
  'GRENADE'
];

const RX_ITENS_TODOS = [
  'G18', 'DESERT_EAGLE', 'MINI_UZI', 'KINGFISHER', 'P90', 'M14',
  'UMP', 'MP5', 'MAC10', 'SPAS12', 'VECTOR', 'BIZON', 'THOMPSON',
  'M1014', 'G36', 'SCAR', 'KORD', 'VSK94', 'PARAFAL', 'XM8',
  'AUG', 'SKS', 'MAG7', 'M590', 'CHARGE_BUSTER', 'AK47', 'GROZA',
  'KAR98K', 'M24', 'M1887', 'AC80', 'WOODPECKER', 'M249', 'SVD',
  'MP40', 'M82B', 'AWM_Y', 'M4A1', 'FAMAS', 'AN94', 'SCYTHE',
  'KATANA', 'M500', 'USP2', 'M1917', 'M60', 'THOMPSON_X',
  'M14_I', 'M1887_X', 'HEAL_SNIPER', 'CG15', 'GROZA_X', 'SVD_Y',
  'M249_X', 'M79', 'GATLING', 'FLAMETHROWER', 'VEST_2', 'VEST_3',
  'VEST_4', 'HELMET_2', 'HELMET_4', 'REPAIR_KIT',
  'GRENADE', 'FLASHBANG', 'SMOKE', 'GLOO_WALL', 'DRAGON_FREEZE',
  'MUSHROOM_3'
];

// ============================================================
// CÚPULA — contrato real: POST /api/rooms {modo, senha}, GET /api/rooms/{id}, /players, /start, /release, /result.
// As respostas são traduzidas para o formato que o resto do automed já entende (room.status + teams[].slots[]).
// ============================================================
// Modos da Cúpula: 1 sem carregamento · 2 com carregamento · 3 gelo infinito · 4 só headshot · 5 full UMP/XM8.
// Tático e speed não têm equivalente: vão direto para a RX. Ajuste com CUPULA_MODO_NORMAL=1 etc. no .env.
const NOME_SALA = 'ZEROUN APPS';   // nome com que TODA sala é criada (Cúpula e RUSH)
const CUPULA_MODO_POR_TIPO = {
  normal: Number(process.env.CUPULA_MODO_NORMAL) || 1,
  infinito: Number(process.env.CUPULA_MODO_INFINITO) || 3,
  fullcapa: Number(process.env.CUPULA_MODO_FULLCAPA) || 4,
  tatico: Number(process.env.CUPULA_MODO_TATICO) || null,
  speed: Number(process.env.CUPULA_MODO_SPEED) || null
};
async function cupulaReq(metodo, caminho, corpo, idem, timeoutMs = 25000) {
  const prov = provedorPorNome('cupula');
  const headers = { 'X-API-Key': prov.key, 'Accept': 'application/json' };
  if (corpo !== undefined) headers['Content-Type'] = 'application/json';
  if (idem) headers['Idempotency-Key'] = String(idem);
  const r = await fetch(`${prov.url}${caminho}`, {
    method: metodo, headers, body: corpo === undefined ? undefined : JSON.stringify(corpo),
    signal: AbortSignal.timeout(timeoutMs)
  });
  let json = null;
  try { json = await r.json(); } catch {}
  return { status: r.status, json: json || {}, retryAfter: Number(r.headers.get('Retry-After')) || 0 };
}
const cupulaSala = d => (d && (d.room || (d.data && (d.data.room || d.data)))) || d || {};
function cupulaSessao(d) { const r = cupulaSala(d); return r.session_id || r.sessionId || (d && (d.session_id || d.sessionId)) || null; }
function cupulaJogadores(d, extra) {
  const r = cupulaSala(d);
  const lista = [extra && extra.players, extra, d && d.players, r && r.players, d && d.data && d.data.players].find(Array.isArray);
  let jogs = [];
  if (lista) {
    jogs = lista.map((p, i) => (p && typeof p === 'object')
      ? { ...p, uid: String(p.uid ?? p.account_id ?? p.id ?? ''), team: p.team ?? p.team_index ?? 0, slot: p.slot ?? i }
      : { uid: String(p), team: 0, slot: i });
  } else {
    const teams = (d && d.teams) || (r && r.teams);
    if (Array.isArray(teams)) teams.forEach((t, ti) => (t.slots || t.players || []).forEach((p, i) => { if (p) jogs.push({ ...p, uid: String(p.uid ?? p.account_id ?? ''), team: t.index ?? ti, slot: p.index ?? i }); }));
  }
  return jogs;
}
function cupulaTeams(jogs) {
  const base = jogs.length && Math.min(...jogs.map(j => Number(j.team) || 0)) >= 1 ? 1 : 0;   // times 1-based?
  return [0, 1].map(ti => {
    const doTime = jogs.filter(j => (Number(j.team) || 0) - base === ti).sort((a, b) => (Number(a.slot) || 0) - (Number(b.slot) || 0));
    return { team: ti, index: ti, slots: [0, 1, 2, 3].map(i => doTime[i] ? { ...doTime[i], nickname: doTime[i].nickname || doTime[i].name || doTime[i].uid } : null) };
  });
}
function cupulaStatus(v) {
  const s = String(v ?? '').toLowerCase();
  if (['started', 'in_progress', 'running', 'jogando', 'playing'].includes(s)) return 'playing';
  if (['finished', 'ended', 'completed', 'finalizada'].includes(s)) return 'completed';
  if (['closed', 'released', 'cancelled', 'canceled', 'encerrada'].includes(s)) return 'closed';
  return 'active';   // aguardando jogadores (no automed, "active" = ainda não iniciada)
}
async function cupulaTraduzir(metodo, caminho, corpo, idem) {
  const m = String(caminho).match(/^\/rooms\/([^/?]+)\/(status|result|start|release|chat)$/);
  if (!m) return { status: 404, json: { error: 'rota sem equivalente na Cúpula: ' + caminho }, retryAfter: 0 };
  const sid = encodeURIComponent(decodeURIComponent(m[1]));
  const acao = m[2];
  if (acao === 'chat') return { status: 501, json: { error: 'chat de sala não existe na Cúpula' }, retryAfter: 0 };
  if (acao === 'start') return cupulaReq('POST', `/api/rooms/${sid}/start`, corpo || {}, idem);
  if (acao === 'release') return cupulaReq('POST', `/api/rooms/${sid}/release`, {});
  if (acao === 'result') {
    const r = await cupulaReq('GET', `/api/rooms/${sid}/result`);
    if (r.status === 410) r.status = 404;
    if (r.status === 200) { const sala = cupulaSala(r.json); r.json = { ...r.json, ...(sala !== r.json ? sala : {}) }; }
    return r;
  }
  // status = sala + jogadores
  const r = await cupulaReq('GET', `/api/rooms/${sid}`);
  if (r.status !== 200) return r;
  let jogs = cupulaJogadores(r.json);
  try { const p = await cupulaReq('GET', `/api/rooms/${sid}/players`); if (p.status === 200) jogs = cupulaJogadores(r.json, p.json); } catch {}
  const sala = cupulaSala(r.json);
  r.json = { ...r.json, room: { ...sala, session_id: cupulaSessao(r.json) || decodeURIComponent(m[1]), status: cupulaStatus(sala.status ?? r.json.status) }, teams: cupulaTeams(jogs) };
  return r;
}
// ============================================================
// NIX (2ª opção) — https://nixff.vip · base https://salas.nixbot.vip · Authorization: Bearer <NIX_API_KEY>
// Rotas: POST /rooms · GET /rooms/{id} · GET /rooms/{id}/members · POST /rooms/{id}/start · POST /rooms/{id}/release · GET /rooms/{id}/result
// Traduzida para o formato que o resto do automed já entende (room.status + teams[].slots[]), igual à Cúpula.
// Ordem de tentativa na criação: Cúpula (3,5s) > Nix > RushClub. A chave fica no .env (NIX_API_KEY) — nunca no código.
// ============================================================
const NIX_CONFIG_POR_TIPO = {
  normal: { config_type: 'ap_padrao', carregamento: false },
  infinito: { config_type: 'gelo_inf' },
  fullcapa: { config_type: 'ap_fullcapa' },
  tatico: { config_type: 'tatico' },
  speed: null   // a Nix não tem Speed: vai direto para a RushClub
};
async function nixReq(metodo, caminho, corpo, timeoutMs = 25000) {
  const prov = PROVEDORES_SALA.find(p => p.nome === 'nix');
  if (!prov) throw new Error('NIX_API_KEY não configurada no .env.');
  const headers = { 'Authorization': `Bearer ${prov.key}`, 'Accept': 'application/json' };
  if (corpo !== undefined) headers['Content-Type'] = 'application/json';
  const r = await fetch(`${prov.url}${caminho}`, {
    method: metodo, headers, body: corpo === undefined ? undefined : JSON.stringify(corpo),
    signal: AbortSignal.timeout(timeoutMs)
  });
  let json = null;
  try { json = await r.json(); } catch {}
  return { status: r.status, json: json || {}, retryAfter: Number(r.headers.get('Retry-After')) || 0 };
}
function nixStatus(v) {
  const s = String(v ?? '').toLowerCase();
  if (['started', 'jogando', 'playing', 'in_progress', 'running'].includes(s)) return 'playing';
  if (['finished', 'ended', 'completed', 'finalizada'].includes(s)) return 'completed';
  if (['released', 'closed', 'expired', 'cancelled', 'canceled'].includes(s)) return 'closed';
  return 'active';   // aguardando jogadores
}
function nixErro(r) {
  const j = r.json || {};
  const d = j.detail || (j.error && (j.error.message || j.error)) || j.message || j;
  return typeof d === 'string' ? d : JSON.stringify(d);
}
async function nixCriarSala(tipo) {
  const m = NIX_CONFIG_POR_TIPO[tipo];
  if (!m) throw new Error(`modo "${tipo}" não tem equivalente na Nix`);
  const body = {
    config_type: m.config_type,
    password: '22',
    // A Nix inicia sozinha após esse prazo (máx. 10 min): deixo no máximo para o timer de 5 min do bot (.go) agir primeiro.
    start_delay_minutes: 10,
    room_name: NOME_SALA.slice(0, 20),
    carregamento: !!m.carregamento
  };
  const r = await nixReq('POST', '/rooms', body, 60000);
  if (r.status >= 400) throw new Error(`API nix ${r.status}: ${nixErro(r).slice(0, 200)}`);
  const d = r.json || {};
  if (!d.session_id) throw new Error('API nix: não retornou session_id');
  return { ...d, session_id: String(d.session_id), room_id: d.room_id, password: d.password || '22' };
}
async function nixTraduzir(metodo, caminho, corpo) {
  const m = String(caminho).match(/^\/rooms\/([^/?]+)\/(status|result|start|release|chat)$/);
  if (!m) return { status: 404, json: { error: 'rota sem equivalente na Nix: ' + caminho }, retryAfter: 0 };
  const sid = encodeURIComponent(decodeURIComponent(m[1]));
  const acao = m[2];
  if (acao === 'chat') return { status: 501, json: { error: 'chat de sala não existe na Nix' }, retryAfter: 0 };
  if (acao === 'start') {
    const r = await nixReq('POST', `/rooms/${sid}/start`, {}, 30000);
    if (r.status < 400 && r.json && r.json.started === false) return { status: 409, json: { error: 'A Nix não confirmou o início.' }, retryAfter: 0 };
    return r;
  }
  if (acao === 'release') return nixReq('POST', `/rooms/${sid}/release`, {}, 30000);
  if (acao === 'result') {
    const r = await nixReq('GET', `/rooms/${sid}/result`, undefined, 20000);
    if (r.status === 404 || r.status === 410) return { status: 200, json: { status: 'no_match' }, retryAfter: 0 };
    if (r.status === 200 && String(r.json.status || '').toLowerCase() === 'jogando') {
      // ainda em partida: no automed isso é "resultado ainda não existe" (404) + espera
      return { status: 404, json: { poll_after_seconds: r.json.poll_after_seconds || 10 }, retryAfter: 0 };
    }
    return r;
  }
  // status = sala + jogadores
  const r = await nixReq('GET', `/rooms/${sid}`, undefined, 20000);
  if (r.status !== 200) return r;
  let jogs = [];
  try {
    const mb = await nixReq('GET', `/rooms/${sid}/members`, undefined, 20000);
    if (mb.status === 200) {
      jogs = (Array.isArray(mb.json.members) ? mb.json.members : []).map((p, i) => {
        const uid = String(p.player_uid ?? p.uid ?? p.account_id ?? '');
        return { ...p, uid, account_id: uid, nickname: p.nickname || p.name || uid, team: p.team ?? 0, slot: p.slot ?? i, is_emulator: p.platform === 'emulator' || !!p.is_emulator };
      });
    }
  } catch {}
  const sala = r.json.room || r.json;
  r.json = { ...r.json, room: { ...sala, session_id: String(sala.session_id || decodeURIComponent(m[1])), status: nixStatus(sala.status) }, teams: cupulaTeams(jogs) };
  return r;
}
async function rxHttp(metodo, caminho, corpo, idem, provNome) {
  if (!provNome) {
    const m = String(caminho).match(/^\/rooms\/([^/?]+)/);
    const sidReq = m ? decodeURIComponent(m[1]) : null;
    provNome = sidReq && provedorPorSid.get(sidReq);
    if (!provNome && sidReq && PROVEDORES_SALA.length > 1) {
      // Sessão sem registro (ex.: criada antes de reiniciar): tenta sempre na ordem Cúpula → Nix → RX
      // e guarda quem respondeu, para as próximas chamadas já irem na rota certa.
      let ultima = null, ultimoErro = null;
      for (const p of PROVEDORES_SALA) {
        try {
          const r = await rxHttp(metodo, caminho, corpo, idem, p.nome);
          ultima = r;
          if (r.status >= 200 && r.status < 300) { provedorPorSid.set(sidReq, p.nome); return r; }
          if (![400, 401, 403, 404].includes(r.status)) return r;   // 429/5xx: não é "sala não é deste provedor"
        } catch (e) { ultimoErro = e; }
      }
      if (ultima) return ultima;
      throw ultimoErro || new Error('Nenhuma API de salas respondeu.');
    }
    if (!provNome) provNome = (PROVEDORES_SALA[0] && PROVEDORES_SALA[0].nome) || 'rx';
  }
  const prov = provedorPorNome(provNome);
  if (!prov) throw new Error('Nenhuma API de salas configurada (CUPULA_API_KEY / NIX_API_KEY / RX_API_KEY).');
  if (prov.nome === 'cupula') return cupulaTraduzir(metodo, caminho, corpo, idem);
  if (prov.nome === 'nix') return nixTraduzir(metodo, caminho, corpo);
  const headers = { 'X-API-Key': prov.key, 'Authorization': `Bearer ${prov.key}`, 'Content-Type': 'application/json' };
  if (idem) headers['Idempotency-Key'] = idem;
  const r = await httpNatural(`${prov.url}${caminho}`, {
    method: metodo, headers, body: corpo ? JSON.stringify(corpo) : undefined, signal: AbortSignal.timeout(30000)
  }, 3);
  let json = null;
  try { json = await r.json(); } catch {}
  // retryAfter continua em SEGUNDOS (contrato dos chamadores), agora correto inclusive
  // quando o header vem como data HTTP ou em milissegundos.
  return { status: r.status, json: json || {}, retryAfter: httpMsRetryAfter(r.headers.get('Retry-After')) / 1000 };
}
function rxConfigSala(tipo) {
  const rounds = tipo === 'speed' ? 7 : 13;
  const naoSaoArmas = ['REPAIR_KIT', 'GRENADE', 'FLASHBANG', 'SMOKE', 'GLOO_WALL', 'DRAGON_FREEZE', 'MUSHROOM_3'];
  const armas = RX_ITENS_TODOS.filter(i => !/^(VEST_|HELMET_)/.test(i) && !naoSaoArmas.includes(i));
  const itens = [...armas, 'GLOO_WALL', 'MUSHROOM_3', 'VEST_2', 'VEST_3', 'HELMET_2', 'GRENADE', 'REPAIR_KIT'];

  return {
    map: 'bermuda',
    rounds,
    functions: {
      loadout: false,
      unlimited_gloo: tipo === 'infinito',
      unlimited_ammo: false,
      head_shot_only: tipo === 'fullcapa',
      no_airdrop: true,
      no_vehicle: true,
      hide_kill_info: false,
      no_fall_damage: false,
      no_skill: false,
      no_power_gun: false,
      acc_total_stats: false,
      no_uav: false,
      no_bomb: false
    },
    attributes: {
      hp: 200,
      ep: 0,
      speed: 100,
      jump: 100
    },
    shop: itens.map(item => ({
      item,
      price: 0
    })),
    gold_per_round: Array(rounds).fill(9999)
  };
}
async function cupulaCriarSala(tipo) {
  const modo = CUPULA_MODO_POR_TIPO[tipo];
  if (!modo) throw new Error(`modo "${tipo}" não tem equivalente na Cúpula`);
  const base = { modo, senha: '22' };
  // A sala SEMPRE sai com o nome da loja. Tenta o nome em todos os campos comuns;
  // se a API rejeitar (400/422), tenta um campo por vez e só por último sem nome (avisando no log).
  const variacoes = [
    { nome: NOME_SALA, name: NOME_SALA, room_name: NOME_SALA },
    { nome: NOME_SALA },
    { room_name: NOME_SALA },
    { name: NOME_SALA },
    {}
  ];
  let r = null, nomeEnviado = null;
  const fimCupula = Date.now() + CUPULA_LIMITE_MS;   // prazo TOTAL (inclui as tentativas de nome)
  const idemCupula = crypto.randomUUID();
  for (const extra of variacoes) {
    const resta = fimCupula - Date.now();
    if (resta <= 0) throw new Error(`API cupula: não entregou a sala em ${(CUPULA_LIMITE_MS / 1000).toLocaleString('pt-BR')}s`);
    try { r = await cupulaReq('POST', '/api/rooms', { ...base, ...extra }, idemCupula, resta); }
    catch (eC) {
      if (eC && (eC.name === 'TimeoutError' || eC.name === 'AbortError')) throw new Error(`API cupula: não entregou a sala em ${(CUPULA_LIMITE_MS / 1000).toLocaleString('pt-BR')}s`);
      throw eC;
    }
    nomeEnviado = Object.keys(extra).length ? Object.keys(extra).join('+') : null;
    if (r.status !== 400 && r.status !== 422) break;
  }
  if (r.status < 400 && !nomeEnviado) aviso(`Cúpula recusou todos os campos de nome — sala criada SEM o nome "${NOME_SALA}".`);
  if (r.status >= 400) throw new Error(`API cupula ${r.status}: ${JSON.stringify(r.json.error || r.json).slice(0, 200)}`);
  const sala = cupulaSala(r.json);
  const sid = cupulaSessao(r.json);
  if (!sid) throw new Error('API cupula: não retornou session_id');
  const nomeVolta = String(sala.room_name ?? sala.nome ?? sala.name ?? '').trim();
  if (nomeVolta && nomeVolta !== NOME_SALA) aviso(`Cúpula criou a sala com o nome "${nomeVolta}" em vez de "${NOME_SALA}" (campo enviado: ${nomeEnviado || 'nenhum'}).`);
  return { ...sala, session_id: String(sid), room_id: sala.room_id ?? sala.roomId ?? sala.id, password: sala.password || sala.senha || '22' };
}
async function rxCriarSalaEm(prov, tipo) {
  if (prov.nome === 'cupula') {
    const sala = await cupulaCriarSala(tipo);
    sala.modoTipo = tipo; sala.provider = 'cupula';
    provedorPorSid.set(sala.session_id, 'cupula');
    return sala;
  }
  if (prov.nome === 'nix') {
    const sala = await nixCriarSala(tipo);
    sala.modoTipo = tipo; sala.provider = 'nix';
    provedorPorSid.set(sala.session_id, 'nix');
    return sala;
  }
  const corpo = {
    room_name: NOME_SALA,
    password: '22',
    goConsensus: true,
    config: rxConfigSala(tipo)
  };

  let r = await rxHttp('POST', '/rooms/custom', corpo, crypto.randomUUID(), prov.nome);

  if (r.status >= 400) {
    throw new Error(`API ${prov.nome} ${r.status}: ${JSON.stringify(r.json.error || r.json).slice(0, 200)}`);
  }

  let out = r.json;
  const fim = Date.now() + 90000;

  while (
    !(out.request && out.request.room) &&
    out.status !== 'failed' &&
    out.requestId &&
    Date.now() < fim
  ) {
    await esperar(Math.max(1500, (r.retryAfter || 0) * 1000));
    r = await rxHttp('GET', `/rooms/requests/${out.requestId}`, undefined, undefined, prov.nome);
    out = r.json;
  }

  const sala = out.request && out.request.room;
  if (!sala || !sala.session_id) {
    throw new Error(`API ${prov.nome}: não entregou a sala (falhou ou demorou demais).`);
  }

  sala.modoTipo = tipo;
  sala.password = '22';
  sala.provider = prov.nome;
  provedorPorSid.set(sala.session_id, prov.nome);
  return sala;
}
async function rxCriarSala(tipo, senha) {
  if (!PROVEDORES_SALA.length) {
    throw new Error('Nenhuma chave de API definida no .env (CUPULA_API_KEY / NIX_API_KEY / RX_API_KEY)');
  }
  const erros = [];
  for (const prov of PROVEDORES_SALA) {
    if (prov.nome === 'cupula' && !CUPULA_MODO_POR_TIPO[tipo]) {
      info(`Modo "${tipo}" não existe na Cúpula — pulando para a próxima API.`);
      continue;
    }
    if (prov.nome === 'nix' && !NIX_CONFIG_POR_TIPO[tipo]) {
      info(`Modo "${tipo}" não existe na Nix — pulando para a próxima API.`);
      continue;
    }
    try {
      const sala = await rxCriarSalaEm(prov, tipo);
      sucesso(`[salas] Sala ${tipo} criada pela API ${NOME_API_SALA[prov.nome] || prov.nome} | room_id: ${sala.room_id} | session: ${sala.session_id}`);
      if (erros.length) aviso(`Sala criada via ${NOME_API_SALA[prov.nome] || prov.nome}. Erros anteriores: ${erros.join(' | ')}`);
      return sala;
    } catch (e) {
      erros.push(e.message);
      aviso(`Falha ao criar sala na API ${NOME_API_SALA[prov.nome] || prov.nome}: ${e.message}${prov !== PROVEDORES_SALA[PROVEDORES_SALA.length - 1] ? ` — tentando a próxima (${NOME_API_SALA[(PROVEDORES_SALA[PROVEDORES_SALA.indexOf(prov) + 1] || {}).nome] || 'próxima API'}).` : ''}`);
    }
  }
  throw new Error(erros.join(' | ') || `Nenhuma API de salas disponível para o modo "${tipo}".`);
}
const MODO_SALA_TXT = { normal: 'Normal', infinito: 'Infinita', tatico: 'Tática', fullcapa: 'Full capa', speed: 'Speed' };
// ============================================================
// SALAS ATIVAS (persistidas em salas-ativas.json) — recuperação após reiniciar o bot
// ============================================================
const SALAS_ATIVAS_PATH = path.join(__dirname, 'salas-ativas.json');
// ── Atividade recente do app (sala criada) — guardada por conta, últimas 40 ──
const APP_ATIV_PATH = path.join(__dirname, 'app_atividade.json');
let appAtividade = {};
try { if (fs.existsSync(APP_ATIV_PATH)) appAtividade = JSON.parse(fs.readFileSync(APP_ATIV_PATH, 'utf8')) || {}; } catch { appAtividade = {}; }
function appAtividadeAdd(userId, ev) {
  try {
    const k = String(userId);
    const l = appAtividade[k] || (appAtividade[k] = []);
    l.unshift(Object.assign({ ts: Date.now() }, ev));
    if (l.length > 40) l.length = 40;
    const tmp = APP_ATIV_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(appAtividade));
    fs.renameSync(tmp, APP_ATIV_PATH);
  } catch {}
}
const salasAtivas = new Map();
const salasRestauradas = new Set();
const entregasEmAndamento = new Set();
function salasAtivasCarregar() {
  try {
    if (!fs.existsSync(SALAS_ATIVAS_PATH)) return;
    const dados = JSON.parse(fs.readFileSync(SALAS_ATIVAS_PATH, 'utf8'));
    for (const r of (Array.isArray(dados) ? dados : [])) if (r && r.canalId && r.sid) { salasAtivas.set(r.canalId, r); provedorPorSid.set(r.sid, r.provider || 'rx'); }
  } catch (e) {
    try { fs.copyFileSync(SALAS_ATIVAS_PATH, `${SALAS_ATIVAS_PATH}.corrompido-${Date.now()}`); } catch {}
    aviso(`salas-ativas.json ilegível (cópia salva): ${e.message}`);
  }
}
function salasAtivasSalvar() {
  try {
    const tmp = `${SALAS_ATIVAS_PATH}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify([...salasAtivas.values()], null, 1));
    fs.renameSync(tmp, SALAS_ATIVAS_PATH);
  } catch (e) { aviso(`Não consegui salvar salas-ativas.json: ${e.message}`); }
}
function salaAtivaRegistrar(sala, extra = {}) {
  if (!sala || !sala.canalId || !sala.session_id) return;
  const jaExistia = salasAtivas.has(sala.canalId);
  if (!jaExistia && sala.userId) appAtividadeAdd(sala.userId, { t: 'sala', guildId: sala.guildId || null, canalId: sala.canalId });
  const r = salasAtivas.get(sala.canalId) || { criadaEm: Date.now() };
  Object.assign(r, {
    canalId: sala.canalId, userId: sala.userId, guildId: sala.guildId || null,
    sid: sala.session_id, roomId: sala.room_id, password: sala.password, provider: sala.provider || provedorPorSid.get(sala.session_id) || 'rx',
    iniciadaEm: sala.iniciadaEm || null,
    modoTipo: sala.modoTipo || r.modoTipo || null,
    msgSlotsId: (sala.mensagemInicial && sala.mensagemInicial.id) || r.msgSlotsId || null,
    jogadores: Array.isArray(sala.jogadores) ? sala.jogadores : (r.jogadores || [])
  }, extra);
  salasAtivas.set(sala.canalId, r);
  salasAtivasSalvar();
}
function salaAtivaRemover(canalId, sid) {
  const r = salasAtivas.get(canalId);
  if (r && (!sid || r.sid === sid)) { salasAtivas.delete(canalId); salasAtivasSalvar(); }
}
function salaAtivaVigente(canalId) {
  const r = salasAtivas.get(canalId);
  if (!r) return false;
  const idade = Date.now() - (r.iniciadaEm || r.criadaEm || 0);
  return r.iniciadaEm ? idade < 95 * 60 * 1000 : idade < 15 * 60 * 1000;
}
salasAtivasCarregar();
async function resultadoJaEnviado(canal, sala) {
  try {
    const msgs = await canal.messages.fetch({ limit: 30 });
    const meuId = canal.client && canal.client.user && canal.client.user.id;
    return Array.from(msgs.values()).some(m => m.author && m.author.id === meuId &&
      (m.createdTimestamp || 0) >= (sala.iniciadaEm || 0) && /PARTIDA FINALIZADA/.test(m.content || ''));
  } catch { return false; }
}
function rxEmojiPlataforma(slot) {
  if (!slot || typeof slot !== 'object') return '';
  for (const o of [slot, slot.player]) {
    if (!o || typeof o !== 'object') continue;
    for (const k of ['is_emulator', 'emulator', 'isEmulator']) if (typeof o[k] === 'boolean') return o[k] ? '💻' : '📱';
    for (const k of ['platform', 'device', 'device_type', 'deviceType', 'client', 'client_type', 'os', 'input', 'input_type', 'plataforma']) {
      const v = o[k];
      if (typeof v !== 'string' || !v) continue;
      const t = v.toLowerCase();
      if (/emul|\bpc\b|desktop|computer|computador|windows|bluestacks|gameloop|ldplayer|msi/.test(t)) return '💻';
      if (/mobile|android|ios|iphone|phone|celular|touch/.test(t)) return '📱';
    }
  }
  return '';
}
async function jogadoresDoCanalGo(canal) {
  const e = pagAutoCanais.get(canal.id);
  if (e && Array.isArray(e.ids) && e.ids.length === 2) return [...e.ids];
  try {
    const hist = await canal.messages.fetch({ limit: 50 });
    const lista = Array.from(hist.values()).sort((a, b) => (b.createdTimestamp || 0) - (a.createdTimestamp || 0));
    for (const m of lista) { const j = jogadoresDoEmbed(m); if (j.length >= 2) return j; }
  } catch {}
  return [];
}
// ============================================================
// FOTO DA SALA — mesma arte do salas.zip (utils/salaCriadaImage.js).
// "Sala criada" e "Sala iniciada!" agora saem SÓ como imagem (sem texto).
// Fundo: banner/ícone do servidor; sem eles usa o gradiente vermelho.
// Fontes: se existir assets/fonts/Poppins-*.ttf (ou Rajdhani-*.ttf) ao lado
// do index.js a arte fica idêntica à do salas.zip; senão usa sans-serif.
// Fotos de fundo opcionais: sala-fundo.png/jpg ao lado do index.js ou a
// variável SALA_FOTO_FUNDO (URL) no .env — só usadas se o servidor não tiver banner/ícone.
// ============================================================
const SALA_FOTO_MODO = { normal: 'Gel normal', infinito: 'Gel infinito', tatico: 'Tático', fullcapa: 'Full capa', speed: 'Speed' };
const SALA_FOTO_W = 1280, SALA_FOTO_H = 720, SALA_FOTO_ESCALA = 1.5, SALA_FOTO_VERMELHO = '#ff0019';
// true = depois da partida iniciada, edita a foto com o texto "ao vivo" (rounds/kills/dano) por baixo dela.
// false (padrão) = a mensagem fica SÓ com a foto.
const AO_VIVO_NA_FOTO = false;
let salaFotoFontesCache = null;
function salaFotoFontes() {
  if (salaFotoFontesCache) return salaFotoFontesCache;
  let GF = null;
  try { GF = CanvasLib && CanvasLib.GlobalFonts; } catch {}
  const dirs = [path.join(__dirname, 'assets', 'fonts'), path.join(__dirname, 'fonts'), path.join(process.cwd(), 'assets', 'fonts')];
  const reg = (arq, fam) => {
    if (!GF) return false;
    for (const d of dirs) {
      try {
        const p = path.join(d, arq);
        if (fs.existsSync(p) && GF.registerFromPath(p, fam) !== false) return true;
      } catch {}
    }
    return false;
  };
  const popOk = [reg('Poppins-Bold.ttf', 'Sala-Bold'), reg('Poppins-Medium.ttf', 'Sala-Med'), reg('Poppins-Regular.ttf', 'Sala-Reg')].every(Boolean);
  const rajOk = !popOk && [reg('Rajdhani-Bold.ttf', 'Sala-Bold'), reg('Rajdhani-Medium.ttf', 'Sala-Med'), reg('Rajdhani-Medium.ttf', 'Sala-Reg')].every(Boolean);
  const custom = popOk || rajOk;
  const K = popOk ? 1 : 1.18;   // Rajdhani é mais estreita
  salaFotoFontesCache = {
    bold: px => custom ? `${Math.round(px * K)}px Sala-Bold` : `bold ${px}px sans-serif`,
    med:  px => custom ? `${Math.round(px * K)}px Sala-Med`  : `${px}px sans-serif`,
    reg:  px => custom ? `${Math.round(px * K)}px Sala-Reg`  : `${px}px sans-serif`
  };
  return salaFotoFontesCache;
}
const salaFotoImgCache = new Map();
async function salaFotoCarregarUrl(url) {
  if (!url || !CanvasLib) return null;
  if (salaFotoImgCache.has(url)) return salaFotoImgCache.get(url);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 16 * 1024 * 1024) return null;
    const img = await CanvasLib.loadImage(buf);
    if (salaFotoImgCache.size >= 20) salaFotoImgCache.delete(salaFotoImgCache.keys().next().value);
    salaFotoImgCache.set(url, img);
    return img;
  } catch { return null; }
}
async function salaFotoCarregarArquivoFundo() {
  if (!CanvasLib) return null;
  if (salaFotoImgCache.has('__arquivo__')) return salaFotoImgCache.get('__arquivo__');
  let img = null;
  try {
    for (const f of fs.readdirSync(__dirname)) {
      if (/^sala-fundo\.(png|jpe?g|webp)$/i.test(f)) { img = await CanvasLib.loadImage(fs.readFileSync(path.join(__dirname, f))); break; }
    }
  } catch {}
  salaFotoImgCache.set('__arquivo__', img);
  return img;
}
// URLs do banner/ícone do servidor em que a sala foi criada (aceita discord.js 14 e selfbot-v13).
function salaFotoGuildUrls(canal) {
  let iconUrl = null, bannerUrl = null;
  try {
    const g = canal && canal.guild;
    const opts = { extension: 'png', format: 'png', size: 2048, dynamic: false };
    try { if (g && typeof g.iconURL === 'function') iconUrl = g.iconURL(opts) || null; } catch {}
    try { if (g && typeof g.bannerURL === 'function') bannerUrl = g.bannerURL(opts) || null; } catch {}
  } catch {}
  return { iconUrl, bannerUrl };
}
// Os mesmos helpers de rxTextoSlots, para montar os nomes de cada time a partir de `teams` da API.
function rxTimeDaApi(teams, numero) {
  const lista = Array.isArray(teams) ? teams : [];
  const baseZero = lista.some(t => Number(t && t.index) === 0);
  return lista.find((t, i) => {
    if (t && t.index !== undefined && t.index !== null) return Number(t.index) + (baseZero ? 1 : 0) === numero;
    if (t && t.team !== undefined && t.team !== null) { const v = Number(t.team); return v === numero || v + 1 === numero; }
    return i + 1 === numero;
  });
}
function rxNomeSlotApi(slot) {
  if (!slot) return '';
  const j = typeof slot === 'string' ? slot : (
    slot.nickname || (slot.player && (slot.player.nickname || slot.player.name)) || slot.player_name ||
    slot.name || slot.username || slot.account_id || (slot.player && slot.player.account_id) || ''
  );
  return String(j).trim();
}
function rxTimesParaFoto(teams) {
  return [1, 2].map(n => {
    const time = rxTimeDaApi(teams, n);
    const slots = Array.isArray(time && time.slots) ? time.slots : [];
    const out = [];
    for (let i = 0; i < 4; i++) { const nome = rxNomeSlotApi(slots[i]); if (nome) out.push({ nickname: nome }); }
    return out;
  });
}
/**
 * @param {object} o  { estado:'criada'|'iniciada'|'encerrada', roomId, senha, modeName, criadorNome,
 *                      times:[[{nickname}],[{nickname}]], capacidade, bannerUrl, iconUrl }
 * @returns {Promise<Buffer>} JPEG 1920x1080
 */
async function salaFotoGerar(o = {}) {
  if (!CanvasLib) throw new Error('pacote @napi-rs/canvas não instalado');
  const { createCanvas } = CanvasLib;
  const F = salaFotoFontes();
  const W = SALA_FOTO_W, H = SALA_FOTO_H, RED = SALA_FOTO_VERMELHO;
  const estado = o.estado || 'criada';
  const capacidade = Number(o.capacidade) || 8;
  const vagas = Math.max(1, Math.ceil(capacidade / 2));
  const times = [0, 1].map(i => (Array.isArray(o.times && o.times[i]) ? o.times[i] : []).slice(0, vagas));
  const total = times[0].length + times[1].length;
  const titulo = estado === 'iniciada' ? 'Sala iniciada!' : estado === 'encerrada' ? 'Sala encerrada' : 'Sala criada';
  const badge = estado === 'iniciada' ? 'EM PARTIDA' : estado === 'encerrada' ? 'ENCERRADA' : 'AGUARDANDO';

  // Banner do servidor tem prioridade; depois o ícone; depois o arquivo/URL padrão.
  const banner = await salaFotoCarregarUrl(o.bannerUrl);
  const icone = banner ? null : await salaFotoCarregarUrl(o.iconUrl);
  const padrao = (banner || icone) ? null : ((await salaFotoCarregarArquivoFundo()) || (await salaFotoCarregarUrl(String(process.env.SALA_FOTO_FUNDO || '').trim() || null)));
  const fundo = banner || icone || padrao;

  const canvas = createCanvas(W * SALA_FOTO_ESCALA, H * SALA_FOTO_ESCALA);
  const ctx = canvas.getContext('2d');
  ctx.scale(SALA_FOTO_ESCALA, SALA_FOTO_ESCALA);
  ctx.textBaseline = 'alphabetic';

  // ── helpers de desenho ──
  const rr = (x, y, w, h, r) => {
    const q = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + q, y);
    ctx.arcTo(x + w, y, x + w, y + h, q);
    ctx.arcTo(x + w, y + h, x, y + h, q);
    ctx.arcTo(x, y + h, x, y, q);
    ctx.arcTo(x, y, x + w, y, q);
    ctx.closePath();
  };
  const fillRR = (x, y, w, h, r, fill) => { ctx.fillStyle = fill; rr(x, y, w, h, r); ctx.fill(); };
  const strokeRR = (x, y, w, h, r, stroke, lw = 1.5) => { ctx.strokeStyle = stroke; ctx.lineWidth = lw; rr(x, y, w, h, r); ctx.stroke(); };
  const tracked = (text, x, y, spacing, align = 'left') => {
    const chars = [...text];
    const ws = chars.map(c => ctx.measureText(c).width);
    const tot = ws.reduce((a, b) => a + b, 0) + spacing * (chars.length - 1);
    let cx = align === 'right' ? x - tot : align === 'center' ? x - tot / 2 : x;
    chars.forEach((c, i) => { ctx.fillText(c, cx, y); cx += ws[i] + spacing; });
    return tot;
  };
  const truncar = (text, maxW) => {
    if (ctx.measureText(text).width <= maxW) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
    return t + '…';
  };
  const gradiente = (x, y, w, h, c1, c2) => {
    const g = ctx.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, c1); g.addColorStop(1, c2);
    return g;
  };
  const pessoa = (cx, cy, r, bg, fg) => {
    ctx.fillStyle = bg;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = fg;
    ctx.beginPath(); ctx.arc(cx, cy - r * 0.22, r * 0.30, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx, cy + r * 0.72, r * 0.52, Math.PI, 0); ctx.closePath(); ctx.fill();
  };
  const vidro = (x, y, w, h, r, escuro) => { ctx.fillStyle = `rgba(0,0,0,${Math.min(escuro, 0.30)})`; rr(x, y, w, h, r); ctx.fill(); };

  // ── fundo ──
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  if (fundo) {
    const esc = Math.max(W / fundo.width, H / fundo.height);
    const dw = fundo.width * esc, dh = fundo.height * esc;
    const dy = banner ? (H - dh) / 2 : Math.min(0, Math.max(H - dh, (H - dh) * 0.4));
    ctx.drawImage(fundo, (W - dw) / 2, dy, dw, dh);
  } else {
    ctx.fillStyle = gradiente(0, 0, W, H, '#c4102a', '#4a0510');
    ctx.fillRect(0, 0, W, H);
  }
  const topo = ctx.createLinearGradient(0, 0, 0, H);
  topo.addColorStop(0, 'rgba(0,0,0,0.14)');
  topo.addColorStop(0.28, 'rgba(0,0,0,0)');
  topo.addColorStop(0.80, 'rgba(0,0,0,0)');
  topo.addColorStop(1, 'rgba(0,0,0,0.16)');
  ctx.fillStyle = topo; ctx.fillRect(0, 0, W, H);

  // ── pill "ZEROUN SALAS" ──
  fillRR(64, 58, 180, 42, 21, RED);
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(89, 79, 8, 0, Math.PI * 2); ctx.fill();
  ctx.font = F.bold(17);
  tracked('ZEROUN SALAS', 108, 85, 0.3);

  // ── selo de estado ──
  ctx.font = F.bold(13);
  const bw = ctx.measureText(badge).width + 64;
  vidro(W - 64 - bw, 58, bw, 42, 21, 0.34);
  strokeRR(W - 64 - bw, 58, bw, 42, 21, 'rgba(255,255,255,0.35)', 1.2);
  ctx.fillStyle = estado === 'iniciada' ? '#3ddc84' : estado === 'encerrada' ? '#888' : RED;
  ctx.beginPath(); ctx.arc(W - 64 - bw + 24, 79, 6, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff';
  tracked(badge, W - 64 - bw + 40, 84, 1);

  // ── título ──
  ctx.fillStyle = '#fff';
  ctx.font = F.bold(66);
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 14;
  ctx.fillText(titulo, 62, 178);
  ctx.restore();

  // ── MODO / POR ──
  let cx = 64;
  ctx.font = F.bold(11);
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  cx += tracked('MODO', cx, 216, 2) + 14;
  ctx.font = F.bold(18);
  ctx.fillStyle = '#fff';
  const modo = truncar(String(o.modeName || '—').toUpperCase(), 520);
  ctx.fillText(modo, cx, 217);
  cx += ctx.measureText(modo).width + 32;
  if (o.criadorNome) {
    ctx.font = F.bold(11);
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    cx += tracked('POR', cx, 216, 2) + 12;
    ctx.font = F.bold(18);
    ctx.fillStyle = '#fff';
    ctx.fillText(truncar('@' + String(o.criadorNome).toUpperCase(), 260), cx, 217);
  }

  // ── cartão ID da sala ──
  ctx.save();
  ctx.shadowColor = 'rgba(255,0,25,0.35)'; ctx.shadowBlur = 24; ctx.shadowOffsetY = 8;
  fillRR(64, 236, 836, 114, 30, gradiente(64, 236, 836, 114, '#ff3347', '#d4001a'));
  ctx.restore();
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = F.bold(11);
  tracked('#  ID DA SALA', 94, 268, 2.5);
  ctx.fillStyle = '#fff';
  ctx.font = F.bold(60);
  ctx.fillText(truncar(`#${o.roomId ?? '—'}`, 780), 92, 332);

  // ── cartão SENHA ──
  ctx.save();
  ctx.shadowColor = 'rgba(255,0,25,0.35)'; ctx.shadowBlur = 24; ctx.shadowOffsetY = 8;
  fillRR(916, 236, 300, 114, 30, gradiente(916, 236, 300, 114, '#ff0a24', '#ee0018'));
  ctx.restore();
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = F.bold(11);
  tracked('SENHA', 946, 268, 2.5);
  ctx.fillStyle = '#fff';
  ctx.font = F.bold(60);
  ctx.fillText(truncar(String(o.senha ?? '—'), 250), 944, 332);

  // ── painéis dos times ──
  const panelY = 368, panelH = 238, panelW = 568;
  const rowH = 34, rowGap = 8, rowsTop = panelY + 58;
  [0, 1].forEach(ti => {
    const px = ti === 0 ? 64 : 648;
    vidro(px, panelY, panelW, panelH, 26, 0.34);
    strokeRR(px, panelY, panelW, panelH, 26, 'rgba(255,255,255,0.24)', 1.3);
    fillRR(px + 18, panelY + 14, 84, 28, 14, RED);
    ctx.fillStyle = '#fff'; ctx.font = F.bold(12);
    tracked(`TIME ${ti + 1}`, px + 60, panelY + 33, 1, 'center');
    ctx.font = F.bold(26);
    ctx.textAlign = 'right';
    ctx.fillText(`${times[ti].length}/${vagas}`, px + panelW - 20, panelY + 40);
    ctx.textAlign = 'left';
    for (let i = 0; i < vagas; i++) {
      const ry = rowsTop + i * (rowH + rowGap);
      const p = times[ti][i];
      const rx = px + 14, rw = panelW - 28;
      if (p) {
        fillRR(rx, ry, rw, rowH, 17, 'rgba(255,255,255,0.15)');
        strokeRR(rx, ry, rw, rowH, 17, 'rgba(255,255,255,0.30)', 1);
        pessoa(rx + 20, ry + rowH / 2, 12, RED, '#fff');
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 6;
        ctx.fillStyle = '#fff'; ctx.font = F.bold(17);
        ctx.fillText(truncar(p.nickname || p.name || 'Jogador', rw - 70), rx + 44, ry + 23);
        ctx.restore();
      } else {
        fillRR(rx, ry, rw, rowH, 17, 'rgba(255,255,255,0.07)');
        pessoa(rx + 20, ry + rowH / 2, 12, 'rgba(255,255,255,0.28)', 'rgba(255,255,255,0.75)');
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 6;
        ctx.fillStyle = 'rgba(255,255,255,0.88)'; ctx.font = F.reg(17);
        ctx.fillText('Vaga livre', rx + 44, ry + 23);
        ctx.restore();
      }
    }
  });

  // ── VS ──
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.4)'; ctx.shadowBlur = 10;
  ctx.fillStyle = RED; ctx.beginPath(); ctx.arc(640, panelY + panelH / 2 + 2, 20, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(640, panelY + panelH / 2 + 2, 20, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.font = F.bold(12); ctx.textAlign = 'center';
  ctx.fillText('VS', 640, panelY + panelH / 2 + 7);
  ctx.textAlign = 'left';

  // ── rodapé ──
  vidro(64, 626, 190, 44, 22, 0.34);
  strokeRR(64, 626, 190, 44, 22, 'rgba(255,255,255,0.24)', 1.2);
  fillRR(80, 641, 28, 14, 7, RED);
  ctx.fillStyle = '#fff'; ctx.font = F.bold(15);
  ctx.fillText('.gg/zeroun', 118, 654);
  ctx.font = F.bold(14);
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.textAlign = 'right';
  ctx.fillText('jogadores na sala', W - 64, 660);
  const wLabel = ctx.measureText('jogadores na sala').width;
  ctx.fillStyle = '#fff'; ctx.font = F.bold(40);
  ctx.fillText(`${total}/${capacidade}`, W - 64 - wLabel - 14, 662);
  ctx.textAlign = 'left';

  return canvas.toBuffer('image/jpeg', 95);
}
// A mensagem já tem imagem anexada? (não dá para editar texto "por cima" de uma sala em foto)
function msgTemFoto(m) {
  try { return !!(m && m.attachments && m.attachments.size > 0); } catch { return false; }
}
function salaEmModoFoto(sala) {
  return !!(sala && (sala.fotoMsg || msgTemFoto(sala.mensagemInicial)));
}
/**
 * Envia a FOTO da sala (só a imagem, sem texto). Devolve a mensagem enviada,
 * ou null se não conseguiu gerar/enviar (aí quem chama cai no texto antigo,
 * pra a sala NUNCA deixar de aparecer por causa da imagem).
 */
async function enviarFotoSala(canal, sala, estado, teams = []) {
  try {
    const tipo = sala.modoTipo || sala.tipo || null;
    const { iconUrl, bannerUrl } = salaFotoGuildUrls(canal);
    const criador = canal && canal.client && canal.client.user && (canal.client.user.username || null);
    const buf = await salaFotoGerar({
      estado, roomId: sala.room_id, senha: sala.password || '22',
      modeName: SALA_FOTO_MODO[tipo] || 'Sala', criadorNome: criador,
      times: rxTimesParaFoto(teams), capacidade: 8, iconUrl, bannerUrl
    });
    const nomeArq = `sala_${String(sala.session_id || 'x').replace(/[^\w-]/g, '').slice(0, 12)}_${estado}_${Date.now()}.jpg`;
    const payload = { files: [{ attachment: buf, name: nomeArq }] };
    // Modo ANTIBAN: quem envia é o bot oficial, então a foto vai DENTRO de um embed.
    try {
      const uidA = userIdDoCanal(canal), gidA = guildIdDaMensagem({ channel: canal });
      if (uidA && gidA && canalEhSelfbot(canal) && antibanAtivo(uidA, gidA)) {
        payload.embeds = [new EmbedBuilder().setColor(COR.principal).setImage(`attachment://${nomeArq}`)];
      }
    } catch {}
    return await enviarCanal(canal, payload);
  } catch (e) {
    aviso(`Foto da sala (${estado}) falhou — usando o texto: ${String(e && e.message).slice(0, 160)}`);
    return null;
  }
}
// Busca o status da sala e manda a mensagem NOVA de "sala iniciada" — SÓ a foto (a de "sala criada" fica como está). Só uma por sala.
async function rxAtualizarSlots(canal, sala) {
  try {
    let teams = Array.isArray(sala.teamsStatus) ? sala.teamsStatus : [];
    try {
      const r = await rxHttp('GET', `/rooms/${sala.session_id}/status`);
      if (r.status === 200 && r.json) {
        teams = r.json.teams || [];
        info(`🎮 Sala ${sala.session_id}: slots brutos da API: ${JSON.stringify(teams).slice(0, 700)}`);
        sala.teamsStatus = teams;
      }
    } catch (eS) { aviso(`Atualizar slots ${sala.session_id}: status indisponível (${eS.message}) — uso os últimos jogadores conhecidos.`); }
    if (sala.msgIniciadaEnviada) return;
    sala.msgIniciadaEnviada = true;
    try {
      let m = await enviarFotoSala(canal, sala, 'iniciada', teams);
      sala.fotoMsg = !!m;
      if (!m) m = await enviarCanal(canal, rxTextoSlots(teams, true));   // fallback: texto antigo (só se a foto falhar)
      sala.mensagemInicial = m;   // com foto, as edições ao vivo ficam desligadas (ver AO_VIVO_NA_FOTO)
      salaAtivaRegistrar(sala);
    } catch (e) { sala.msgIniciadaEnviada = false; throw e; }
  } catch (e) { aviso(`Atualizar slots ${sala.session_id}: ${e.message}`); }
}
function rxTextoSlots(teams = [], iniciada = false) {
  const linhas = [];

  function obterTime(numero) {
    const lista = Array.isArray(teams) ? teams : [];
    const baseZero = lista.some(t => Number(t?.index) === 0);

    return lista.find((t, i) => {
      if (t?.index !== undefined && t?.index !== null) {
        return Number(t.index) + (baseZero ? 1 : 0) === numero;
      }

      if (t?.team !== undefined && t?.team !== null) {
        const valorTime = Number(t.team);
        return valorTime === numero || valorTime + 1 === numero;
      }

      return i + 1 === numero;
    });
  }

  function obterJogador(slot) {
    if (!slot) return '';

    const jogador =
      typeof slot === 'string'
        ? slot
        : slot.nickname ||
          slot.player?.nickname ||
          slot.player?.name ||
          slot.player_name ||
          slot.name ||
          slot.username ||
          slot.account_id ||
          slot.player?.account_id ||
          '';

    return String(jogador).trim();
  }

  linhas.push(
    iniciada
      ? '# `🟢` SALA INCIADA COM SUCESSO'
      : '# SALA CRIADA',
    '',
    '# TIME UM'
  );

  function adicionarSlots(numero) {
    const time = obterTime(numero);
    const slots = Array.isArray(time?.slots) ? time.slots : [];

    for (let i = 0; i < 4; i++) {
      const jogador = obterJogador(slots[i]);
      const emoji = iniciada && jogador ? '🟢' : '🟡';
      const plat = jogador ? rxEmojiPlataforma(slots[i]) : '';

      linhas.push(
        `## \`${emoji}\` SLOT${i + 1} - ${jogador || 'Nenhum Jogador'}${plat ? ` ${plat}` : ''}`
      );
    }
  }

  adicionarSlots(1);

  linhas.push('', '# TIME DOIS');

  adicionarSlots(2);

  if (!iniciada) {
    linhas.push(
      '',
      '> Os dois jogadores devem confirmar com `go` para iniciar a sala.',
      '> Se ninguém confirmar, a sala iniciará automaticamente após 5 minutos.'
    );
  }

  return linhas.join('\n');
}
function rxNomeJogador(p) {
  if (!p) return '';
  if (typeof p === 'string') return p;
  return String(p.nickname || p.nick || p.name || p.player_name || p.username || p.account_id || p.id || '').trim();
}
function rxTimeVenceu(t) {
  if (!t) return false;
  if (t.won === true || t.winner === true || t.is_winner === true || t.victory === true) return true;
  const r = String(t.result || t.outcome || t.status || '').toLowerCase();
  return /^(win|won|winner|victory|vitoria|vencedor)$/.test(r);
}
function rxAcharVencedor(res) {
  const times = Array.isArray(res && res.teams) ? res.teams : [];
  let venc = times.find(rxTimeVenceu);
  if (!venc) {
    // Formatos alternativos: número/ID do time vencedor no topo da resposta.
    const w = res && (res.winner_team ?? res.winning_team ?? res.winner ?? res.winnerTeam);
    if (w !== undefined && w !== null && typeof w !== 'object') {
      venc = times.find(t => t && (t.team === w || t.id === w || t.team_id === w || String(t.team) === String(w)));
    } else if (w && typeof w === 'object') {
      venc = times.find(t => t && t.team === w.team) || w;
    }
  }
  return venc || null;
}
function rxTemResultado(res) {
  return !!rxAcharVencedor(res);
}
function rxStat(p, chaves) {
  for (const k of chaves) {
    for (const o of [p, p && p.stats]) {
      const v = o && o[k];
      if ((typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)))) return Number(v);
    }
  }
  return null;
}
function rxLinhaJogador(p) {
  const nome = rxNomeJogador(p) || '—';
  if (!p || typeof p !== 'object') return { nome, texto: nome, temStats: false };
  const partes = [];
  const k = rxStat(p, ['kills', 'kill', 'eliminations', 'abates']);
  const m = rxStat(p, ['deaths', 'death', 'mortes']);
  const a = rxStat(p, ['assists', 'assist', 'assistencias']);
  const d = rxStat(p, ['damage', 'damage_dealt', 'total_damage', 'dano']);
  if (k !== null) partes.push(`${k} abates`);
  if (m !== null) partes.push(`${m} mortes`);
  if (a !== null) partes.push(`${a} assist.`);
  if (d !== null) partes.push(`${Math.round(d).toLocaleString('pt-BR')} dano`);
  return { nome, texto: partes.length ? `${nome} — ${partes.join(' · ')}` : nome, temStats: partes.length > 0 };
}
function rxTextoFinal(res) {
  const times = Array.isArray(res && res.teams) ? res.teams : [];
  const venc = rxAcharVencedor(res);
  const perd = times.find(t => t && t !== venc && (!venc || t.team !== venc.team));
  const jogadoresDe = t => {
    if (!t) return [];
    const lista = Array.isArray(t.players) ? t.players : (Array.isArray(t.slots) ? t.slots : []);
    return lista.filter(p => p && (typeof p === 'string' || p.played !== false));
  };
  const nomes = t => {
    const linhas = jogadoresDe(t).map(rxLinhaJogador).filter(l => l.nome);
    if (!linhas.length) return '—';
    // Com estatísticas: uma linha por jogador. Sem estatísticas: só os nomes, como antes.
    return linhas.some(l => l.temStats) ? linhas.map(l => `### ${l.texto}`).join('\n') : `### ${linhas.map(l => l.nome).join(', ')}`;
  };
  const slot = t => (t && Number.isFinite(Number(t.team)) ? Number(t.team) + 1 : '?');
  const rounds = t => { const n = t ? rxStat(t, ['rounds_won', 'roundsWon', 'rounds', 'score', 'wins']) : null; return n !== null ? ` (${n} rounds)` : ''; };
  const todos = times.flatMap(t => jogadoresDe(t)).filter(p => p && typeof p === 'object');
  let mvp = todos.find(p => p.mvp && p.mvp_medal === 'gold') || todos.find(p => p.mvp === true || p.is_mvp === true);
  if (!mvp && res && res.mvp) mvp = typeof res.mvp === 'object' ? res.mvp : { nickname: String(res.mvp) };
  const linhaMvp = mvp ? rxLinhaJogador(mvp).texto : '—';
  return [
    '# `🟢` PARTIDA FINALIZADA!', '',
    `## VENCEDORES: SLOT ${slot(venc)}${rounds(venc)}`, '', nomes(venc), '',
    `## PERDEDORES: SLOT ${slot(perd)}${rounds(perd)}`, '', nomes(perd), '',
    `## MVP🏆: ${linhaMvp}`
  ].join('\n');
}
// ============================================================
// PARTIDA AO VIVO: edita a mensagem da sala com rounds, kills, dano e líderes (limite do Discord: 2000 chars)
// ============================================================
const AO_VIVO_INTERVALO_MS = 15000;
const AO_VIVO_MAX_EDICOES = 18;   // máximo de edições da mensagem da sala por partida (persistido: reiniciar o bot NÃO zera)   // no máx. 1 edição a cada 15s (bem abaixo do limite de edições do Discord)
function rxJogadoresDe(t) {
  if (!t) return [];
  const lista = Array.isArray(t.players) ? t.players : (Array.isArray(t.slots) ? t.slots : []);
  return lista.filter(p => p && typeof p === 'object' && p.played !== false);
}
function rxDadosAoVivo(res) {
  const times = Array.isArray(res && res.teams) ? res.teams : [];
  const jogadores = [];
  times.forEach((t, ti) => {
    for (const p of rxJogadoresDe(t)) {
      const kills = rxStat(p, ['kills', 'kill', 'eliminations', 'abates']);
      const dano = rxStat(p, ['damage', 'damage_dealt', 'total_damage', 'dano']);
      const mortes = rxStat(p, ['deaths', 'death', 'mortes']);
      jogadores.push({ nome: rxNomeJogador(p) || '—', time: ti, kills, dano, mortes });
    }
  });
  if (!jogadores.some(j => j.kills !== null || j.dano !== null)) return null;   // API ainda sem estatísticas
  const roundsTime = times.map(t => (t ? rxStat(t, ['rounds_won', 'roundsWon', 'rounds', 'score', 'wins']) : null));
  const roundAtual = rxStat(res || {}, ['current_round', 'round', 'currentRound']);
  const roundsTotal = rxStat(res || {}, ['total_rounds', 'rounds_total', 'max_rounds']);
  return { jogadores, roundsTime, roundAtual, roundsTotal };
}
function rxTextoAoVivo(sala, dados) {
  const base = salaEmModoFoto(sala) ? '' : rxTextoSlots(sala.teamsStatus || [], true);
  const fmt = n => (n === null || n === undefined ? '0' : Math.round(n).toLocaleString('pt-BR'));
  const topo = (campo) => dados.jogadores.filter(j => j[campo] !== null).sort((a, b) => b[campo] - a[campo])[0];
  const mk = topo('kills'), md = topo('dano');
  const rounds = (dados.roundsTime || []);
  const cab = [`# 📊 AO VIVO${dados.roundAtual !== null ? ` — ROUND ${dados.roundAtual}${dados.roundsTotal !== null ? `/${dados.roundsTotal}` : ''}` : ''}`];
  if (rounds.some(n => n !== null)) cab.push(`**Rounds:** TIME UM \`${rounds[0] ?? 0}\` x \`${rounds[1] ?? 0}\` TIME DOIS`);
  if (mk && mk.kills > 0) cab.push(`🔫 **Mais kills:** ${mk.nome} (${fmt(mk.kills)})`);
  if (md && md.dano > 0) cab.push(`💥 **Mais dano:** ${md.nome} (${fmt(md.dano)})`);
  const linhasJog = dados.jogadores
    .slice().sort((a, b) => (b.kills || 0) - (a.kills || 0) || (b.dano || 0) - (a.dano || 0))
    .map(j => `\`T${j.time + 1}\` ${j.nome} — ${fmt(j.kills)}K${j.mortes !== null ? `/${fmt(j.mortes)}M` : ''} · ${fmt(j.dano)} dano`);
  // Respeita o limite de 2000 caracteres: tira jogadores do fim até caber; por último corta o texto.
  let n = linhasJog.length;
  let texto;
  do {
    texto = [base, '', ...cab, ...(n ? ['', ...linhasJog.slice(0, n), ...(n < linhasJog.length ? [`-# +${linhasJog.length - n} jogadores`] : [])] : [])].join('\n');
    n--;
  } while (texto.length > 2000 && n >= -1);
  return texto.length > 2000 ? `${texto.slice(0, 1997)}...` : texto;
}
async function rxEditarAoVivo(sala, res) {
  const dados = rxDadosAoVivo(res);
  if (!dados || !sala.mensagemInicial) return false;
  if (salaEmModoFoto(sala) && !AO_VIVO_NA_FOTO) return false;   // sala em foto: a mensagem fica SÓ com a imagem
  const agora = Date.now();
  if ((sala.edicoes || 0) >= AO_VIVO_MAX_EDICOES) return false;   // limite atingido: para de editar
  if (agora - (sala.aoVivoUltimaEdicao || 0) < AO_VIVO_INTERVALO_MS) return false;
  const texto = rxTextoAoVivo(sala, dados);
  if (texto === sala.aoVivoUltimoTexto) return false;
  try {
    sala.edicoes = (sala.edicoes || 0) + 1;
    salaAtivaRegistrar(sala, { edicoes: sala.edicoes });
    await editarMsgSegura(sala.mensagemInicial, texto);
    sala.aoVivoUltimoTexto = texto;
    sala.aoVivoUltimaEdicao = agora;
    return true;
  } catch (e) {
    sala.aoVivoUltimaEdicao = agora;   // não insiste em loop se o Discord recusou
    aviso(`Ao vivo ${sala.session_id}: não consegui editar (${e.message}).`);
    return false;
  }
}
// RECUPERAÇÃO após reiniciar: NÃO envia mensagens sozinha. Apenas religa o
// acompanhamento interno das salas que estavam em andamento; o usuário decide
// pelo painel o que fazer (as mensagens de GO/partida NÃO são reenviadas).
async function recuperarSalas() {
  for (const r of [...salasAtivas.values()]) {
    (async () => {
      const agora = Date.now();
      const expirada = r.iniciadaEm ? agora - r.iniciadaEm > 90 * 60 * 1000 : agora - (r.criadaEm || 0) > 3 * 3600 * 1000;
      if (expirada) { salaAtivaRemover(r.canalId, r.sid); return; }
      if (salasRestauradas.has(r.canalId)) return;
      salasRestauradas.add(r.canalId);
      const canal = await aguardarCanalSelfbot(r.userId, r.canalId, 240000);
      if (!canal) { aviso(`[Recuperação] Sala ${r.sid}: canal ${r.canalId} indisponível.`); salasRestauradas.delete(r.canalId); return; }
      if (salasAguardandoGo.has(canal.id)) return;
      const sala = {
        session_id: r.sid, room_id: r.roomId, password: r.password, iniciadaEm: r.iniciadaEm || null,
        canalId: r.canalId, userId: r.userId, guildId: r.guildId || null, jogadores: r.jogadores || [], edicoes: r.edicoes || 0,
        provider: r.provider || 'rx', modoTipo: r.modoTipo || null
      };
      if (r.msgSlotsId) { try { sala.mensagemInicial = await canal.messages.fetch(r.msgSlotsId); } catch {} }
      if (r.iniciadaEm) sala.msgIniciadaEnviada = true;   // já havia sido anunciada antes do restart
      if (!r.iniciadaEm) {
        const rs = await rxHttp('GET', `/rooms/${r.sid}/status`).catch(() => null);
        if (rs && (rs.status === 404 || rs.status === 410)) { salaAtivaRemover(r.canalId, r.sid); return; }
        // NÃO reenvia o GO automaticamente: apenas marca a sala como restaurada
        // e deixa o acompanhamento interno ativo. O usuário decide pelo painel.
        sala.msgGoEnviada = true;
      }
      sucesso(`[Recuperação] Sala ${r.sid} em #${canal.name} religada (${r.iniciadaEm ? 'partida em andamento' : 'aguardando GO'}) — nenhuma mensagem foi reenviada.`);
      acompanharSala(canal, sala).catch(e => aviso(`Acompanhar sala (recuperada): ${e.message}`));
    })().catch(e => aviso(`[Recuperação] Sala ${r.sid}: ${e.message}`));
  }
}
async function esperarSala(sala, ms) {
  const fim = Date.now() + ms;
  while (Date.now() < fim && !sala.iniciadaEm) await esperar(1000);
}
async function acompanharSala(canal, sala) {
  const sid = sala.session_id;
  let msg = sala.mensagemInicial || null;
  let ultimo = '';
  let ultimoStatusResultado = '';
  let falhasEnvio = 0;
  let limite = Date.now() + 2 * 3600 * 1000;
  let abortada = false;

  try {
    // Atualiza a mesma mensagem enquanto a sala aguarda o início.
    let ultimoTeams = [];
    let ultimoAntesEspera = null;
    while (Date.now() < limite) {
      // Já foi iniciada pelo /start: marca os slots como iniciados e vai direto para o resultado.
      if (sala.iniciadaEm) {
        await rxAtualizarSlots(canal, sala);
        break;
      }
      try {
        const r = await rxHttp('GET', `/rooms/${sid}/status`);

        if (r.status === 401 || r.status === 403) {
          aviso('Sala ' + sid + ': API recusou a consulta (' + r.status + ') — acompanhamento interrompido.');
          abortada = true;
          return;
        }
        if (r.status === 404 || r.status === 410) {
          if (!sala.iniciadaEm) await esperar(15000);
          break;
        }

        if (r.status === 200 && r.json && r.json.room) {
          const statusSala = String(r.json.room.status || '').toLowerCase();
          const encerradaSala = /closed|released|cancel|expired|encerr/.test(statusSala);
          const iniciada = statusSala !== 'active' && !encerradaSala;
          if (encerradaSala && !sala.iniciadaEm) { aviso(`Sala ${sid}: foi encerrada/expirou sem iniciar (status "${statusSala}").`); break; }
          ultimoTeams = r.json.teams || [];
          const texto = rxTextoSlots(r.json.teams || [], iniciada);

          if (texto !== ultimo) {
            ultimo = texto;

            if (!msg) {
              // Sem mensagem da sala (ex.: reinício do bot): manda a foto; só cai no texto se a foto falhar.
              const fotoNova = await enviarFotoSala(canal, sala, iniciada ? 'iniciada' : 'criada', r.json.teams || []);
              if (fotoNova) { msg = fotoNova; sala.fotoMsg = true; if (iniciada) sala.msgIniciadaEnviada = true; }
              else msg = await enviarCanal(canal, texto);
            } else if (salaEmModoFoto(sala) || msgTemFoto(msg)) {
              // Sala em FOTO: não edita texto por cima da imagem. A foto de "iniciada" sai como mensagem nova (abaixo).
            } else {
              try {
                if ((sala.edicoes || 0) >= AO_VIVO_MAX_EDICOES) throw new Error('limite de edições da sala atingido');
                sala.edicoes = (sala.edicoes || 0) + 1;
                salaAtivaRegistrar(sala, { edicoes: sala.edicoes });
                await editarMsgSegura(msg, texto);
              } catch (e) {
                aviso(`Não consegui atualizar os slots da sala ${sid}: ${e.message}`);
              }
            }
          }

          // Quando o status mudar de "active", exibe a mensagem de sala iniciada.
          if (iniciada) {
            if (!sala.iniciadaEm) { sala.iniciadaEm = Date.now(); salaAtivaRegistrar(sala); }
            // Sala em foto: a mensagem de "iniciada" é uma foto NOVA (rxAtualizarSlots só envia uma vez por sala).
            if ((salaEmModoFoto(sala) || msgTemFoto(msg)) && !sala.msgIniciadaEnviada) await rxAtualizarSlots(canal, sala);
            break;
          }
        }
      } catch (eS) {
        aviso(`Sala ${sid}: erro ao consultar o status (${eS.message}), tentando de novo.`);
      }

      const semNovidade = ultimo === ultimoAntesEspera;
      ultimoAntesEspera = ultimo;
      await esperarSala(sala, semNovidade ? 60000 : 10000);
    }

     // Aguarda o resultado da partida sem publicar outra mensagem de slots.
    // Sala que nunca foi iniciada (expirou vazia) não tem resultado: não consulta.
    if (!sala.iniciadaEm) {
      aviso(`Sala ${sid}: encerrou sem ser iniciada — sem resultado para buscar.`);
      return;
    }
    // Começa a consultar o /result logo depois do /start, a cada 10s (respeitando poll_after_seconds / Retry-After).
    const inicioPartida = sala.iniciadaEm;
    limite = inicioPartida + 90 * 60 * 1000;   // partida pode demorar: espera até 90 min
    let semResultado = 0;
    let primeiro404 = 0;
    let espera = 0;

    while (Date.now() < limite) {
      if (espera) await esperar(espera);
      espera = 10000;

      let r;
      try {
        r = await rxHttp('GET', `/rooms/${sid}/result`);
      } catch (eR) {
        aviso(`Sala ${sid}: erro ao consultar o resultado (${eR.message}), tentando de novo.`);
        continue;
      }

      const pollApi = Math.max(Number(r.json && r.json.poll_after_seconds) || 0, Number(r.retryAfter) || 0);
      if (pollApi > 0) espera = Math.max(espera, pollApi * 1000);

      // 404 = resultado ainda não existe (a partida está rolando). Continua esperando até o limite.
      if (r.status === 404) {
        if (!primeiro404) primeiro404 = Date.now();
        espera = Math.max(espera, 60000);
        if (++semResultado % 12 === 0) info(`Sala ${sid}: /result ainda 404 (${Math.round((Date.now() - inicioPartida) / 60000)} min de partida), aguardando.`);
        continue;
      }
      primeiro404 = 0;
      const statusRes = String((r.json && r.json.status) || '').toLowerCase();
      if (r.status === 200 && statusRes !== ultimoStatusResultado) {
        ultimoStatusResultado = statusRes;
        info(`🏁 Sala ${sid}: status do resultado = "${statusRes || '(vazio)'}"`);
      }

      const temVencedor = r.status === 200 && rxTemResultado(r.json);

      if (r.status === 200 && (/finaliz|finish|complet|ended|encerr/.test(statusRes) || temVencedor)) {
        try {
          info(`🏁 Sala ${sid}: resultado bruto da API: ${JSON.stringify(r.json).slice(0, 700)}`);
          if (await resultadoJaEnviado(canal, sala)) { info(`Sala ${sid}: resultado já estava no canal — não envio de novo.`); return; }
          await enviarCanal(canal, rxTextoFinal(r.json));
          info(`🏆 Sala ${sid}: resultado enviado em #${canal.name}`);
          return;
        } catch (eF) {
          aviso(`Sala ${sid}: não consegui enviar o resultado (${eF.message}).`);
          if (++falhasEnvio >= 5) return;
          continue;
        }
      }

      if (r.status === 200 && statusRes === 'no_match') {
        try { await enviarCanal(canal, '# `🟡` PARTIDA SEM RESULTADO\nA partida terminou sem resultado válido (no_match).'); } catch {}
        return;
      }

      if (r.status === 200) {
        semResultado = 0;
        // Partida rolando: atualiza a mensagem da sala com rounds/kills/dano (se a API já mandar estatísticas).
        try {
          let fonte = r.json;
          if (!rxDadosAoVivo(fonte)) {
            const rs2 = await rxHttp('GET', `/rooms/${sid}/status`).catch(() => null);
            if (rs2 && rs2.status === 200 && rs2.json) { fonte = rs2.json; if (Array.isArray(rs2.json.teams)) sala.teamsStatus = sala.teamsStatus || rs2.json.teams; }
          }
          const editou = await rxEditarAoVivo(sala, fonte);
          espera = Math.max(espera, editou ? 15000 : 60000);
        } catch (eV) { aviso(`Ao vivo ${sid}: ${eV.message}`); }
        continue;
      }

      if (r.status === 401 || r.status === 403) {
        aviso(`Sala ${sid}: API recusou a consulta do resultado (${r.status}).`);
        abortada = true;
        return;
      }

      if (++semResultado % 30 === 0) {
        aviso(`Sala ${sid}: ainda sem resultado (${r.status}), continuo aguardando.`);
      }
    }
    aviso(`Sala ${sid}: passou o tempo limite sem resultado final.`);
    try { await enviarCanal(canal, '# `🟡` NÃO CONSEGUI PEGAR O RESULTADO\nA API não devolveu o resultado desta partida a tempo. Confira com o ADM.'); } catch {}
  } finally {
    salaAtivaRemover(sala.canalId || canal.id, sid);
    if (!abortada) rxHttp('POST', `/rooms/${sid}/release`, {}).catch(logErro);
  }
}
const RX_PATH_START = process.env.RX_PATH_START || '/rooms/{sid}/start';
const RX_PATH_CHAT = process.env.RX_PATH_CHAT || '/rooms/{sid}/chat';
const salasAguardandoGo = new Map();
function rxPost(caminhoTpl, sala, corpo) {
  if (caminhoTpl === RX_PATH_CHAT && (['cupula', 'nix'].includes(sala.provider) || ['cupula', 'nix'].includes(provedorPorSid.get(sala.session_id)))) {
    return Promise.resolve({ status: 204, json: {}, retryAfter: 0 });   // a Cúpula não tem chat de sala
  }
  return rxHttp('POST', caminhoTpl.replace('{sid}', encodeURIComponent(sala.session_id)), corpo || {}, crypto.randomUUID());
}
function rxContarJogadores(teams) {
  let n = 0;
  for (const t of (Array.isArray(teams) ? teams : [])) {
    const slots = Array.isArray(t && t.slots) ? t.slots : [];
    for (const s of slots) {
      if (!s) continue;
      const j = typeof s === 'string' ? s : (
        s.nickname || (s.player && (s.player.nickname || s.player.name || s.player.account_id)) ||
        s.player_name || s.name || s.username || s.account_id || ''
      );
      if (String(j).trim()) n++;
    }
  }
  return n;
}
async function iniciarSalaGo(canalId) {
  const st = salasAguardandoGo.get(canalId);
  if (!st || st.iniciada) return false;
  st.iniciada = true;
  clearTimeout(st.timer);
  salasAguardandoGo.delete(canalId);
  const sid = st.sala.session_id;
  const TENTATIVAS = 6;
  for (let t = 1; t <= TENTATIVAS; t++) {
    try {
      // Antes do /start: só inicia se tiver jogador na sala
      const rs = await rxHttp('GET', `/rooms/${sid}/status`);
      if (rs.status === 401 || rs.status === 403) {
        aviso('[' + st.userId + '] API recusou o status da sala (' + rs.status + ') — NÃO iniciada, sem novas tentativas.');
        return false;
      }
      if (rs.status === 404 || rs.status === 410) {
        aviso(`[${st.userId}] Sala ${sid} não existe mais (${rs.status}) — NÃO iniciada.`);
        return false;
      }
      if (rs.status !== 200 || rxContarJogadores(rs.json && rs.json.teams) === 0) {
        aviso(`[${st.userId}] Sala ${sid} sem jogadores ou status ${rs.status} (tentativa ${t}/${TENTATIVAS}) — aguardando antes do /start.`);
        if (t < TENTATIVAS) await esperar(2000);
        continue;
      }
      const r = await rxPost(RX_PATH_START, st.sala);
      if (r.status >= 400) throw new Error(`API ${r.status}: ${JSON.stringify(r.json.error || r.json).slice(0, 200)}`);
      st.sala.iniciadaEm = Date.now();
      salaAtivaRegistrar(st.sala);
      return true;
    } catch (e) {
      aviso(`[${st.userId}] Falha ao iniciar sala (GO) tentativa ${t}/${TENTATIVAS}: ${e.message}`);
      if (t < TENTATIVAS) await esperar(1500);
    }
  }
  return false;
}
async function prepararGo(canal, userId, sala, restaurar = null) {
  const antigo = salasAguardandoGo.get(canal.id);

  if (antigo) {
    clearTimeout(antigo.timer);
  }

  const min = 5;
  Object.assign(sala, { canalId: canal.id, userId, guildId: guildIdDaMensagem({ channel: canal }) || null });
  const restanteMs = restaurar && Number.isFinite(restaurar.restanteMs) ? restaurar.restanteMs : min * 60000;

  const st = {
    userId,
    sala,
    gos: new Set(restaurar && Array.isArray(restaurar.gos) ? restaurar.gos.map(String) : []),
    jogadores: restaurar && Array.isArray(restaurar.jogadores) ? restaurar.jogadores.map(String) : [],
    iniciada: false,
    timer: null
  };

  st.timer = setTimeout(() => {
    if (salasAguardandoGo.get(canal.id) !== st) return;

    info(`⏱️ [${userId}] 5 minutos sem dois GO — iniciando sala.`);
    iniciarSalaGo(canal.id).then(async ok => {
      if (ok) await rxAtualizarSlots(canal, sala);
      else enviarCanal(canal, '# `🔴` SALA NÃO INICIADA\n> Não havia jogadores na sala ou a API recusou o início.').catch(logErro);
    }).catch(logErro);
  }, restanteMs);

  salasAguardandoGo.set(canal.id, st);
  salaAtivaRegistrar(sala, { goExpiraEm: Date.now() + restanteMs, gos: [...st.gos] });

  // Descobre os 2 jogadores (para marcar quem falta dar GO).
  if (st.jogadores.length < 2) {
    jogadoresDoCanalGo(canal).then(ids => {
      if (ids.length === 2) { st.jogadores = ids.map(String); sala.jogadores = st.jogadores; salaAtivaRegistrar(sala); }
    }).catch(logErro);
  }

  if (!restaurar) {
    rxPost(RX_PATH_CHAT, sala, {
      message: 'Para começar a sala, envie .go aqui nesse chat do jogo'
    })
      .then(r => {
        if (r.status >= 400) {
          aviso(`Chat do jogo: API ${r.status}`);
        }
      })
      .catch(e => aviso(`Chat do jogo: ${e.message}`));
  }
}
async function tratarGo(mensagem, st) {
  const autor = String(mensagem.author.id);
  if (st.iniciada || st.gos.has(autor)) return;
  // Se já sabemos quem são os 2 jogadores, só o GO deles conta.
  if (st.jogadores.length === 2 && !st.jogadores.includes(autor)) return;
  st.gos.add(autor);
  salaAtivaRegistrar(st.sala, { gos: [...st.gos] });
  const canalGo = mensagem.channel;
  if (st.gos.size >= 2) {
    iniciarSalaGo(canalGo.id).then(async ok => {
      if (!ok) {
        enviarCanal(canalGo, '❌ Não consegui iniciar a sala automaticamente. Ela iniciará sozinha ou tente de novo.').catch(logErro);
        return;
      }
      // Sala iniciada: mostra quem ficou em cada slot, com 📱 (mobile) ou 💻 (emulador).
      await rxAtualizarSlots(canalGo, st.sala);
    }).catch(logErro);
    try {
      await enviarCanal(
        canalGo,
        '# > `🟢` GO CONFIRMADO\n' +
        '> Partida sendo iniciada com sucesso.'
      );
    } catch {}
    return;
  }
  const outro = st.jogadores.find(id => id !== autor);
  try {
    await enviarCanal(
      canalGo,
      '# > `🟢` GO CONFIRMADO\n' +
      `> <@${autor}> Seu go foi confirmado.\n` +
      `> Falta a confirmação do ${outro ? `<@${outro}>` : 'outro jogador'}`
    );
  } catch {}
}
const cmdAutoPorCanal = new Map();
// Prefixo "+" apenas: +cs, +cs2, +cs 2 ... (com ou sem espaço entre o cs e o número).
const RX_CMD_SALA = /^\+cs\s*(\d{1,2})?\s*$/i;
const TIPO_POR_NUMERO = {
  '1': 'normal',
  '2': 'infinito',
  '3': 'fullcapa',
  '4': 'tatico',
  '5': 'speed'
};
const NOME_MODO_SALA = { normal: 'NORMAL', infinito: 'INFINITA', tatico: 'TÁTICA', fullcapa: 'FULL CAPA', speed: 'SPEED' };
async function enviarMensagensSala(canal, tipo, sala) {
  // 1ª mensagem: SÓ a foto da sala (mesma arte do salas.zip). Se a foto falhar, cai no texto antigo.
  let mensagemSlots = await enviarFotoSala(canal, sala, 'criada', []);
  sala.fotoMsg = !!mensagemSlots;
  if (!mensagemSlots) mensagemSlots = await enviarCanal(canal, rxTextoSlots([], false));

  // 2ª mensagem: somente o ID.
  await enviarCanal(canal, String(sala.room_id));

  // 3ª mensagem: somente a senha.
  await enviarCanal(canal, String(sala.password || '22'));

  return mensagemSlots;
}
async function comandoSalaManual(mensagem, userId, num) {
  const cfg = obterConfigUsuario(userId);
  const canal = mensagem.channel;
  if (Date.now() - (cmdAutoPorCanal.get(canal.id) || 0) < 8000) return;
  const disp = Number(cfg.salasCompradas) || 0;
  // Cria pela API se o modo automed estiver ligado OU se a pessoa tiver salas compradas.
  if (!automedAtivoNoServidor(cfg, guildIdDaMensagem(mensagem)) && disp <= 0 && !ehLiberado(userId)) {
    await apagarComando(mensagem);
    await enviarCanal(
      canal,
      '❌ Você não tem salas disponíveis. Ative a criação automática ou compre salas para usar este comando.'
    );
    return;
  }
  const tipo = TIPO_POR_NUMERO[num] || 'normal';
  await apagarComando(mensagem);
  if (disp <= 0 && !ehLiberado(userId)) {
    await enviarCanal(canal, '❌ Você não tem salas disponíveis. Compre em **Comprar salas**.');
    return;
  }
  try {
    const sala = await rxCriarSala(tipo, String(cfg.senhaFixa || '').trim());
    if (sala && sala.session_id) evtRegistrar({ chave: `s|api|${sala.session_id}`, tipo: 'sala', resp: userId });   // conta NA HORA, mesmo se o envio das mensagens falhar
    salvarConfigUsuario(userId, {
      salasCompradas: disp > 0 ? disp - 1 : disp,
      salasCriadas: (Number(cfg.salasCriadas) || 0) + 1
    });
    if (disp > 0) salasBotRegistrarDelta(userId, -1);
    sala.mensagemInicial = await enviarMensagensSala(canal, tipo, sala);
    info(`🎮 [${userId}] Sala ${tipo} criada MANUAL em #${canal.name} (${sala.room_id}) • API: ${NOME_API_SALA[sala.provider] || sala.provider || '?'}`);
    evtRegistrar({ chave: `s|api|${sala.session_id}`, tipo: 'sala', resp: userId });
    logEmbed('geral', '🎮 Sala criada (manual)', [['Modo', tipo, true], ['ID', String(sala.room_id), true], ['Senha', String(sala.password), true], ['Canal', `#${canal.name}`, true], ['Salas restantes', String(Number(obterConfigUsuario(userId).salasCompradas) || 0), true]], userId).catch(logErro);
    prepararGo(canal, userId, sala).catch(e => aviso(`GO: ${e.message}`));
    acompanharSala(canal, sala).catch(e => aviso(`Acompanhar sala: ${e.message}`));
  } catch (e) {
    aviso(`[${userId}] Falha ao criar sala manual: ${e.message}`);
    await enviarCanal(canal, `❌ Não consegui criar a sala: \`${String(e.message).slice(0, 200)}\``).catch(logErro);
  }
}
const GROQ_KEY = String(process.env.GROQ_API_KEY || '').trim();
const GROQ_MODEL = String(process.env.GROQ_MODEL || 'llama-3.1-8b-instant').trim();
const IA_MAX_CANAIS = 5;
const iaRespCache = new Map();
const iaMsgCache = new Map();
// Base salva em disco: os canais da IA são lidos UMA vez (ao configurar) e ficam guardados; perguntas usam só a base salva.
const IA_BASE_PATH = path.join(__dirname, 'ia_base.json');
const IA_REFRESH_MS = 60 * 60 * 1000;          // atualiza em segundo plano se a base tiver mais de 1h (a resposta nunca espera)
const IA_PAGINAS = 5;                           // 5 x 100 = até 500 mensagens por canal
let iaBase = {};
try { if (fs.existsSync(IA_BASE_PATH)) iaBase = JSON.parse(fs.readFileSync(IA_BASE_PATH, 'utf8')) || {}; } catch { iaBase = {}; }
let _iaBaseTimer = null;
function iaBaseSalvar() {
  clearTimeout(_iaBaseTimer);
  _iaBaseTimer = setTimeout(() => {
    try { const tmp = `${IA_BASE_PATH}.tmp`; fs.writeFileSync(tmp, JSON.stringify(iaBase)); fs.renameSync(tmp, IA_BASE_PATH); }
    catch (e) { aviso(`IA: não consegui salvar a base: ${e.message}`); }
  }, 800);
}
const iaLendo = new Map();   // canalId -> Promise (evita ler o mesmo canal 2x ao mesmo tempo)
const IA_STOP = new Set(['qual','quais','como','que','para','pra','com','uma','uns','umas','por','mais','meu','minha','seu','sua','tem','tenho','esta','esse','essa','isso','aqui','adm','voce','vcs','ser','sao','foi','nao','sim','onde','quando','quem','pode','posso']);
function iaTodosCanais(userId) {
  return (carregarConfigs()[userId] || {}).iaCanais || {};
}
function iaConfig(userId, guildId) {
  const l = iaTodosCanais(userId)[guildId];
  return Array.isArray(l) ? l : [];
}
function salvarIaCanais(userId, guildId, lista) {
  const todas = carregarConfigs();
  const atual = { ...(todas[userId] || {}) };
  const o = { ...(atual.iaCanais || {}) };
  if (lista.length) o[guildId] = lista; else delete o[guildId];
  if (Object.keys(o).length === 0) delete atual.iaCanais; else atual.iaCanais = o;
  if (Object.keys(atual).length === 0) delete todas[userId]; else todas[userId] = atual;
  salvarConfigs(todas);
  for (const cid of lista) if (!iaBase[cid]) setImmediate(() => iaAtualizarCanal(userId, cid));   // já lê e salva ao configurar
}
async function iaLerCanalDoDiscord(userId, canalId) {
  const sb = selfbots.get(userId);
  let ch = null;
  const gerente = (sb && sb.channels && sb.channels.cache) ? sb.channels : null;   // conta virtual (antiban) não tem channels
  if (gerente) ch = gerente.cache.get(canalId) || await gerente.fetch(canalId).catch(() => null);
  if (!ch && typeof botClient !== 'undefined' && botClient && botClient.channels) {
    ch = botClient.channels.cache.get(canalId) || await botClient.channels.fetch(canalId).catch(() => null);
  }
  if (!ch || !ch.messages) return null;
  const todas = [];
  let antes;
  for (let p = 0; p < IA_PAGINAS; p++) {
    const msgs = await ch.messages.fetch(antes ? { limit: 100, before: antes } : { limit: 100 }).catch(() => null);
    if (!msgs || !msgs.size) break;
    const arr = Array.from(msgs.values());
    todas.push(...arr);
    if (arr.length < 100) break;
    antes = arr[arr.length - 1].id;
  }
  if (!todas.length) return null;
  return todas
    .map(m => limparTexto(extrairTextoComEmbeds(m)))
    .filter(t => t.length >= 15)
    .filter(t => !/RESPOSTA GERADA|GERANDO RESPOSTA/i.test(t))
    .filter(t => !(t.length < 200 && t.includes('?')))
    .map(t => t.slice(0, 3000));
}
// Lê o canal e guarda na base (memória + disco). Só sobrescreve se a leitura deu certo.
function iaAtualizarCanal(userId, canalId) {
  if (iaLendo.has(canalId)) return iaLendo.get(canalId);
  const p = (async () => {
    try {
      const textos = await iaLerCanalDoDiscord(userId, canalId);
      if (textos && textos.length) {
        iaBase[canalId] = { t: Date.now(), textos };
        iaMsgCache.set(canalId, { t: Date.now(), textos });
        iaBaseSalvar();
        info(`IA: canal ${canalId} salvo na base (${textos.length} trechos).`);
        return textos;
      }
    } catch (e) { aviso(`IA: falha lendo canal ${canalId}: ${e.message}`); }
    return null;
  })().finally(() => iaLendo.delete(canalId));
  iaLendo.set(canalId, p);
  return p;
}
async function iaTextosDoCanal(userId, canalId) {
  const mem = iaMsgCache.get(canalId);
  if (mem) {
    if (Date.now() - mem.t > IA_REFRESH_MS) iaAtualizarCanal(userId, canalId);
    return mem.textos;
  }
  const disco = iaBase[canalId];
  if (disco && Array.isArray(disco.textos) && disco.textos.length) {
    iaMsgCache.set(canalId, { t: disco.t || 0, textos: disco.textos });
    if (Date.now() - (disco.t || 0) > IA_REFRESH_MS) iaAtualizarCanal(userId, canalId);   // em segundo plano
    return disco.textos;
  }
  return (await iaAtualizarCanal(userId, canalId)) || [];   // primeira vez: lê e salva
}
let iaModeloCache = String(process.env.GROQ_MODEL || '').trim();
async function iaModelo() {
  if (iaModeloCache) return iaModeloCache;
  try {
    const r = await httpNatural('https://api.groq.com/openai/v1/models', { headers: { Authorization: `Bearer ${GROQ_KEY}` }, signal: AbortSignal.timeout(15000) }, 3);
    const j = await r.json().catch(() => ({}));
    const ids = (j.data || []).map(m => String(m.id));
    const uteis = ids.filter(i => !/whisper|guard|tts|playai|distil|embed|safeguard/i.test(i));
    const simples = uteis.filter(i => !/allam|orpheus|arabic|deepseek|r1/i.test(i));
    const pref = ['llama-3.3-70b-versatile', 'meta-llama/llama-4-scout-17b-16e-instruct', 'llama-3.1-8b-instant', 'openai/gpt-oss-120b', 'openai/gpt-oss-20b'];
    iaModeloCache = pref.find(p => uteis.includes(p)) || simples[0] || uteis[0] || '';
    info(`IA: modelo escolhido: ${iaModeloCache || '(nenhum)'} | disponíveis: ${uteis.join(', ').slice(0, 300)}`);
  } catch (e) { aviso(`IA: não consegui listar os modelos (${e.message})`); }
  return iaModeloCache || 'llama-3.3-70b-versatile';
}
// ---------- Gemini: lista de modelos com rodízio/fallback ----------
// Ordem: modelos do .env (GEMINI_TEXT_MODEL, GEMINI_TEXT_MODELS="a,b,c", GEMINI_MODEL) e depois os padrões abaixo.
const IA_GEMINI_MODELOS_PADRAO = [
  'gemini-2.5-flash', 'gemini-flash-latest', 'gemini-2.0-flash', 'gemini-2.5-flash-lite',
  'gemini-flash-lite-latest', 'gemini-2.0-flash-lite', 'gemini-2.5-pro'
];
const iaGeminiPular = new Map();   // modelo -> timestamp até quando ficar de fora (404/429/erro)
let iaGeminiUltimoOk = '';
function iaGeminiModelos() {
  const env = [process.env.GEMINI_TEXT_MODEL, ...String(process.env.GEMINI_TEXT_MODELS || '').split(','), process.env.GEMINI_MODEL]
    .map(x => String(x || '').trim()).filter(Boolean);
  let lista = [...new Set([...env, ...IA_GEMINI_MODELOS_PADRAO])];
  if (iaGeminiUltimoOk && lista.includes(iaGeminiUltimoOk)) lista = [iaGeminiUltimoOk, ...lista.filter(m => m !== iaGeminiUltimoOk)];
  const agora = Date.now();
  const livres = lista.filter(m => (iaGeminiPular.get(m) || 0) <= agora);
  return livres.length ? livres : lista;   // se todos estão "de molho", tenta todos mesmo assim
}
const IA_PROMPT_SISTEMA = 'Você é o assistente de um servidor de jogo e responde dúvidas dos jogadores. Use o CONTEXTO (regras e avisos do servidor) para responder em português, de forma direta e curta. Combine informações de vários trechos se precisar e liste itens quando a pergunta pedir lista. Se o contexto tiver QUALQUER informação relacionada à pergunta, responda com ela — nunca diga "não sei", "não encontrei" ou "não há informação" quando existir algo relacionado, mesmo que parcial: entregue o que há e diga o que falta apenas se for essencial. Nunca invente nada que não esteja no contexto. Só diga que não há informação se o contexto for totalmente alheio à pergunta.';
const IA_PROMPT_FORCAR = '\n\nATENÇÃO: o CONTEXTO acima FOI selecionado porque contém a resposta ou algo muito próximo dela. Releia com atenção e responda objetivamente com o que ele diz. É PROIBIDO responder "não sei" ou "não encontrei".';
const IA_RX_NAO_SEI = /^\s*(?:n[aã]o\s+sei|n[aã]o\s+(?:encontrei|achei|tenho\s+(?:essa\s+)?informa)|desculpe,?\s+n[aã]o|infelizmente,?\s+n[aã]o|sem\s+informa)/i;
async function iaGeminiResponder(ctx, pergunta, forcar) {
  const modelos = iaGeminiModelos();
  let ultimoErro = null;
  for (const modelo of modelos) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}:generateContent`;
      const gen = { temperature: forcar ? 0.1 : 0.2, maxOutputTokens: 2000 };
      if (/gemini-2\.5-flash/i.test(modelo)) gen.thinkingConfig = { thinkingBudget: 0 };   // evita gastar tokens "pensando" e vir vazio
      const corpo = JSON.stringify({
        systemInstruction: { parts: [{ text: IA_PROMPT_SISTEMA }] },
        contents: [{ role: 'user', parts: [{ text: `CONTEXTO:\n${ctx}\n\nPERGUNTA: ${pergunta}${forcar ? IA_PROMPT_FORCAR : ''}` }] }],
        generationConfig: gen
      });
      const r = await httpNatural(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_KEY }, body: corpo, signal: AbortSignal.timeout(12000) }, 1);
      const j = await r.json().catch(() => ({}));
      if (r.status === 429) { iaGeminiPular.set(modelo, Date.now() + 60 * 1000); const e = new Error(`${modelo}: limite de uso (429)`); e.status = 429; ultimoErro = e; continue; }
      if (r.status === 404 || r.status === 400) { iaGeminiPular.set(modelo, Date.now() + 60 * 60 * 1000); ultimoErro = new Error(`${modelo}: HTTP ${r.status} ${JSON.stringify(j.error || j).slice(0, 120)}`); continue; }
      if (r.status >= 500 || r.status === 403) { iaGeminiPular.set(modelo, Date.now() + 2 * 60 * 1000); ultimoErro = new Error(`${modelo}: HTTP ${r.status}`); continue; }
      const partes = (j && j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
      const txt = partes.filter(x => !x.thought).map(x => x.text || '').join('').trim();
      if (!txt) { ultimoErro = new Error(`${modelo}: resposta vazia (HTTP ${r.status}) ${JSON.stringify(j.error || j.promptFeedback || '').slice(0, 120)}`); continue; }
      iaGeminiUltimoOk = modelo;
      return txt.slice(0, 1900);
    } catch (e) {
      iaGeminiPular.set(modelo, Date.now() + 30 * 1000);
      ultimoErro = new Error(`${modelo}: ${e.message}`);
    }
  }
  throw ultimoErro || new Error('nenhum modelo Gemini respondeu');
}
// Resposta de emergência (sem IA): devolve os trechos dos canais que mais batem com a pergunta.
function iaRespostaDireta(achados) {
  const t = achados.slice(0, 2).map(a => String(a.t).replace(/\s+/g, ' ').trim().slice(0, 700)).filter(Boolean).join('\n\n');
  return t ? t.slice(0, 1900) : '';
}
async function iaResponder(userId, guildId, pergunta) {
  if (!GEMINI_KEY && !GROQ_KEY) return 'IA não configurada (falta GEMINI_API_KEY no .env).';
  const canais = iaConfig(userId, guildId);
  if (!canais.length) return 'Nenhum canal configurado neste servidor (painel > Configurar IA).';
  const chave = `${userId}|${guildId}|${normalizarNome(pergunta)}`;
  const hit = iaRespCache.get(chave);
  if (hit && Date.now() - hit.t < 10 * 60 * 1000) return hit.r;
  const radical = p => (p.length > 5 ? p.slice(0, Math.max(5, p.length - 2)) : p);
  const palavras = [...new Set(normalizarNome(pergunta).split(' ').filter(p => p.length >= 3 && !IA_STOP.has(p)).map(radical))];
  if (!palavras.length) return 'Pergunta muito curta, escreva com mais detalhes.';
  const todosTextos = [];
  const listas = await Promise.all(canais.map(cid => iaTextosDoCanal(userId, cid).catch(() => [])));
  for (const lista of listas) for (const t of lista) todosTextos.push({ t, n: normalizarNome(t) });
  if (!todosTextos.length) return 'Não consegui ler mensagens nos canais configurados (verifique se a conta tem acesso a eles).';
  const freq = {};
  for (const p of palavras) freq[p] = todosTextos.filter(x => x.n.includes(p)).length;
  const achados = [];
  const semScore = [];
  for (const x of todosTextos) {
    let score = 0;
    for (const p of palavras) {
      if (x.n.includes(p)) score += 1 + Math.log((todosTextos.length + 1) / (freq[p] + 1));
    }
    if (score > 0) achados.push({ t: x.t, score }); else semScore.push({ t: x.t, score: 0 });
  }
  achados.sort((a, b) => b.score - a.score);
  // Contexto: primeiro os trechos que batem; se couber, completa com o resto dos canais (a IA decide o que serve).
  const montarCtx = (limite, maxBlocos) => {
    let ctx = '';
    let n = 0;
    for (const a of achados.concat(semScore)) {
      if (n >= maxBlocos) break;
      const bloco = a.t.slice(0, 2000);
      if (ctx.length + bloco.length > limite) { if (n) break; else continue; }
      ctx += (ctx ? '\n---\n' : '') + bloco;
      n++;
    }
    return ctx;
  };
  const guardar = txt => {
    if (!IA_RX_NAO_SEI.test(txt)) iaRespCache.set(chave, { t: Date.now(), r: txt });
    if (iaRespCache.size > 300) iaRespCache.delete(iaRespCache.keys().next().value);
    return txt;
  };
  if (GEMINI_KEY) {
    const ctxG = montarCtx(24000, 20);
    info(`IA (Gemini): ${achados.length} trecho(s) batendo de ${todosTextos.length} | palavras: ${palavras.join(', ')} | contexto: ${ctxG.replace(/\s+/g, ' ').slice(0, 700)}`);
    try {
      let txtG = await iaGeminiResponder(ctxG, pergunta, false);
      if (IA_RX_NAO_SEI.test(txtG)) {
        info('IA (Gemini): respondeu "não sei" com contexto disponível — tentando de novo em modo forçado.');
        try { const t2 = await iaGeminiResponder(ctxG, pergunta, true); if (t2 && !IA_RX_NAO_SEI.test(t2)) txtG = t2; } catch (e2) { aviso(`IA (Gemini, forçado): ${e2.message}`); }
      }
      if (IA_RX_NAO_SEI.test(txtG) && achados.length) {
        const direta = iaRespostaDireta(achados);
        if (direta) return guardar(direta);
      }
      return guardar(txtG);
    } catch (e) {
      aviso(`IA (Gemini): ${e.message}`);
      if (!GROQ_KEY) {
        const direta = achados.length ? iaRespostaDireta(achados) : '';
        if (direta) return direta;
        return e.status === 429 ? 'IA no limite de uso agora, tente em instantes.' : 'Não consegui gerar a resposta agora.';
      }
      // se a Gemini falhar e houver chave da Groq, tenta a Groq abaixo
    }
  }
  const ctx = montarCtx(9000, 8);
  const modelo = await iaModelo();
  info(`IA: ${achados.length} trecho(s) | palavras: ${palavras.join(', ')} | contexto: ${ctx.replace(/\s+/g, ' ').slice(0, 700)}`);
  const chamarGroq = async forcar => {
    const r = await httpNatural('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelo, temperature: 0.2, max_tokens: 500,
        ...(/gpt-oss/i.test(modelo) ? { reasoning_effort: 'low' } : {}),
        messages: [
          { role: 'system', content: IA_PROMPT_SISTEMA },
          { role: 'user', content: `CONTEXTO:\n${ctx}\n\nPERGUNTA: ${pergunta}${forcar ? IA_PROMPT_FORCAR : ''}` }
        ]
      }),
      signal: AbortSignal.timeout(20000)
    }, 3);
    const j = await r.json().catch(() => ({}));
    return { r, j, txt: String((j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '').trim() };
  };
  try {
    let { r, j, txt } = await chamarGroq(false);
    if (r.status === 429) { const direta = achados.length ? iaRespostaDireta(achados) : ''; return direta || 'IA no limite de uso agora, tente em instantes.'; }
    if (!txt) {
      aviso(`IA: HTTP ${r.status} ${JSON.stringify(j.error || j).slice(0, 150)}`);
      if (r.status === 404 && !process.env.GROQ_MODEL) iaModeloCache = '';
      const direta = achados.length ? iaRespostaDireta(achados) : '';
      return direta || 'Não consegui gerar a resposta agora.';
    }
    if (IA_RX_NAO_SEI.test(txt)) {
      try { const seg = await chamarGroq(true); if (seg.txt && !IA_RX_NAO_SEI.test(seg.txt)) txt = seg.txt; } catch {}
      if (IA_RX_NAO_SEI.test(txt) && achados.length) { const direta = iaRespostaDireta(achados); if (direta) return guardar(direta); }
    }
    return guardar(txt);
  } catch (e) {
    aviso(`IA: ${e.message}`);
    const direta = achados.length ? iaRespostaDireta(achados) : '';
    return direta || 'Não consegui gerar a resposta agora.';
  }
}
// ============================================================
// .ia (FOTO): lê a tela de placar/loja do Free Fire e lista os 4 personagens + pet de cada jogador.
// Uso: responda uma foto com `.ia`. Envio com delay humano + "digitando..." (antidetecao.js).
// IA de visão: GEMINI_API_KEY (recomendado) ou GROQ_API_KEY (modelo de visão do Groq).
// ============================================================
const GEMINI_KEY = String(process.env.GEMINI_API_KEY || '').trim();
const IA_FOTO_CACHE = new Map();
const iaFotoEmAndamento = new Set();
const IA_FOTO_PERSONAGENS = [
  'LAURA', 'ANDREW', 'SUZY', 'KODA', 'LEON', 'CHRONO', 'MIGUEL', 'OSCAR', 'IRIS', 'SHIRO', 'EVELYN', 'ALOK', 'NERO', 'KAIROS', 'KASSIE', 'MARO', 'LUNA', 'ANTONIO', 'STEFFIE', 'ALVARO', 'HAYATO', 'RAFAEL', 'SHANI', 'KELLY', 'KAPELLA', 'A124', 'LILA', 'MOCO', 'OTHO', 'THIVA', 'DIMITRI', 'SONIA', 'JOTA', 'DIANA', 'JOSEPH', 'KAMIR', 'TATSUYA', 'SANTINO', 'RIN', 'J.BIEBS', 'LUQUETA', 'RYDEN', 'WOLFRAHH', 'D-BOAS', 'SKYLER', 'JAI', 'HOMERO', 'NOTORA', 'ORION', 'NAIRI', 'XTREMA', 'PALOMA', 'NIKITA', 'MAXIM', 'WUKONG', 'OLIVIA', 'MISHA', 'CAROLINE', 'FORD', 'KLA', 'MORSE', 'KENTA', 'RAY', 'IGNIS'
];
const IA_FOTO_PETS = [
  'ETZIN', 'SAMALANDRA', 'BRABUINO', 'MANDACARU', 'DRAKINHO', 'PATOPINHO', 'FALCAO', 'MANDRAKO', 'RAPOSA PRATEADA', 'PANDA', 'SHIBA', 'LONTRETA', 'ARITA', 'DOM PISANTE', 'PORING', 'AGENTE SALTO', 'PUNKIN', 'ROBO', 'PANTERA NOTURNA', 'BARAO TURBO', 'MESTRE TRIGO', 'CASCUDINHO', 'LUPINO', 'IETI'
];
// Catálogo oficial dos ícones de habilidade (pasta ff_refs/): folhas numeradas enviadas junto com o print.
// A IA só escolhe o NÚMERO do ícone; o nome vem do habilidades_ff.json. Ícone fora do catálogo = "?".
// Procura os arquivos em ff_refs/ (ao lado do index.js ou no cwd) e, se estiverem soltos, na própria pasta do projeto.
const IA_FOTO_REFS_DIR = [
  path.join(__dirname, 'ff_refs'), path.join(process.cwd(), 'ff_refs'), __dirname, process.cwd()
].find(d => { try { return fs.existsSync(path.join(d, 'habilidades_ff.json')); } catch { return false; } }) || path.join(__dirname, 'ff_refs');
let iaFotoRefsCache = null;
function iaFotoRefs() {
  if (iaFotoRefsCache !== null) return iaFotoRefsCache || null;
  try {
    const cat = JSON.parse(fs.readFileSync(path.join(IA_FOTO_REFS_DIR, 'habilidades_ff.json'), 'utf8'));
    if (!cat || !Array.isArray(cat.personagens) || !Array.isArray(cat.pets)) throw new Error('habilidades_ff.json inválido');
    const imgP = fs.readFileSync(path.join(IA_FOTO_REFS_DIR, 'ff_personagens.png'));
    const imgT = fs.readFileSync(path.join(IA_FOTO_REFS_DIR, 'ff_pets.png'));
    const conhecidosP = new Set(IA_FOTO_PERSONAGENS.concat(cat.personagens.map(c => c.nome).filter(Boolean)));
    const conhecidosT = new Set(IA_FOTO_PETS.concat(cat.pets.map(c => c.nome).filter(Boolean)));
    iaFotoRefsCache = { cat, imgP, imgT, conhecidosP, conhecidosT };
    info(`[.ia foto] Catálogo carregado: ${cat.personagens.length} personagens e ${cat.pets.length} pets (${cat.personagens.concat(cat.pets).filter(c => c.nome).length} com nome).`);
  } catch (e) {
    aviso(`[.ia foto] Sem catálogo em ${IA_FOTO_REFS_DIR} (${e.message}) — usando leitura sem folhas de referência.`);
    iaFotoRefsCache = false;
  }
  return iaFotoRefsCache || null;
}
function iaFotoPrompt(refs) {
  if (!refs) {
    return [
      'Você analisa um print do jogo Free Fire (servidor BR, em português) da tela de PLACAR/LOJA do modo Mata-Mata/Confronto.',
      'A tela tem duas equipes (azul e laranja). Cada equipe tem uma tabela com as colunas "Jogador" e "HABILIDADE".',
      'Cada LINHA é um jogador: à esquerda o avatar/nível, depois o NOME do jogador (linha de cima) e o nome do clã/guilda (linha de baixo, IGNORE o clã).',
      'Na coluna HABILIDADE de cada linha há 5 ícones, da esquerda para a direita: os 4 PRIMEIROS são as habilidades ativas dos 4 PERSONAGENS escolhidos e o 5º (último) é a habilidade do PET.',
      'Identifique cada personagem e o pet pelo ícone da habilidade. Responda para TODOS os jogadores visíveis, das duas equipes.',
      `Personagens conhecidos (use exatamente estes nomes quando possível): ${IA_FOTO_PERSONAGENS.join(', ')}.`,
      `Pets conhecidos: ${IA_FOTO_PETS.join(', ')}.`,
      'Se não tiver certeza de um ícone, escreva "?" naquela posição. NÃO invente. Se a linha tiver menos de 4 personagens, preencha só os que existem.',
      'Nome do jogador: copie sem símbolos decorativos, sem emojis e sem o clã (ex.: "MOB THツ" vira "MOB TH").',
      'Responda SOMENTE com JSON, sem texto extra, neste formato:',
      '{"jogadores":[{"nome":"MOB TH","personagens":["ALOK","LEON","MOCO","JOTA"],"pet":"MESTRE TRIGO"}]}'
    ].join('\n');
  }
  const nP = refs.cat.personagens.length, nT = refs.cat.pets.length;
  return [
    'Você analisa um print do jogo Free Fire (servidor BR) da tela de PLACAR/LOJA do modo Mata-Mata/Confronto.',
    `Você recebe 3 imagens, nesta ordem: (1) o PRINT; (2) a FOLHA DE PERSONAGENS com ícones de referência numerados de 1 a ${nP}; (3) a FOLHA DE PETS com ícones de referência numerados de 1 a ${nT}.`,
    'No PRINT há duas equipes (azul e laranja), cada uma com uma tabela "Jogador" / "HABILIDADE". Cada LINHA é um jogador: avatar com nível, NOME do jogador (linha de cima) e clã (linha de baixo, IGNORE o clã).',
    'Na coluna HABILIDADE de cada linha há 5 ícones brancos/prateados dentro de losangos: os 4 PRIMEIROS são os PERSONAGENS e o 5º (separado por uma barrinha vertical) é o PET.',
    'No print os ícones aparecem em branco/cinza e nas folhas eles têm cor: compare pela FORMA do desenho, ignorando cor e o losango em volta.',
    'Para cada ícone do print devolva o NÚMERO do ícone igual na folha (personagens na folha 2, pet na folha 3). Se nenhum ícone da folha for claramente igual, devolva 0. NUNCA invente número.',
    'Deixe "nome" sempre vazio (""): o nome é descoberto pelo número. Escolha só o "n" comparando a FORMA do desenho com a folha. Se não tiver certeza, n = 0.',
    `Personagens conhecidos: ${IA_FOTO_PERSONAGENS.join(', ')}.`,
    `Pets conhecidos: ${IA_FOTO_PETS.join(', ')}.`,
    'Responda para TODOS os jogadores visíveis, das duas equipes, e só para ícones que existem de fato (se a linha tiver menos de 4 personagens, devolva só os que existem).',
    'Nome do jogador: copie sem símbolos decorativos, sem emojis e sem o clã (ex.: "MOB THツ" vira "MOB TH").',
    'Responda SOMENTE com JSON, sem texto extra, neste formato:',
    '(os números abaixo são só ilustração do formato, NÃO são a resposta)',
    'Em cada ícone, ANTES de escolher o número, escreva em "desc" uma descrição curta do desenho (ex.: "clave de sol", "coração com cruz", "caveira", "pata"), compare com as folhas e só então dê o "n". Se a descrição não bater claramente com nenhum ícone da folha, use n = 0.',
    '{"jogadores":[{"nome":"JOGADOR UM","personagens":[{"desc":"descrição do desenho","n":3,"nome":""},{"desc":"descrição do desenho","n":17,"nome":""},{"desc":"descrição do desenho","n":42,"nome":""},{"desc":"descrição do desenho","n":8,"nome":""}],"pet":{"desc":"descrição do desenho","n":6,"nome":""}}]}'
  ].join('\n');
}
// Converte {n, nome} em nome final. Só aceita ícone que existe na folha (n válido).
function iaFotoNomeDoItem(item, lista, conhecidos) {
  let n = 0, palpite = '';
  if (item && typeof item === 'object') { n = parseInt(item.n !== undefined ? item.n : (item.numero !== undefined ? item.numero : item.id), 10); palpite = String(item.nome || item.palpite || ''); }
  else if (typeof item === 'number' || /^\s*\d+\s*$/.test(String(item))) n = parseInt(item, 10);
  else palpite = String(item || '');
  const e = Number.isInteger(n) && n >= 1 && n <= lista.length ? lista[n - 1] : null;
  if (!e) {
    // Sem número válido: vale se vier um nome conhecido (catálogo ou lista fixa).
    return iaFotoNomeConhecido(iaFotoLimparItem(palpite), conhecidos);
  }
  if (e.nome) return e.nome;                       // o número manda; o nome escrito pela IA é ignorado
  // Ícone do catálogo sem nome cadastrado: usa o palpite da IA se for um nome conhecido.
  return iaFotoNomeConhecido(iaFotoLimparItem(palpite), conhecidos);
}
// Casa o palpite com a lista de nomes conhecidos (exato, sem espaço/ponto, ou parte do nome).
function iaFotoNomeConhecido(pg, conhecidos) {
  if (!pg || pg === '?') return '?';
  if (conhecidos.has(pg)) return pg;
  const lim = s => String(s).replace(/[ .\-]/g, '');
  const alvo = lim(pg);
  for (const c of conhecidos) if (lim(c) === alvo) return c;
  if (alvo.length >= 4) for (const c of conhecidos) { const l = lim(c); if (l.includes(alvo) || (l.length >= 4 && alvo.includes(l))) return c; }
  return '?';
}
function iaFotoResolver(jogadores, refs) {
  if (!refs) return jogadores;
  const out = [];
  for (const j of jogadores) {
    if (!j || typeof j !== 'object') continue;
    const chars = (Array.isArray(j.personagens) ? j.personagens : []).slice(0, 4).map(x => iaFotoNomeDoItem(x, refs.cat.personagens, refs.conhecidosP));
    const pet = (j.pet === undefined || j.pet === null || j.pet === '' || j.pet === 0) ? '' : iaFotoNomeDoItem(j.pet, refs.cat.pets, refs.conhecidosT);
    out.push({ nome: j.nome, personagens: chars, pet });
  }
  return out;
}
function iaFotoMime(buf, tipo) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (buf[0] === 0xFF && buf[1] === 0xD8) return 'image/jpeg';
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'image/webp';
  return /^image\/(png|jpe?g|webp)$/.test(String(tipo || '')) ? tipo : 'image/jpeg';
}
function iaFotoAchar(...msgs) {
  for (const m of msgs) {
    if (!m) continue;
    const anexos = m.attachments ? Array.from(m.attachments.values()) : [];
    for (const a of anexos) {
      const tipo = String(a.contentType || a.content_type || '').toLowerCase();
      const nome = String(a.name || a.url || '').split('?')[0];
      if ((/^image\/(png|jpe?g|webp)$/.test(tipo) || /\.(png|jpe?g|webp)$/i.test(nome)) && (a.url || a.proxyURL)) {
        return { id: String(a.id || a.url), url: a.url || a.proxyURL, tipo };
      }
    }
    for (const e of (m.embeds || [])) {
      const u = (e.image && (e.image.url || e.image.proxyURL)) || (e.thumbnail && (e.thumbnail.url || e.thumbnail.proxyURL));
      if (u && /\.(png|jpe?g|webp)(\?|$)/i.test(u)) return { id: String(u), url: u, tipo: '' };
    }
  }
  return null;
}
function iaFotoParse(txt) {
  const t = String(txt || '').replace(/```json|```/gi, '').trim();
  const i = t.indexOf('{'), f = t.lastIndexOf('}');
  if (i < 0 || f < i) return null;
  try { const j = JSON.parse(t.slice(i, f + 1)); return Array.isArray(j.jogadores) ? j.jogadores : null; } catch { return null; }
}
function iaFotoLimparNome(s, max = 24) {
  const n = String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9 ._\-]/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase().slice(0, max).trim();
  return n || '';
}
function iaFotoLimparItem(s) {
  const n = String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9 .\-]/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase().slice(0, 24).trim();
  return n || '?';
}
function iaFotoFormatar(jogadores) {
  const linhas = [];
  for (const j of jogadores) {
    if (!j || typeof j !== 'object') continue;
    const nome = iaFotoLimparNome(j.nome) || 'JOGADOR';
    const chars = (Array.isArray(j.personagens) ? j.personagens : []).slice(0, 4).map(iaFotoLimparItem);
    const pet = j.pet ? iaFotoLimparItem(j.pet) : '';
    if (!chars.length && !pet) continue;
    if (chars.every(c => c === '?') && (!pet || pet === '?')) continue;   // nada reconhecido nessa linha
    const lista = chars.join(', ') + (pet ? (chars.length ? ' E ' : '') + pet : '');
    linhas.push(`### \`👤\` ${nome} - ${lista}`);
  }
  return linhas;
}
async function iaFotoChamarGemini(buf, mime, refs, extra) {
  // Precisão sem passar de ~15s: dispara em paralelo uma leitura com raciocínio MEDIUM (precisa) e outra com LOW (rápida).
  // Se a precisa responder em até GEMINI_PRAZO_MS (13s), usa ela; senão usa a rápida.
  const modelosVisao = [...new Set([process.env.GEMINI_VISION_MODEL, process.env.GEMINI_MODEL, 'gemini-3-flash-preview', 'gemini-2.5-flash', 'gemini-flash-latest', 'gemini-2.0-flash', 'gemini-2.5-pro'].map(x => String(x || '').trim()).filter(Boolean))];
  const nivelBom = String(process.env.GEMINI_THINKING || 'medium').trim();
  const prazo = Number(process.env.GEMINI_PRAZO_MS) || 45000;
  const chamar = async (nivel, timeoutMs) => {
    const corpo = (comNivel, modelo) => JSON.stringify({
      contents: [{ parts: [
        { text: iaFotoPrompt(refs) + (extra ? '\n\n' + extra : '') },
        { text: 'IMAGEM 1 — PRINT:' }, { inline_data: { mime_type: mime, data: buf.toString('base64') } },
        ...(refs ? [
          { text: 'IMAGEM 2 — FOLHA DE PERSONAGENS (números de referência):' }, { inline_data: { mime_type: 'image/png', data: refs.imgP.toString('base64') } },
          { text: 'IMAGEM 3 — FOLHA DE PETS (números de referência):' }, { inline_data: { mime_type: 'image/png', data: refs.imgT.toString('base64') } }
        ] : [])
      ] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json', ...(comNivel && /gemini-3/i.test(modelo) ? { thinkingConfig: { thinkingLevel: nivel } } : {}) }
    });
    let ultimoErro = null;
    for (const modelo of modelosVisao) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}:generateContent`;
        const enviar = async comNivel => {
          const r = await httpNatural(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_KEY }, body: corpo(comNivel, modelo), signal: AbortSignal.timeout(timeoutMs) }, 3);
          return { r, j: await r.json().catch(() => ({})) };
        };
        let { r, j } = await enviar(true);
        if (r.status === 400 && /thinking/i.test(JSON.stringify(j.error || j))) ({ r, j } = await enviar(false));
        if (r.status === 429) { ultimoErro = new Error(`IA de imagem no limite de uso (429) em ${modelo}`); continue; }
        if (r.status === 404 || r.status === 400 || r.status === 403 || r.status >= 500) { ultimoErro = new Error(`Gemini ${modelo} HTTP ${r.status} ${JSON.stringify(j.error || j).slice(0, 120)}`); continue; }
        const partes = (j && j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
        const txt = partes.filter(p => !p.thought).map(p => p.text || '').join('');
        if (!txt) { ultimoErro = new Error(`Gemini ${modelo} HTTP ${r.status} ${JSON.stringify(j.error || j).slice(0, 150)}`); continue; }
        return txt;
      } catch (e) { ultimoErro = new Error(`Gemini ${modelo}: ${e.message}`); }
    }
    throw ultimoErro || new Error('nenhum modelo Gemini de imagem respondeu');
  };
  const rapida = chamar('low', 50000);
  rapida.catch(logErro);
  const boa = chamar(nivelBom, 50000);
  boa.catch(logErro);
  const venceu = await Promise.race([
    boa.then(t => ({ t, de: nivelBom }), () => null),
    new Promise(res => setTimeout(() => res(null), prazo))
  ]);
  if (venceu) { info(`[.ia foto] Gemini respondeu com raciocínio ${venceu.de}.`); return venceu.t; }
  info(`[.ia foto] Raciocínio ${nivelBom} passou de ${Math.round(prazo / 1000)}s — usando a leitura rápida.`);
  return await rapida;
}
async function iaFotoChamarGroq(buf, mime, urlOriginal, refs, extra) {
  const modelo = String(process.env.GROQ_VISION_MODEL || 'qwen/qwen3.8-27b').trim();
  const url = buf.length <= 3000000 ? `data:${mime};base64,${buf.toString('base64')}` : urlOriginal;
  const r = await httpNatural('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: modelo, temperature: 0, max_tokens: 1500,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: [
        { type: 'text', text: iaFotoPrompt(refs) + (extra ? '\n\n' + extra : '') },
        { type: 'image_url', image_url: { url } },
        ...(refs ? [
          { type: 'image_url', image_url: { url: `data:image/png;base64,${refs.imgP.toString('base64')}` } },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${refs.imgT.toString('base64')}` } }
        ] : [])
      ] }]
    }),
    signal: AbortSignal.timeout(60000)
  }, 3);
  const j = await r.json().catch(() => ({}));
  if (r.status === 429) throw new Error('IA de imagem no limite de uso (429)');
  const txt = String((j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '').trim();
  if (!txt) throw new Error(`Groq HTTP ${r.status} ${JSON.stringify(j.error || j).slice(0, 150)}`);
  return txt;
}
async function iaFotoRecortar(buf) {
  try {
    if (!CanvasLib) return buf;
    const img = await CanvasLib.loadImage(buf);
    const x = Math.round(img.width * 0.08), y = Math.round(img.height * 0.33);
    const w = Math.round(img.width * 0.84), h = Math.round(img.height * 0.37);
    const cv = CanvasLib.createCanvas(w, h);
    cv.getContext('2d').drawImage(img, x, y, w, h, 0, 0, w, h);
    return cv.toBuffer('image/png');
  } catch { return buf; }
}
async function iaFotoLer(bufOriginal, foto) {
  const buf = await iaFotoRecortar(bufOriginal);
  const mime = iaFotoMime(buf, foto.tipo);
  const refs = iaFotoRefs();
  const chamar = extra => GEMINI_KEY ? iaFotoChamarGemini(buf, mime, refs, extra) : iaFotoChamarGroq(buf, mime, foto.url, refs, extra);
  const bruto = await chamar('');
  info(`[.ia foto] Resposta bruta da IA (${GEMINI_KEY ? 'Gemini' : 'Groq'}, catálogo ${refs ? 'ok' : 'AUSENTE'}): ${String(bruto).slice(0, 400)}`);
  const lista = iaFotoParse(bruto);
  if (!lista) throw new Error(`Resposta da IA sem JSON válido: ${String(bruto).slice(0, 120)}`);
  const res = iaFotoResolver(lista, refs);
  // Segunda leitura: só para posições que ficaram "?" (ícone do catálogo sem nome). Obriga a IA a dar um nome da lista.
  if (refs) {
    for (let tentativa = 1; tentativa <= 0; tentativa++) {
      const pend = [];
      res.forEach((j, ji) => {
        (j.personagens || []).forEach((c, ci) => { if (c === '?') pend.push(`jogador ${ji + 1} ("${j.nome}"), personagem ${ci + 1}`); });
        if (j.pet === '?') pend.push(`jogador ${ji + 1} ("${j.nome}"), PET`);
      });
      if (!pend.length) break;
      info(`[.ia foto] ${pend.length} posição(ões) sem nome — segunda leitura ${tentativa}/2.`);
      try {
        const extra = 'REVISÃO OBRIGATÓRIA: na leitura anterior estas posições ficaram sem nome: ' + pend.join('; ') + '. ' +
          'Olhe o PRINT de novo, mantenha a MESMA ordem de jogadores e devolva o mesmo JSON. Em TODA posição preencha "nome" com UM nome da lista de conhecidos ' +
          '(o mais parecido pela forma do ícone). Nunca deixe "" e nunca escreva "?". Os personagens ficam na ordem da linha (1º ao 4º) e o pet é o 5º ícone.';
        const lista2 = iaFotoParse(await chamar(extra));
        if (!lista2) continue;
        res.forEach((j, ji) => {
          const j2 = lista2[ji];
          if (!j2) return;
          (j.personagens || []).forEach((c, ci) => {
            if (c !== '?' || !Array.isArray(j2.personagens)) return;
            const n2 = iaFotoNomeDoItem(j2.personagens[ci], refs.cat.personagens, refs.conhecidosP);
            if (n2 !== '?') j.personagens[ci] = n2;
          });
          if (j.pet === '?' && j2.pet) {
            const n2 = iaFotoNomeDoItem(j2.pet, refs.cat.pets, refs.conhecidosT);
            if (n2 !== '?') j.pet = n2;
          }
        });
      } catch (e) { aviso(`[.ia foto] segunda leitura falhou: ${e.message}`); break; }
    }
  }
  return res;
}
function iaFotoQuebrar(cabecalho, linhas, max = 1900) {
  const partes = [];
  let atual = cabecalho;
  for (const l of linhas) {
    if ((atual + '\n' + l).length > max) { partes.push(atual); atual = l; }
    else atual += (atual ? '\n' : '') + l;
  }
  if (atual) partes.push(atual);
  return partes;
}
async function comandoIAFoto(mensagem, userId, canal, foto) {
  const chave = `${userId}|${foto.id}`;
  if (iaFotoEmAndamento.has(chave)) return;
  iaFotoEmAndamento.add(chave);
  try {

    apagarComando(mensagem).catch(logErro);
    if (!GEMINI_KEY && !GROQ_KEY) {
      await enviarCanal(canal, 'IA de imagem não configurada (falta GEMINI_API_KEY ou GROQ_API_KEY no .env).', { comando: true });
      return;
    }

    const t0 = Date.now();
    // Avisa que está procurando (igual ao `.ia pergunta`); essa mensagem depois é EDITADA com o resultado.
    const pBusca = enviarCanal(canal, '# `PROCURANDO RESPOSTA`\n\nFOTO: `lendo os personagens e o pet de cada jogador... (isso pode demorar!)`', { comando: true }).catch(() => null);

    let jogadores = null;
    try {
      const cache = IA_FOTO_CACHE.get(foto.id);
      if (cache && Date.now() - cache.t < 10 * 60 * 1000) jogadores = cache.r;
      else {
        const buf = await baixarImagem(foto.url);
        if (!buf || !buf.length) throw new Error('imagem não baixou');
        jogadores = await iaFotoLer(buf, foto);
        IA_FOTO_CACHE.set(foto.id, { t: Date.now(), r: jogadores });
        if (IA_FOTO_CACHE.size > 50) IA_FOTO_CACHE.delete(IA_FOTO_CACHE.keys().next().value);
      }
    } catch (e) {
      aviso(`[${userId}] .ia foto: ${e.message}`);
    }
    const linhas = jogadores ? iaFotoFormatar(jogadores) : [];
    if (!linhas.length) aviso(`[${userId}] .ia foto: nenhuma linha reconhecida (jogadores lidos: ${jogadores ? jogadores.length : 'erro antes'}).`);
    const msgBusca = await pBusca;
    // Troca o "procurando" pelo resultado (edita); se a edição falhar, envia normal.
    const entregar = async (texto, opcoes) => {
      if (msgBusca && typeof msgBusca.edit === 'function') { try { await msgBusca.edit(canalEhSelfbot(canal) ? AD.variarConteudo(texto) : texto); return; } catch {} }
      await enviarCanal(canal, texto, opcoes);
    };
    if (!linhas.length) {
      await entregar('## `🔴` NÃO CONSEGUI LER OS PERSONAGENS DESSA FOTO\n-# Envie o print da tela de placar/loja com a coluna HABILIDADE visível.', );
      return;
    }
    const partes = iaFotoQuebrar('## `🟢` LI A FOTO E RECONHECI ESSES PERSONAGENS:', linhas);
    for (let i = 0; i < partes.length; i++) {
      if (i === 0) { await entregar(partes[0]); continue; }
      await enviarCanal(canal, partes[i]);
    }
    logEmbed('geral', '🖼️ .ia (foto) lida', [['Conta', `<@${userId}>`], ['Jogadores', String(linhas.length)]], userId).catch(logErro);
  } finally {
    iaFotoEmAndamento.delete(chave);
  }
}
async function comandoIA(mensagem, userId, args) {
  const canal = mensagem.channel;
  info(`[.ia] comandoIA iniciado (conta ${userId}, servidor ${guildIdDaMensagem(mensagem)}, canais configurados: ${iaConfig(userId, guildIdDaMensagem(mensagem)).length})`);
  try {
    const limpar = s => limparTexto(String(s || '').replace(/<@[!&]?\d+>/g, ' ')).replace(/`/g, "'").trim();
    let pergunta = limpar(args);
    let ref = null;
    if (mensagem.reference && mensagem.reference.messageId) {
      try {
        ref = typeof mensagem.fetchReference === 'function'
          ? await mensagem.fetchReference()
          : await canal.messages.fetch(mensagem.reference.messageId);
      } catch {}
    }
    // Foto (resposta a uma imagem, ou imagem anexada ao próprio .ia): lê os personagens do print.
    const fotoIA = iaFotoAchar(ref, mensagem);
    if (fotoIA && (ref || !pergunta)) { await comandoIAFoto(mensagem, userId, canal, fotoIA); return; }
    if (!pergunta && ref) pergunta = limpar(extrairTextoComEmbeds(ref));
    pergunta = pergunta.slice(0, 300);
    apagarComando(mensagem).catch(logErro);
    if (!pergunta) {
      await enviarCanal(canal, 'Uso: `.ia sua pergunta` — ou responda a pergunta de alguém com `.ia`');
      return;
    }
    const msg = await enviarCanal(canal, `# \`GERANDO RESPOSTA\`\n\nPERGUNTA: \`${pergunta}\``);
    const resp = String(await iaResponder(userId, guildIdDaMensagem(mensagem), pergunta))
      .replace(/`/g, "'").replace(/\s+/g, ' ').slice(0, 1500);
    const texto = `# \`RESPOSTA GERADA\`\n\nPERGUNTA: \`${pergunta}\`\n\nRESPOSTA: \`${resp}\``;
    try { await editarMsgSegura(msg, texto); } catch { await enviarCanal(canal, texto); }
  } catch (e) {
    erro(`.ia [${userId}]: ${e.message}`);
    try { await enviarCanal(canal, 'Não consegui responder agora (erro na IA). Tente de novo em instantes.'); } catch {}
  }
}
const botPorCanal = new Map();
const _setBotCanal = botPorCanal.set.bind(botPorCanal);
botPorCanal.set = (k, v) => { const r = _setBotCanal(k, v); estadoSalvar(); return r; };
estadoRestaurar();
const slashBotCache = new Map();
async function botsDoCanal(canal) {
  const ids = [];
  try {
    const msgs = await canal.messages.fetch({ limit: 50 });
    for (const m of msgs.values()) {
      if (m.author && m.author.bot && !ids.includes(m.author.id)) ids.push(m.author.id);
    }
  } catch {}
  const salvo = botPorCanal.get(canal.id);
  if (salvo && !ids.includes(salvo)) ids.push(salvo);
  return ids;
}
// ============================================================
// LIGAÇÃO COM O BOT DE SALAS (ZEROUN SALAS)
// ------------------------------------------------------------
// O dono liga no bot de salas com  /salasbotzeroun acao:ligar.  Depois disso:
//  1) este AutoMed SINCRONIZA com o bot de salas: ele informa quantas salas cada usuário tem
//     (vira o "salasCompradas" daqui) — a cada SALASBOT_SYNC_MS e a cada sala criada;
//  2) quando os 2 pagamentos são encontrados, o AutoMed AVISA o bot de salas (HTTP, sem mandar comando
//     no chat) e o bot de salas debita 1 sala do usuário e cria a sala NAQUELE canal, no modo do canal
//     (gel normal, gelo infinito, full capa, tático, speed...).
// Se o bot de salas estiver fora do ar / desligado / fora do servidor, tudo cai no fluxo antigo.
//
// .env deste AutoMed:   SALASBOT_URL=https://<endereço do bot de salas>     SALASBOT_SEGREDO=<igual ao AUTOMED_SEGREDO de lá>
// ============================================================
const SALASBOT_URL = String(process.env.SALASBOT_URL || '').trim().replace(/\/+$/, '');
const SALASBOT_SEGREDO = String(process.env.SALASBOT_SEGREDO || '').trim();
const SALASBOT_SYNC_MS = Math.max(15000, Number(process.env.SALASBOT_SYNC_MS) || 45000);
const SALASBOT_JANELA_CANAL_MS = 120000;
const salasBot = { ativo: false, ultimoSync: 0, ultimoErro: '', online: false };
const salasBotPorCanal = new Map();          // canalId -> quando o bot de salas criou a última sala ali
const salasBotFlushEmAndamento = new Set();
let salasBotTimer = null;
let salasBotSyncRodando = false;

function salasBotConfigurado() { return !!(SALASBOT_URL && SALASBOT_SEGREDO); }
// Ligado = configurado aqui + o bot de salas disse (no último sync) que a ligação está LIGADA.
function salasBotLigado() { return salasBotConfigurado() && salasBot.ativo === true; }
function salasBotCanalRecente(canalId) {
  const t = salasBotPorCanal.get(String(canalId));
  return !!t && Date.now() - t < SALASBOT_JANELA_CANAL_MS;
}

// Chamada HTTP ao bot de salas. Erros: e.codigo = código devolvido pelo bot de salas; e.rede = falha de rede/resposta.
function salasBotChamar(metodo, caminho, corpo, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const falhaRede = (msg, rede, http) => { const e = new Error(msg); e.rede = rede; if (http) e.http = http; return e; };
    if (!salasBotConfigurado()) return reject(falhaRede('SALASBOT_URL/SALASBOT_SEGREDO não configurados', 'CONFIG'));
    let u;
    try { u = new URL(SALASBOT_URL + caminho); } catch { return reject(falhaRede('SALASBOT_URL inválida', 'CONFIG')); }
    const lib = u.protocol === 'https:' ? https : http;
    const dados = corpo === undefined ? null : Buffer.from(JSON.stringify(corpo));
    const headers = { 'x-segredo': SALASBOT_SEGREDO, 'Connection': 'close' };
    if (dados) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = dados.length; }
    const req = lib.request({
      method: metodo, hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search, headers, timeout: timeoutMs, agent: false
    }, res => {
      const partes = [];
      res.on('data', p => partes.push(p));
      res.on('end', () => {
        let j;
        try { j = JSON.parse(Buffer.concat(partes).toString('utf8') || '{}'); }
        catch { return reject(falhaRede(`resposta inválida do bot de salas (HTTP ${res.statusCode})`, 'RESPOSTA_INVALIDA', res.statusCode)); }
        if (res.statusCode >= 400 || j.ok === false) {
          const e = new Error(String(j.erro || `HTTP ${res.statusCode}`));
          e.codigo = String(j.codigo || `HTTP_${res.statusCode}`); e.http = res.statusCode; e.corpo = j;
          return reject(e);
        }
        resolve(j);
      });
    });
    req.on('timeout', () => req.destroy(falhaRede('tempo esgotado', 'TIMEOUT')));
    req.on('error', e => { if (!e.rede) e.rede = e.code || 'ERRO_REDE'; reject(e); });
    if (dados) req.write(dados);
    req.end();
  });
}
// A requisição com certeza NÃO chegou ao bot de salas (seguro cair no fluxo antigo).
function salasBotNaoEntregue(e) {
  if (!e || e.codigo) return false;
  if (['CONFIG', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH'].includes(e.rede)) return true;
  return e.rede === 'RESPOSTA_INVALIDA' && [502, 503, 504].includes(e.http);
}

// ---- ajustes de saldo feitos AQUI (compra de salas, admin, débito offline) viram "pendência" e vão para o bot de salas ----
function salasBotRegistrarDelta(userId, delta) {
  try {
    delta = Math.trunc(Number(delta));
    if (!delta || !salasBotConfigurado() || !salasBot.ativo) return;
    const id = String(userId);
    const novo = (Number(obterConfigUsuario(id).salasBotPendente) || 0) + delta;
    salvarConfigUsuario(id, { salasBotPendente: novo === 0 ? null : novo, salasBotPendenteChave: novo === 0 ? null : crypto.randomBytes(6).toString('hex') });
    salasBotEnviarPendentes([id]).catch(e => aviso(`Bot de salas: não enviei o ajuste de saldo de ${id}: ${e.message}`));
  } catch (e) { aviso(`Bot de salas: ajuste de saldo: ${e.message}`); }
}
async function salasBotEnviarPendentes(ids) {
  if (!salasBotLigado()) return;
  for (const id of ids) {
    if (salasBotFlushEmAndamento.has(id)) continue;
    const c = obterConfigUsuario(id);
    const pend = Number(c.salasBotPendente) || 0;
    if (!pend) continue;
    salasBotFlushEmAndamento.add(id);
    try {
      await salasBotChamar('POST', '/automed/ajustar-saldo', {
        userId: id, delta: pend, motivo: 'ajuste feito no AutoMed',
        chave: `am:${id}:${c.salasBotPendenteChave || pend}`
      });
      const resto = (Number(obterConfigUsuario(id).salasBotPendente) || 0) - pend;   // pode ter entrado mais pendência durante a chamada
      salvarConfigUsuario(id, { salasBotPendente: resto === 0 ? null : resto, salasBotPendenteChave: resto === 0 ? null : crypto.randomBytes(6).toString('hex') });
      info(`🔗 Bot de salas: ajuste de ${pend > 0 ? '+' : ''}${pend} sala(s) enviado para ${id}.`);
    } finally { salasBotFlushEmAndamento.delete(id); }
  }
}

function salasBotIdsParaSync() {
  const ids = new Set();
  try { for (const id of Object.keys(carregarUsuarios())) ids.add(String(id)); } catch {}
  try { for (const id of Object.keys(carregarConfigs())) ids.add(String(id)); } catch {}
  return [...ids].filter(x => /^\d{15,20}$/.test(x));
}
// Aplica o que o bot de salas informou: "salas disponíveis" de cada usuário (+ pendências ainda não enviadas).
function salasBotAplicarSaldo(id, saldo, infinito) {
  const pend = Number(obterConfigUsuario(id).salasBotPendente) || 0;
  const novo = Math.max(0, (Number(saldo) || 0) + pend);
  const c = obterConfigUsuario(id);
  if ((Number(c.salasCompradas) || 0) !== novo || (c.salasBotInfinito === true) !== (infinito === true)) {
    salvarConfigUsuario(id, { salasCompradas: novo, salasBotInfinito: infinito === true ? true : null });
  }
}
async function salasBotSincronizar() {
  if (!salasBotConfigurado() || salasBotSyncRodando) return;
  salasBotSyncRodando = true;
  try {
    const ids = salasBotIdsParaSync();
    if (salasBot.ativo) await salasBotEnviarPendentes(ids).catch(e => aviso(`Bot de salas: pendências: ${e.message}`));
    let resp = { ok: true, ativo: false, usuarios: {} };
    for (let i = 0; i < Math.max(1, Math.ceil(ids.length / 400)); i++) {
      const parte = await salasBotChamar('POST', '/automed/saldos', { ids: ids.slice(i * 400, (i + 1) * 400) });
      if (!parte.ativo) { resp = { ok: true, ativo: false, usuarios: {} }; break; }
      resp = { ok: true, ativo: true, usuarios: { ...resp.usuarios, ...(parte.usuarios || {}) } };
    }
    const antes = salasBot.ativo;
    salasBot.ativo = resp.ativo === true;
    salasBot.online = true;
    salasBot.ultimoSync = Date.now();
    if (salasBot.ultimoErro) { salasBot.ultimoErro = ''; sucesso('🔗 Bot de salas: conexão restabelecida.'); }
    if (salasBot.ativo !== antes) info(`🔗 Ligação com o bot de salas: ${salasBot.ativo ? 'LIGADA — salas sincronizadas e criação pelo bot de salas ATIVA' : 'DESLIGADA no bot de salas (/salasbotzeroun) — fluxo antigo'}`);
    if (salasBot.ativo) for (const [id, d] of Object.entries(resp.usuarios)) salasBotAplicarSaldo(id, d.saldo, d.infinito);
  } catch (e) {
    salasBot.online = false;
    const msg = e.codigo ? `${e.codigo}: ${e.message}` : e.message;
    if (msg !== salasBot.ultimoErro) { salasBot.ultimoErro = msg; aviso(`🔗 Bot de salas: sincronização falhou (${msg}).`); }
  } finally { salasBotSyncRodando = false; }
}
function iniciarSalasBot() {
  if (salasBotTimer) return;
  if (!salasBotConfigurado()) { info('🔗 Bot de salas: defina SALASBOT_URL e SALASBOT_SEGREDO no .env para ligar a sincronização.'); return; }
  salasBotSincronizar().catch(() => {});
  salasBotTimer = setInterval(() => { salasBotSincronizar().catch(() => {}); }, SALASBOT_SYNC_MS);
}

// Pede ao bot de salas para criar a sala neste canal. Retorna { status }:
//  'criada' | 'duplicada' | 'incerto' (não deu para confirmar: NÃO cria outra) | 'sem_saldo' | 'indisponivel' (cai no fluxo antigo)
async function salasBotCriarSala(canal, userId, guildId, tipo, cfgU) {
  if (!salasBotLigado()) return { status: 'indisponivel' };
  const chave = `am:${canal.id}:${Date.now().toString(36)}:${crypto.randomBytes(3).toString('hex')}`;   // mesma chave em todas as tentativas = nunca cria 2x
  const corpo = {
    chave, userId: String(userId), guildId: String(guildId || ''), channelId: String(canal.id), tipo,
    canalNome: String(canal.name || ''), categoriaNome: String((canal.parent && canal.parent.name) || '')
  };
  const senha = String((cfgU && cfgU.senhaFixa) || '').trim();
  if (senha) corpo.senha = senha;
  const go = Number(cfgU && cfgU.tempoGo);
  if (Number.isFinite(go) && go >= 1) corpo.goMin = Math.floor(go);
  await salasBotEnviarPendentes([String(userId)]).catch(() => {});   // o débito certo tem que estar lá antes de criar
  let resp = null, erroFinal = null;
  for (let t = 1; t <= 3; t++) {
    try { resp = await salasBotChamar('POST', '/automed/criar-sala', corpo, 90000); erroFinal = null; break; }
    catch (e) {
      erroFinal = e;
      if (e.codigo || e.rede === 'CONFIG') break;               // o bot de salas respondeu (ou config errada): não adianta repetir
      if (e.rede === 'TIMEOUT' && t >= 2) break;                // não fica minutos esperando
      if (t < 3) await new Promise(r => setTimeout(r, 700 * t));
    }
  }
  if (resp && resp.ok) {
    salasBotPorCanal.set(String(canal.id), Date.now());
    salvarConfigUsuario(userId, {
      salasCompradas: Number.isFinite(Number(resp.saldoRestante)) ? Math.max(0, Number(resp.saldoRestante) + (Number(obterConfigUsuario(userId).salasBotPendente) || 0)) : (Number(obterConfigUsuario(userId).salasCompradas) || 0),
      salasBotInfinito: resp.infinito === true ? true : null
    });
    evtRegistrar({ chave: `s|sb|${resp.sshash || resp.roomId || chave}`, tipo: 'sala', resp: userId });
    info(`🎮 [${userId}] Sala ${resp.modoNome || tipo} criada pelo BOT DE SALAS em #${canal.name} (${resp.roomId || '?'}) — sem comando no chat.`);
    logEmbed('geral', '🎮 Sala criada pelo bot de salas (2 pagamentos)', [
      ['Modo', String(resp.modoNome || tipo), true], ['ID', String(resp.roomId || '?'), true], ['Canal', `#${canal.name}`, true],
      ['Salas restantes', resp.infinito ? 'ilimitadas' : String(Math.max(0, Number(resp.saldoRestante) || 0)), true]
    ], userId).catch(logErro);
    return { status: 'criada', resp };
  }
  const e = erroFinal || new Error('sem resposta');
  if (e.codigo === 'SEM_SALDO') {
    salvarConfigUsuario(userId, { salasCompradas: 0, salasBotInfinito: null });
    info(`🎮 [${userId}] Bot de salas: usuário sem salas disponíveis.`);
    return { status: 'sem_saldo' };
  }
  if (e.codigo === 'CANAL_JA_TEM_SALA') { salasBotPorCanal.set(String(canal.id), Date.now()); return { status: 'duplicada' }; }
  if (e.codigo === 'LIGACAO_DESLIGADA') { salasBot.ativo = false; return { status: 'indisponivel' }; }
  if (e.codigo) { aviso(`[${userId}] Bot de salas não criou a sala (${e.codigo}: ${e.message}) — usando o fluxo antigo.`); return { status: 'indisponivel' }; }
  if (salasBotNaoEntregue(e)) { salasBot.online = false; aviso(`[${userId}] Bot de salas fora do ar (${e.message}) — usando o fluxo antigo.`); return { status: 'indisponivel' }; }
  // timeout / resposta estranha: a sala PODE ter sido criada — não cria outra para não duplicar.
  aviso(`[${userId}] Bot de salas não confirmou a criação (${e.message}). NÃO vou criar outra sala em #${canal.name}.`);
  salasBotPorCanal.set(String(canal.id), Date.now());
  try { await enviarCanal(canal, '⚠️ Não consegui confirmar se a sala foi criada. Se ela não aparecer em instantes, chame um mediador.'); } catch {}
  return { status: 'incerto' };
}

// 🔗 Avisa o bot de salas QUEM criou a sala (ele registra em "salas criadas" com o criador certo).
// Antes de mandar o comando no chat: o bot de salas troca o autor do comando pelo usuário que pagou.
async function salasBotAvisarCriador(canal, userId, guildId) {
  if (!salasBotConfigurado()) return;
  try { await salasBotChamar('POST', '/automed/criador', { userId: String(userId), channelId: String(canal.id), guildId: String(guildId || '') }, 8000); }
  catch (e) { aviso(`Bot de salas: não consegui avisar o criador (${e.codigo || e.rede || e.message}).`); }
}
// Sala criada AQUI (API): o bot de salas só registra no canal de "salas criadas".
function salasBotAvisarSalaCriada(canal, userId, guildId, tipo, sala) {
  if (!salasBotConfigurado()) return;
  salasBotChamar('POST', '/automed/sala-criada', {
    chave: `sc:${sala.session_id || sala.room_id}`, userId: String(userId), guildId: String(guildId || ''), channelId: String(canal.id),
    modo: tipo, roomId: String(sala.room_id || ''), senha: sala.password ? String(sala.password) : '', sshash: String(sala.session_id || '')
  }, 15000).catch(e => aviso(`Bot de salas: não consegui registrar a sala criada (${e.codigo || e.rede || e.message}).`));
}
async function enviarComandoSala(canal, userId, guildId, tipo) {
  const comando = obterComandoSala(userId, guildId, tipo);
  const arg = argSalaDoServidor(userId, guildId, tipo);
  if (comando.startsWith('/')) {
    aviso(`[${userId}] Slash "${comando}" não é enviado por conta de usuário. Configure um comando de texto (ex.: !cs).`);
    return false;
  }
  // O comando é para o bot de salas do SERVIDOR: bot não aciona bot, então sai SEMPRE pela conta (mesmo com antiban ativo).
  await enviarCanal(canal, arg ? `${comando} ${arg}` : comando, { forcarSelfbot: true });
  return true;
}
// true = automed ativo, sem salas compradas e COM comando configurado no servidor → manda o comando (em vez de bloquear por saldo).
const SEM_SALDO_USA_COMANDO_DO_SERVIDOR = true;
async function entregarSala(canal, userId, guildId) {
  // PROTEÇÃO CONTRA SALA DUPLICADA: já existe sala vigente (ou sendo criada) neste canal.
  if (entregasEmAndamento.has(canal.id) || salaAtivaVigente(canal.id) || salasBotCanalRecente(canal.id)) {
    aviso(`[${userId}] Sala já criada/em andamento em #${canal.name} — não crio outra.`);
    return;
  }
  entregasEmAndamento.add(canal.id);
  setTimeout(() => entregasEmAndamento.delete(canal.id), 60000);
  limparVerificadosCanal(userId, canal.id);
  const tipo = tipoSalaDoCanal(canal);
  const cfgU = obterConfigUsuario(userId);
  const contar = () => salvarConfigUsuario(userId, { salasCriadas: (Number(obterConfigUsuario(userId).salasCriadas) || 0) + 1 });
  const automedLigado = automedAtivoNoServidor(cfgU, guildId);
  info(`🎮 [${userId}] 2 pagamentos em #${canal.name} (servidor ${guildId || '?'}): sala automed ${automedLigado ? 'ATIVADA → crio pela API' : 'DESATIVADA → envio o comando do servidor'}.`);
  // BOT DE SALAS (ligado em /salasbotzeroun): ele debita 1 sala do usuário e cria a sala NESTE canal, sem comando no chat.
  const viaSalasBot = await salasBotCriarSala(canal, userId, guildId, tipo, cfgU);
  if (viaSalasBot.status === 'criada') { contar(); return; }
  if (viaSalasBot.status === 'duplicada' || viaSalasBot.status === 'incerto') return;
  // (se não deu: sem saldo / bot de salas indisponível → segue o fluxo antigo abaixo; o saldo local já foi atualizado pelo sync)
  const cfgAtual = obterConfigUsuario(userId);
  const dispA = Number(cfgAtual.salasCompradas) || 0;
  const semSaldo = automedLigado && dispA <= 0 && !ehLiberado(userId) && cfgAtual.salasBotInfinito !== true;
  const cmdConfigurado = comandoSalaDoServidor(userId, guildId, tipo);
  if (semSaldo) {
    if (SEM_SALDO_USA_COMANDO_DO_SERVIDOR && cmdConfigurado) {
      // Sem saldo, mas o mediador configurou um comando para este servidor: usa o comando dele (não cria pela API e não reclama de saldo).
      info(`🎮 [${userId}] Sem salas compradas, mas há comando configurado neste servidor ("${cmdConfigurado}") → envio o comando em vez de criar pela API.`);
    } else {
      // SEM SALDO e sem comando configurado: NÃO cria sala.
      aviso(`[${userId}] Sem salas disponíveis — sala NÃO criada pelo automed (automed ATIVO neste servidor; desative em Salas → Ativar salas automed para usar só o comando do servidor).`);
      try { await enviarCanal(canal, '❌ Você não tem salas disponíveis. Compre em **Comprar salas**.'); } catch {}
      return;
    }
  }
  if (automedLigado && !semSaldo) {
    const disp = dispA;
    try {
      const sala = await rxCriarSala(tipo, String(cfgU.senhaFixa || '').trim());
      if (sala && sala.session_id) evtRegistrar({ chave: `s|api|${sala.session_id}`, tipo: 'sala', resp: userId });   // conta NA HORA, mesmo se o envio das mensagens falhar
      if (disp > 0) { salvarConfigUsuario(userId, { salasCompradas: disp - 1 }); salasBotRegistrarDelta(userId, -1); }
      contar();
      sala.mensagemInicial = await enviarMensagensSala(canal, tipo, sala);
      info(`🎮 [${userId}] Sala ${tipo} criada pela API em #${canal.name} (${sala.room_id}) • API: ${NOME_API_SALA[sala.provider] || sala.provider || '?'}`);
      salasBotAvisarSalaCriada(canal, userId, guildId, tipo, sala);
      evtRegistrar({ chave: `s|api|${sala.session_id}`, tipo: 'sala', resp: userId });
      logEmbed('geral', '🎮 Sala criada (2 pagamentos)', [['Modo', tipo, true], ['ID', String(sala.room_id), true], ['Senha', String(sala.password), true], ['Canal', `#${canal.name}`, true], ['Salas restantes', String(Number(obterConfigUsuario(userId).salasCompradas) || 0), true]], userId).catch(logErro);
      prepararGo(canal, userId, sala).catch(e => aviso(`GO: ${e.message}`));
      acompanharSala(canal, sala).catch(e => aviso(`Acompanhar sala: ${e.message}`));
      return;
    } catch (e) {
      aviso(`[${userId}] Falha ao criar sala pela API: ${e.message} — usando o comando do servidor.`);
    }
  }
  cmdAutoPorCanal.set(canal.id, Date.now());
  await salasBotAvisarCriador(canal, userId, guildId);
  const enviado = await enviarComandoSala(canal, userId, guildId, tipo);
  if (enviado) {
    contar();
    evtRegistrar({ chave: `s|cmd|${canal.id}|${Math.floor(Date.now() / 60000)}`, tipo: 'sala', resp: userId });
  } else {
    aviso(`[${userId}] Comando de sala NÃO enviado em #${canal.name}: "${obterComandoSala(userId, guildId, tipo)}" é slash. Configure um comando de texto (ex.: !cs).`);
  }
  info(`📨 2 pagamentos → sala ${tipo} → comando: ${obterComandoSala(userId, guildId, tipo)}`);
}
function canalInfinito(canal) {
  return String(canal?.name || '').toLowerCase().includes('infinito');
}
function tipoSalaPorNome(nome) {
  const n = String(nome || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (!n) return null;
  if (/infinit/.test(n)) return 'infinito';
  if (/full ?capa/.test(n)) return 'fullcapa';
  if (/tatic/.test(n)) return 'tatico';
  if (/speed/.test(n)) return 'speed';
  return null;
}
function tipoSalaDoCanal(canal) {
  const nomes = [canal && canal.name, canal && canal.parent && canal.parent.name];
  for (const nome of nomes) {
    const t = tipoSalaPorNome(nome);
    if (t) return t;
  }
  return 'normal';
}
function guildIdDaMensagem(mensagem) {
  return String(
    (mensagem && (mensagem.guildId || (mensagem.guild && mensagem.guild.id) ||
      (mensagem.channel && (mensagem.channel.guildId || (mensagem.channel.guild && mensagem.channel.guild.id))))) || ''
  );
}
// ============================================================
// MEDIAÇÃO CONCLUÍDA: a cada pagamento verificado, o bot oficial manda um card nos canais definidos em /canal-mediacoes
// (só o dono define, e só nos servidores autorizados abaixo).
// ============================================================
const MED_GUILDS_PERMITIDOS = ['1541560769148362903', '1569823053133783141'];
const MED_CANAIS_PATH = path.join(__dirname, 'mediacoes_canais.json');
let SectionBuilderDJS = null, ThumbnailBuilderDJS = null, ChannelSelectMenuBuilderDJS = null, ChannelTypeDJS = null;
try {
  const _djsMed = require('discord.js');
  SectionBuilderDJS = _djsMed.SectionBuilder || null;
  ThumbnailBuilderDJS = _djsMed.ThumbnailBuilder || null;
  ChannelSelectMenuBuilderDJS = _djsMed.ChannelSelectMenuBuilder || null;
  ChannelTypeDJS = _djsMed.ChannelType || null;
} catch {}
const MED_CONTADOR_PATH = path.join(__dirname, 'mediacoes_contador.json');
function medProximoNumero() {
  let n = 0;
  try { n = Number(JSON.parse(fs.readFileSync(MED_CONTADOR_PATH, 'utf8')).total) || 0; } catch {}
  n += 1;
  try { fs.writeFileSync(`${MED_CONTADOR_PATH}.tmp`, JSON.stringify({ total: n })); fs.renameSync(`${MED_CONTADOR_PATH}.tmp`, MED_CONTADOR_PATH); }
  catch (e) { aviso(`Contador de mediações: ${e.message}`); }
  return n;
}
function medCarregarCanais() {
  try { const j = JSON.parse(fs.readFileSync(MED_CANAIS_PATH, 'utf8')); return j && typeof j === 'object' ? j : {}; } catch { return {}; }
}
function medSalvarCanal(guildId, canalId) {
  const o = medCarregarCanais();
  o[String(guildId)] = String(canalId);
  try { fs.writeFileSync(`${MED_CANAIS_PATH}.tmp`, JSON.stringify(o, null, 2)); fs.renameSync(`${MED_CANAIS_PATH}.tmp`, MED_CANAIS_PATH); }
  catch (e) { erro(`Salvar canal de mediações: ${e.message}`); }
}
async function medNomeUsuario(id) {
  try {
    const u = await botClient.users.fetch(String(id));
    return u.globalName || u.displayName || u.username || String(id);
  } catch { return String(id); }
}
async function medAvatar(contaId) {
  try { const u = await botClient.users.fetch(String(contaId)); return u.displayAvatarURL({ size: 256 }); } catch { return null; }
}
// Jogadores: usa os IDs que já temos (AutoPay) ou procura o card da aposta no histórico do canal.
async function medJogadores(canal, userId, ids) {
  try {
    let lista = Array.isArray(ids) && ids.length ? ids.map(String) : null;
    if (!lista && canal && canal.messages && typeof canal.messages.fetch === 'function') {
      const msgs = await canal.messages.fetch({ limit: 50 });
      const ordenadas = Array.from(msgs.values()).sort((a, b) => (b.createdTimestamp || 0) - (a.createdTimestamp || 0));
      for (const m of ordenadas) {
        if (!(m.author && m.author.bot)) continue;
        let ok = false;
        try { ok = !!extrairValorConta(m, userId); } catch {}
        if (!ok) continue;
        const j = jogadoresDoEmbed(m);
        if (j && j.length) { lista = j; break; }
      }
    }
    if (!lista || !lista.length) return [];
    return await Promise.all(lista.slice(0, 2).map(medNomeUsuario));
  } catch { return []; }
}
function medMontar(d) {
  const ts = Math.floor(Date.now() / 1000);
  const hora = new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour12: false });
  const valorTxt = formatarValor(d.valor);
  const LINHA = '━━━━━━━━━━━━━━━━━━━━━━';
  const texto = [
    '# ✅ Mediação concluída',
    `🕒 <t:${ts}:F> · <t:${ts}:R>`,
    LINHA,
    '-# 👤 CONTA',
    ...(d.contaLivre ? [`<@${d.contaId}>`] : [`<@${d.contaId}> · **${d.contaNome}**`, `\`${d.contaId}\``]),
    '',
    '-# 🌐 SERVIDOR',
    `**${d.servidor}** · \`${d.guildId}\``,
    '',
    '-# 💬 CANAL',
    `**#${d.canalNome}**${d.canalExtra ? ` (${d.canalExtra})` : ''}`,
    '',
    '-# 🎮 JOGADORES',
    d.jogadores && d.jogadores.length ? d.jogadores.map(n => `**${n}**`).join(', ') : '—',
    '',
    '-# 🏦 BANCO',
    d.banco ? `**${d.banco}**` : '—',
    '',
    '-# 💰 PIX RECEBIDO',
    `**${valorTxt}**`,
    '',
    '-# ⏰ HORÁRIO',
    `\`${hora}\` (Brasília)`,
    LINHA,
    '-# 📋 RESUMO',
    `> ✅ Mediação concluída · **${valorTxt}** recebidos`,
    '-# Zeroun AutoMed · Sempre Em Outro Nível.',
    `-# mediação numero: ${d.numero}`
  ].join('\n');
  const textoFinal = emojiTexto(texto).slice(0, 3900);
  if (V2_OK && SectionBuilderDJS && ThumbnailBuilderDJS && d.avatar) {
    try {
      const sec = new SectionBuilderDJS()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(textoFinal))
        .setThumbnailAccessory(new ThumbnailBuilderDJS().setURL(d.avatar));
      const c = new ContainerBuilder().setAccentColor(parseInt(String(COR.pagamentos).replace('#', ''), 16)).addSectionComponents(sec);
      return { components: [c], flags: MessageFlagsDJS.IsComponentsV2, allowedMentions: { parse: [] } };
    } catch {}
  }
  const emb = new EmbedBuilder().setColor(COR.pagamentos).setDescription(textoFinal);
  if (d.avatar) emb.setThumbnail(d.avatar);
  return { embeds: [emb], allowedMentions: { parse: [] } };
}
async function medDispararPagamento({ userId, canal, guildId, valor, banco, idsJogadores, pagador }) {
  try {
    const destinos = Array.from(new Set(Object.values(medCarregarCanais()).filter(Boolean)));
    if (!destinos.length || !botClient || !botClient.user) return;   // nada configurado: não faz nada
    const u = carregarUsuarios()[userId] || {};
    const sb = selfbots.get(String(userId));
    const contaId = String(u.contaId || u.userIdDetectado || (sb && sb.user && sb.user.id) || userId);
    const contaLivre = !u.token && !!abLivreCfg(u);   // conta antiban: sem token, o bot oficial responde
    const nomePagador = String(pagador || '').replace(/\s+/g, ' ').trim();
    const avatar = await medAvatar(contaId);
    const jogadores = nomePagador ? [nomePagador] : await medJogadores(canal, userId, idsJogadores);
    let servidor = (canal && canal.guild && canal.guild.name) || '';
    if (!servidor) { const n = nomeDoServidor(userId, guildId); if (n && n !== 'Servidor desconhecido') servidor = n; }
    if (!servidor) { try { const gg = botClient.guilds.cache.get(String(guildId)); if (gg) servidor = gg.name; } catch {} }
    if (!servidor) servidor = 'Servidor desconhecido';
    const payload = medMontar({
      contaId, contaLivre,
      contaNome: obterNomeConta(userId) || (sb && sb.user && sb.user.username) || contaId,
      servidor, guildId: String(guildId || ''),
      canalNome: (canal && canal.name) || '?',
      canalExtra: String((canal && canal.topic) || '').replace(/\s+/g, ' ').trim().slice(0, 60),
      jogadores, banco: banco ? String(banco) : '', valor: Number(valor) || 0, avatar,
      numero: medProximoNumero()
    });
    for (const id of destinos) {
      try {
        const ch = await botClient.channels.fetch(String(id));
        if (ch && typeof ch.send === 'function') await ch.send(payload);
      } catch (e) { aviso(`Mediação concluída → canal ${id}: ${e.message}`); }
    }
  } catch (e) { aviso(`Mediação concluída: ${e.message}`); }
}
function medTelaCanal(guildId, aviso_) {
  const atual = medCarregarCanais()[String(guildId)];
  const tipos = [ChannelTypeDJS.GuildText];
  if (ChannelTypeDJS.GuildAnnouncement !== undefined) tipos.push(ChannelTypeDJS.GuildAnnouncement);
  const menuCanal = new ChannelSelectMenuBuilderDJS()
    .setCustomId('mc_canal').setPlaceholder('Escolha o canal das mediações...')
    .setChannelTypes(...tipos).setMinValues(1).setMaxValues(1);
  return painel({
    cor: COR.pagamentos,
    texto: ['# Canal das mediações', RODAPE, '',
      atual ? `Canal atual: <#${atual}>` : 'Nenhum canal definido.', '',
      '-# Todo pagamento verificado pelas contas vira um card "Mediação concluída" nesse canal.'
    ].join('\n') + linhaAviso(aviso_),
    linhas: [new ActionRowBuilder().addComponents(menuCanal)]
  });
}
async function medValidarUso(interacao) {
  if (!DONOS_IDS.has(String(interacao.user.id))) { await responderTexto(interacao, '⛔ Apenas o dono pode usar este comando.'); return false; }
  if (!interacao.guildId || !MED_GUILDS_PERMITIDOS.includes(String(interacao.guildId))) { await responderTexto(interacao, '⛔ Este comando só funciona nos servidores autorizados.'); return false; }
  if (!ChannelSelectMenuBuilderDJS || !ChannelTypeDJS) { await responderTexto(interacao, '⛔ Seu discord.js não tem o seletor de canais. Rode: npm install discord.js@latest'); return false; }
  return true;
}
async function medComando(interacao) {
  if (!(await medValidarUso(interacao))) return;
  await interacao.reply(opcoesResposta(medTelaCanal(interacao.guildId), true));
}
async function medTratarSelect(interacao) {
  if (!(await medValidarUso(interacao))) return;
  const canalId = String((interacao.values && interacao.values[0]) || '');
  if (!canalId) { await interacao.update(medTelaCanal(interacao.guildId, '⚠️ Nenhum canal escolhido.')); return; }
  try {
    const ch = interacao.guild && interacao.guild.channels.cache.get(canalId);
    const eu = interacao.guild && interacao.guild.members && interacao.guild.members.me;
    if (ch && eu && typeof ch.permissionsFor === 'function') {
      const pm = ch.permissionsFor(eu);
      if (pm && !pm.has(['ViewChannel', 'SendMessages'])) {
        await interacao.update(medTelaCanal(interacao.guildId, `⚠️ Não tenho permissão para enviar mensagens em <#${canalId}>. Libere e escolha de novo.`));
        return;
      }
    }
  } catch {}
  medSalvarCanal(interacao.guildId, canalId);
  sucesso(`📣 Canal das mediações definido: ${canalId} (servidor ${interacao.guildId}) por ${interacao.user.id}`);
  await interacao.update(medTelaCanal(interacao.guildId, `✅ Canal definido: <#${canalId}>`));
}
async function confirmarPagamento(mensagem, pagamento, valorEsperado, userId) {
  const canalId = mensagem.channel.id;
  const guildId = guildIdDaMensagem(mensagem);
  const cfg = obterConfigUsuario(userId);
  pagamentoEncontrado(pagamento.nome, pagamento.valor, mensagem.channel?.name);
  sucesso(`[${userId}] Confirmado — ${formatarValor(pagamento.valor)}`);
  registrarVerificado(userId, pagamento.nome, canalId);
  medDispararPagamento({ userId, canal: mensagem.channel, guildId, valor: pagamento.valor, banco: pagamento.banco, pagador: pagamento.nome }).catch(logErro);
  evtRegistrar({ chave: `c|${pagamento.uid}`, tipo: 'confirmado', via: 'gmail', resp: userId, nome: pagamento.nome, valor: pagamento.valor, banco: pagamento.banco });
  logEmbed('autopay', '💰 PAGAMENTO ENCONTRADO', [
    ['Selfbot', String(obterNomeConta(userId) || userId), true],
    ['Quem pagou', pagamento.nome, true],
    ['Valor pago', formatarValor(pagamento.valor), true],
    ['Esperado', formatarValor(valorEsperado), true],
    ['Canal', `#${mensagem.channel?.name}`, true],
    ['Servidor', nomeDoServidor(userId, guildId), true],
    ['Quem mandou o pg', String((mensagem.author && mensagem.author.username) || '?'), true],
    ['Mensagem', String(mensagem.content || '').slice(0, 100) || '—']
  ], userId).catch(logErro);
  const silencioso = cfg.modoSilencioso === true;
  await enviarResultado(mensagem, '✅', silencioso);
  if (!silencioso) {
    await Promise.all([
      apagarComando(mensagem),
      (async () => {
        try {
          const txtConfirm = aplicarPlaceholders(obterMensagemVariada(userId, guildId, 'msgConfirmado', 'confirmado'), { nome: pagamento.nome, valor: pagamento.valor });
          await enviarOuEditarEspera(mensagem, pagamento.nome, txtConfirm);
        } catch (e) { aviso(`Confirmação: ${e.message}`); }
      })()
    ]);
  }
  const pend = pagamentosPendentesPorCanal.get(canalId);
  if (pend && nomesCorrespondem(pend.nome, pagamento.nome)) {
    pagamentosPendentesPorCanal.delete(canalId);
  }
  const atual = contadorPagamentosPorCanal.get(canalId) || 0;
  const novo = atual + 1;
  contadorPagamentosPorCanal.set(canalId, novo);
  info(`📊 Pagamentos no canal: ${novo}`);
  apagarEmailBackground(pagamento, userId);
  const modoRecriar = canaisRecriar.delete(canalId);
  if (novo >= 2 || modoRecriar) {
    contadorPagamentosPorCanal.set(canalId, 0);
    try {
      const ganho = Number(cfg.ganhoFila) || 0;
      if (ganho > 0) {
        const lucroAtual = Number(obterConfigUsuario(userId).lucro) || 0;
        const total = Number((lucroAtual + ganho).toFixed(2));
        salvarConfigUsuario(userId, { lucro: total });
        info(`💸 [${userId}] +${formatarValor(ganho)} no .lucro (total ${formatarValor(total)})`);
      }
    } catch (eL) { aviso(`Lucro: ${eL.message}`); }
    try { await entregarSala(mensagem.channel, userId, guildId); } catch {}
  }
}
async function pagamentoParcial(mensagem, pagamento, valorEsperado, userId) {
  const canalId = mensagem.channel.id;
  const guildId = guildIdDaMensagem(mensagem);
  const restante = Number((valorEsperado - pagamento.valor).toFixed(2));
  pagamentoEncontrado(pagamento.nome, pagamento.valor, mensagem.channel?.name);
  aviso(`[${userId}] Parcial — FALTOU ${formatarValor(restante)}`);
  logEmbed('autopay', '⚠️ PAGAMENTO PARCIAL', [
    ['Selfbot/Conta', `${obterNomeConta(userId) || userId} (\`${userId}\`)`],
    ['Pagador', pagamento.nome],
    ['Valor pago', formatarValor(pagamento.valor)],
    ['Esperado', formatarValor(valorEsperado)],
    ['Faltou', formatarValor(restante)],
    ['Canal', `#${mensagem.channel?.name}`]
  ], userId).catch(logErro)
  pagamentosPendentesPorCanal.set(canalId, { nome: pagamento.nome, restante });
  evtRegistrar({ chave: `p|${pagamento.uid}`, tipo: 'parcial', via: 'gmail', resp: userId, nome: pagamento.nome, valor: pagamento.valor, banco: pagamento.banco });
  const silencioso = modoSilencioso(userId);
  await enviarResultado(mensagem, '❌', silencioso);
  if (!silencioso) {
    await apagarComando(mensagem);
    try {
      const txtParcial = aplicarPlaceholders(obterMensagemVariada(userId, guildId, 'msgParcial', 'parcial'), { nome: pagamento.nome, valor: pagamento.valor, restante });
      await enviarOuEditarEspera(mensagem, pagamento.nome, txtParcial);
    } catch (e) { aviso(`Parcial: ${e.message}`); }
  }
  apagarEmailBackground(pagamento, userId);
}
const ultimaRecuperacaoValor = new Map();
async function recuperarValorDoCanal(canal, userId) {
  const agora = Date.now();
  if (agora - (ultimaRecuperacaoValor.get(canal.id) || 0) < 20000) {
    const v = valorEsperadoPorCanal.get(canal.id);
    return v === undefined ? null : v;
  }
  ultimaRecuperacaoValor.set(canal.id, agora);
  try {
    const msgs = await canal.messages.fetch({ limit: 50 });
    const lista = Array.from(msgs.values()).sort((a, b) => (b.createdTimestamp || 0) - (a.createdTimestamp || 0));
    for (const m of lista) {
      if (conteudosProprios.has(String(m.content || '').trim())) continue;
      const d = extrairValorConta(m, userId);
      if (d) {
        valorEsperadoPorCanal.set(canal.id, d.valor, m.createdTimestamp);
        registrarAtividadeValor(userId);
        sucesso(`💰 [${userId}] Valor recuperado do histórico de #${canal.name}: ${formatarValor(d.valor)}`);
        return d.valor;
      }
      const manual = extrairValorManual(m.content || '');
      if (manual !== null) {
        valorEsperadoPorCanal.set(canal.id, manual, m.createdTimestamp);
        registrarAtividadeValor(userId);
        sucesso(`💰 [${userId}] Valor manual recuperado de #${canal.name}: ${formatarValor(manual)}`);
        return manual;
      }
    }
  } catch (e) {
    aviso(`[${userId}] Não consegui ler o histórico de #${canal.name}: ${e.message}`);
    tratarErroConta(e, userId);
  }
  return null;
}
const pagAutoCanais = new Map();
const pagAutoPerguntou = new Map();
function pagAutoAtivo(canalId) {
  const e = pagAutoCanais.get(canalId);
  return !!(e && Date.now() - e.t < 29 * 60 * 1000);
}
function jogadoresDoEmbed(mensagem) {
  // LEITOR UNIVERSAL: aceita embed normal, Components V1/V2/V3, mensagem encaminhada (snapshot), content puro,
  // menções <@id> ou ID solto. Procura jogadores e ignora mediador/ADM. Opções de menu NÃO entram (são ação, não conteúdo).
  const partes = [];
  if (mensagem && mensagem.content) partes.push(String(mensagem.content));
  for (const e0 of ((mensagem && mensagem.embeds) || [])) {
    try {
      const e = (e0 && e0.data && typeof e0.data === 'object') ? { ...e0.data, ...e0 } : (e0 || {});
      if (e.author && e.author.name) partes.push(e.author.name);
      if (e.title) partes.push(e.title);
      if (e.description) partes.push(e.description);
      for (const f of (e.fields || [])) partes.push(`${f.name || ''}\n${f.value || ''}`);
    } catch {}
  }
  try { partes.push(...textoComponentes(mensagem && mensagem.components, [], new WeakSet(), 0, true)); } catch {}
  try { partes.push(...textoExtraMensagem(mensagem)); } catch {}

  const texto = partes.join('\n');
  const meuId = String((mensagem && mensagem.client && mensagem.client.user && mensagem.client.user.id) || '');
  const medId = antibanMediadorDoCard(mensagem);   // mediador/adm do card: NUNCA entra como jogador
  const RX_JOG = /jogador|player|participante|competidor|equipe|\btime\b|\bteam\b|usu[aá]rio/i;
  const RX_MED = /mediador|mediator|[aá]rbitro|\badm\b|admin|staff|moderador/i;
  const RX_ID = /<@!?(\d{5,25})>|(?<![\d<@&#:])(\d{17,20})(?!\d)/g;
  // Lista os IDs de um trecho. O mediador/adm do card é SEMPRE excluído (não é jogador, não paga).
  // 1ª tentativa sem a própria conta; se não chegar a 2, aceita a própria conta.
  const pegar = (trecho, aceitaMeu) => {
    const l = [];
    for (const m of String(trecho).matchAll(RX_ID)) {
      const id = m[1] || m[2];
      if (medId && String(id) === String(medId)) continue;
      if (!l.includes(id) && (aceitaMeu || id !== meuId)) l.push(id);
    }
    return l;
  };
  const doisDe = fn => { let l = fn(false); if (l.length < 2) l = fn(true); return l.length >= 2 ? l.slice(0, 2) : null; };

  // Formato 1: lista "Jogadores" até "Mediador". Quem está na lista É jogador (inclusive a própria conta).
  const idx = texto.search(RX_JOG);
  if (idx >= 0) {
    let trecho = texto.slice(idx);
    const fim = trecho.search(RX_MED);
    if (fim >= 0) trecho = trecho.slice(0, fim);
    const l = pegar(trecho, true);
    if (l.length >= 2) return l.slice(0, 2);
  }

  const ehBot = !!(mensagem && mensagem.author && mensagem.author.bot);
  const eCard = !!(mensagem && ((mensagem.embeds && mensagem.embeds.length) || (mensagem.components && mensagem.components.length) || ehBot));

  // Formato 2: só menções "<@&cargo> <@j1> <@j2> <@mediador>" (corta no rótulo "mediador").
  if (ehBot) {
    let corte = texto;
    const fimMed = corte.search(RX_MED);
    if (fimMed >= 0) corte = corte.slice(0, fimMed);
    const r = doisDe(aceita => pegar(corte, aceita));
    if (r) return r;
  }

  // Formato 3 / 4: percorre linha a linha ignorando a linha do mediador (e o ID logo após o rótulo "Mediador").
  if (eCard) {
    const linhas = texto.split(/\r?\n/);
    const varrer = (aceita, soComJogador) => {
      const lista = [];
      let aposMed = false;
      let dentro = !soComJogador;
      for (const ln of linhas) {
        const temMed = RX_MED.test(ln);
        const temJog = RX_JOG.test(ln);
        if (temJog) dentro = true;
        const achados = pegar(ln, aceita);
        if (temMed) { aposMed = !achados.length; if (!temJog) continue; }
        else if (aposMed && achados.length && !temJog) { aposMed = false; continue; }
        else aposMed = false;
        if (!dentro) continue;
        for (const id of achados) if (!lista.includes(id)) lista.push(id);
      }
      return lista;
    };
    const r3 = doisDe(aceita => varrer(aceita, true));
    if (r3) return r3;
    const r4 = doisDe(aceita => varrer(aceita, false));
    if (r4) return r4;
  }

  return pegar(texto, false).slice(0, 2);
}
// Espera a conta (selfbot) estar online e devolve o canal. Usado também na recuperação após queda.
async function aguardarCanalSelfbot(userId, canalId, maxMs = 180000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const sb = selfbots.get(String(userId));
    if (sb && sb.user) {
      try {
        const ch = sb.channels.cache.get(canalId) || await sb.channels.fetch(canalId);
        if (ch) return ch;
      } catch (e) {
        if (/unknown|missing access|10003/i.test(String(e && e.message))) return null;
      }
    }
    await esperar(3000);
  }
  return null;
}
// Liga as cobranças de um grupo (2 jogadores) às mensagens do canal: confirma pagamento, edita o Pix,
// manda o resumo e entrega a sala. Usado no fluxo normal e na RECUPERAÇÃO após reiniciar o bot.
// Tudo é protegido por flags gravadas no autopay.json (notificadoPago / salaEntregueEm), então
// nenhum aviso, lucro ou sala é duplicado — mesmo se o bot cair e voltar no meio do processo.
function registrarGrupoPix(cx) {
  const { userId, ids, deps, valorTxt, grupo, pagoFlag, msgs, guildId } = cx;
  const totalG = deps.length;   // 1 (.recriar) ou 2 (.rv)
  const rotG = i => totalG === 1 ? 'PAGAMENTO' : `JOGADOR ${i + 1}/${totalG}`;
  const obterCanal = () => cx.canal ? Promise.resolve(cx.canal) : aguardarCanalSelfbot(userId, cx.canalId).then(c => { cx.canal = c; return c; });
  const obterMsg = async i => {
    if (msgs[i]) return msgs[i];
    if (!deps[i].msgId) return null;
    const canal = await obterCanal();
    if (!canal) return null;
    try { msgs[i] = await canal.messages.fetch(deps[i].msgId); } catch {}
    return msgs[i] || null;
  };
  cx.obterMsg = obterMsg;
  // "exato": o texto da edição não é variado (sinônimos).
  const editarMsg = async (i, texto, exato = false) => {
    const m = await obterMsg(i);
    if (!m) return;
    try { await editarMsgSegura(m, { content: texto }, exato); }
    catch { try { await editarMsgSegura(m, texto, exato); } catch {} }
  };
  const finalizar = async () => {
    if (grupo.fim) return;
    if (grupo.pagos < totalG) return;
    if (deps.some(d => d.salaEntregueEm)) { grupo.fim = true; return; }
    grupo.fim = true;
    const t = Date.now();
    deps.forEach(d => { d.salaEntregueEm = t; });
    apSalvar();                       // grava ANTES de criar a sala: se cair, não cria sala duas vezes
    const canal = await obterCanal();
    if (!canal) { aviso(`[${userId}] Grupo ${cx.grupoId}: canal indisponível para entregar a sala.`); return; }
    try {
      const linhasResumo = deps.map((_, k) => `**${totalG === 1 ? 'JOGADOR' : `JOGADOR ${k + 1}`}** <@${ids[k]}> — ${valorTxt} — ${grupo.nomes[k] ? `pago por **${grupo.nomes[k]}**` : 'pago'}`).join('\n');
      const fResumo = sortearFuncao('resumo') || ((l) => `# 🧾 RESUMO DOS PAGAMENTOS\n${l}`);
      await enviarCanal(canal, fResumo(linhasResumo), { delayMs: apDelayMsg() });
    } catch {}
    try {
      const ganho = Number(obterConfigUsuario(userId).ganhoFila) || 0;
      if (ganho > 0) {
        const total = Number(((Number(obterConfigUsuario(userId).lucro) || 0) + ganho).toFixed(2));
        salvarConfigUsuario(userId, { lucro: total });
      }
    } catch {}
    try { await entregarSala(canal, userId, guildId); } catch (e) { aviso(`Pag auto sala: ${e.message}`); }
  };
  cx.finalizar = finalizar;
  // ---- BANCO PROIBIDO: verificou o Pix, mas o pagador usou Inter/PicPay/Mercado Pago -> cobra um Pix extra ----
  const aoBancoProibido = async (i, nomePag, extraCents) => {
    const d = deps[i];
    d.taxaPendente = true;
    if (nomePag && !d.pagador) d.pagador = nomePag;
    apSalvar();
    const canal = await obterCanal();
    if (!canal) { aviso(`[${userId}] Banco proibido (${d.banco || '?'}) detectado, mas o canal está indisponível.`); return; }
    const extraTxt = formatarValor(extraCents / 100);
    // Gera o Pix extra enquanto o aviso "digita".
    const gerarExtra = (async () => {
      for (let t = 1; t <= 2; t++) {
        const r = await apCriarDeposito(userId, extraCents, true, false, `BP-${crypto.randomBytes(3).toString('hex')}`).catch(() => ({ ok: false }));
        if (r.ok) return r;
        await esperar(400);
      }
      return { ok: false };
    })();
    try {
      const fBanco = sortearFuncao('bancoProibido') || ((_ids, e, _i) => `## \`🟢\` BOA! VERIFIQUEI SEU PAGAMENTO!\n### MAS VOCÊ PAGOU COM BANCO PROIBIDO \`😞\` vou gerar mais um pagamento de apenas ${e} para você pagar <@${_ids[_i]}>`);
      await enviarCanal(canal, fBanco(ids, extraTxt, i), { delayMs: apDelayMsg() });
    } catch (e) { aviso(`Banco proibido (aviso): ${e.message}`); }
    const r = await gerarExtra;
    if (!r.ok) {
      d.taxaPendente = false; apSalvar();
      aviso(`[${userId}] Banco proibido: não consegui gerar o Pix extra de ${extraTxt}.`);
      try { await enviarCanal(canal, `⚠️ <@${ids[i]}> não consegui gerar o pagamento extra agora. Chame o ADM.`, { delayMs: apDelayMsg() }); } catch {}
      return;
    }
    Object.assign(r.dep, { taxaDe: d.id, canalId: canal.id, guildId: guildId || null, valorTxt: extraTxt });
    d.taxaDepId = r.dep.id;
    apSalvar();
    apCbDep.set(r.dep.id, { pago: n => aoPagarTaxa(i, n), expirou: () => aoExpirarTaxa(i) });
    const texto = [
      `<@${ids[i]}>`,
      `# 💳 PAGAMENTO EXTRA — ${extraTxt}`,
      '**Copia e cola:**',
      `\`${r.dep.copiaCola}\``,
      '-# ⚠️ Pague só esse código para liberar a sala.'
    ].filter(Boolean).join('\n');
    conteudosProprios.add(texto.trim());
    try {
      const m = await enviarCanal(canal, texto, { delayMs: Math.round(600 + Math.random() * 600) });
      r.dep.msgId = m.id; apSalvar();
    } catch (e) { aviso(`Banco proibido (Pix extra): ${e.message}`); }
    info(`🚫 [${userId}] Banco proibido (${d.banco || '?'}) — Pix extra de ${extraTxt} gerado em #${canal.name}`);
  };
  const aoPagarTaxa = async (i, nomeTaxa) => {
    const d = deps[i];
    if (d.taxaPaga) return;
    d.taxaPaga = true; d.taxaPendente = false; apSalvar();
    await aoPagar(i, d.pagador || nomeTaxa, true);
  };
  const aoExpirarTaxa = async i => {
    const d = deps[i];
    if (d.taxaPaga) return;
    d.taxaPendente = false; apSalvar();
    const canal = await obterCanal();
    if (!canal) return;
    try { if (valorEsperadoPorCanal.has(canal.id)) await enviarCanal(canal, `⏰ O pagamento extra de <@${ids[i]}> expirou. Chame o ADM.`, { delayMs: apDelayMsg() }); } catch {}
  };
  cx.aoPagarTaxa = aoPagarTaxa;
  const aoPagar = async (i, nomePag, taxaPaga = false) => {
    if (deps[i].notificadoPago) return;
    if (!taxaPaga) {
      if (deps[i].taxaPendente) return;   // já cobrou o extra: espera ele pagar
      const extraCents = Math.round(valorBancoProibido(userId) * 100);
      if (deps[i].bancoProibido && !deps[i].taxaPaga && extraCents > 0) { await aoBancoProibido(i, nomePag, extraCents); return; }
    }
    deps[i].notificadoPago = true;    // grava ANTES de enviar: nunca confirma o mesmo pagamento duas vezes
    evtRegistrar({ chave: `ap|${deps[i].id}`, tipo: 'confirmado', via: 'autopay', resp: userId, nome: nomePag || deps[i].pagador || '', valor: Number(deps[i].valorCents || 0) / 100, banco: deps[i].banco || '' });
    pagoFlag[i] = true;
    const nPag = ++grupo.pagos;
    grupo.nomes[i] = nomePag || deps[i].pagador || null;
    apSalvar();
    const ePA = pagAutoCanais.get(cx.canalId);
    if (ePA) { const pi = ePA.ids.indexOf(String(ids[i])); if (pi >= 0) ePA.pagos[pi] = true; }
    const quem = grupo.nomes[i] ? `\nPago por: **${grupo.nomes[i]}**` : '';
    const canal = await obterCanal();
    if (!canal) { aviso(`[${userId}] Pagamento do JOGADOR ${i + 1} confirmado, mas o canal está indisponível.`); return; }
    medDispararPagamento({
      userId, canal, guildId: String((canal && (canal.guildId || (canal.guild && canal.guild.id))) || ''),
      valor: Number(deps[i].valorCents || 0) / 100, banco: deps[i].banco || '', idsJogadores: Array.isArray(ids) ? ids : null, pagador: nomePag || deps[i].pagador || ''
    }).catch(logErro);
    // Confirmação e edição do Pix saem JUNTAS (antes a edição atrasava a confirmação). "Digitando" + máx. ~2,5s.
    await Promise.all([
      editarMsg(i, '-# `⏰` Pagamento confirmado', true).catch(logErro),
      (async () => {
        try {
          const fConf = sortearFuncao('pagoConfirmadoMsg') || ((rot, q, n, t) => `✅ **${rot} — ${q} — pagamento confirmado${t === 1 ? '' : ` (${n}/${t})`}.**${''}`);
          await enviarCanal(canal, fConf(rotG(i), `<@${ids[i]}>`, nPag, totalG) + quem, { delayMs: apDelayMsg() });
        } catch {}
      })()
    ]);
    await finalizar();
  };
  const aoExpirar = async i => {
    pagoFlag[i] = true;
    if (deps[i].notificadoExpirou) return;
    deps[i].notificadoExpirou = true; apSalvar();
    await editarMsg(i, '-# `⏰` Pagamento Expirado', true);
    const canal = await obterCanal();
    if (!canal) return;
    try { if (valorEsperadoPorCanal.has(canal.id)) await enviarCanal(canal, `⏰ A cobrança do **${rotG(i)}** (<@${ids[i]}>) expirou.`, { delayMs: apDelayMsg() }); } catch {}
  };
  cx.aoPagar = aoPagar;
  cx.aoExpirar = aoExpirar;
  deps.forEach((d, i) => apCbDep.set(d.id, { pago: nomePag => aoPagar(i, nomePag), expirou: () => aoExpirar(i) }));
  deps.forEach((d, i) => { if (d.taxaPendente && d.taxaDepId) apCbDep.set(d.taxaDepId, { pago: n => aoPagarTaxa(i, n), expirou: () => aoExpirarTaxa(i) }); });
}
const gruposPixEmCriacao = new Set();
const jogadoresPagosPorCanal = new Map();   // canal -> Set(jogadorId) que já pagou no grupo anterior (usado pelo .recriar)
async function pagamentosAuto(mensagem, userId, valor, porComando = false, qtdPix = 2) {
  // O delay (digitando + 5s) já é aplicado dentro do enviarCanal: aqui só ordenamos o fluxo.
  const msgsPix = [];
  const chaveCriacao = `${userId}|${mensagem.channel.id}`;
  const totalPix = Number(qtdPix) === 1 ? 1 : 2;   // .recriar = 1 Pix • .rv = 2 Pix

  try {
    // PROTEÇÃO CONTRA PIX DUPLO: já existe cobrança em andamento (ou em criação) para este canal?
    if (gruposPixEmCriacao.has(chaveCriacao)) return true;
    const agoraG = Date.now();
        const depsCanal = Object.values(apUsuario(userId).depositos || {}).filter(d =>
      d.grupoId && d.canalId === mensagem.channel.id && d.status === 'pendente');
    for (const d of depsCanal) {
      if (!d.msgId) { d.status = 'cancelado'; d.notificadoExpirou = true; }   // órfão: Pix criado mas nunca enviado
    }
    apSalvar();
    // Já existe grupo de Pix NESTE canal (pendente, pago ou expirado) que não foi substituído por .rv/.recriar? Não gera outro.
    const janelaG = 24 * 3600 * 1000;
    const existente = Object.values(apUsuario(userId).depositos || {}).some(d =>
      d.grupoId && d.canalId === mensagem.channel.id && d.msgId && !d.substituido &&
      ['pendente', 'pago', 'expirado'].includes(d.status) && agoraG - (d.criadoEm || 0) < janelaG);
    if (existente) { info(`[${userId}] Pix deste canal já gerados — não gero de novo (use .rv ou .recriar).`); return true; }
    gruposPixEmCriacao.add(chaveCriacao);
    pagAutoCanais.delete(mensagem.channel.id);
    let ids = jogadoresDoEmbed(mensagem);
    if (ids.length < 2) {
      try {
        const hist = await mensagem.channel.messages.fetch({ limit: 50 });
        const lista = Array.from(hist.values()).sort((a, b) => (b.createdTimestamp || 0) - (a.createdTimestamp || 0));
        for (const m of lista) {
          const j = jogadoresDoEmbed(m);
          if (j.length >= 2) { ids = j; break; }
        }
      } catch {}
    }
    const cents = Math.round(Number(valor) * 100);
    if (ids.length < 2 || !apAtivo() || !(cents >= 1)) {
  aviso(`[${userId}] Pag. auto NÃO gerou Pix: jogadores=${ids.length}/2 • apAtivo=${apAtivo()} • valor(cents)=${cents}`);
  if (ids.length < 2) { try { aviso(`[${userId}] [diag] card sem 2 jogadores. components=${(mensagem.components || []).length} embeds=${(mensagem.embeds || []).length} texto="${textoCompletoMensagem(mensagem).replace(/\s+/g, ' ').slice(0, 500)}"`); } catch {} }
  return false;
}
    const canal = mensagem.channel;
    const guildId = guildIdDaMensagem(mensagem);
    const valorTxt = apMoeda(cents);
    const tInicio = Date.now();
    // .recriar (1 Pix): cobra só quem ainda NÃO pagou no grupo anterior do canal; sem histórico = jogador 1.
    let idsPix = ids;
    if (totalPix === 1) {
      const pagosAnt = jogadoresPagosPorCanal.get(canal.id) || new Set();
      idsPix = [ids.find(id => !pagosAnt.has(String(id))) || ids[0]];
    }
    const gerar = async (n, codigoProibido) => {
      let r = null;
      for (let t = 1; t <= 4; t++) {
        r = await apCriarDeposito(userId, cents, true, false, `J${n}-${crypto.randomBytes(3).toString('hex')}`).catch(() => ({ ok: false }));
        let colisao = false;
        if (r.ok && codigoProibido && r.dep.copiaCola === codigoProibido) {
          r.dep.status = 'cancelado'; apSalvar();
          r = { ok: false }; colisao = true;
        }
        if (r.ok) break;
        await esperar(colisao ? 1500 : 800 + Math.floor(Math.random() * 1200));
      }
      return r;
    };
    // Os 2 Pix são gerados AO MESMO TEMPO (antes: um, espera 2,5s, outro). Se vierem iguais, refaz só o 2º.
    let rs;
    if (totalPix === 1) rs = [await gerar(1, null)];
    else {
      rs = await Promise.all([gerar(1, null), gerar(2, null)]);
      if (rs[0].ok && rs[1].ok && rs[0].dep.copiaCola === rs[1].dep.copiaCola) {
        rs[1].dep.status = 'cancelado'; apSalvar();
        rs[1] = await gerar(2, rs[0].dep.copiaCola);
      }
    }
    if (rs.some(r => !r.ok)) {
      for (const r of rs) if (r.ok) { r.dep.status = 'cancelado'; apSalvar(); }
      aviso(`[${userId}] Pagamentos auto: não consegui gerar ${totalPix === 1 ? 'o Pix' : 'os 2 Pix'} — usando instruções normais.`);
      alertaFalha(userId, 'autopay');
      return false;
    }
    // Cada cobrança fica amarrada ao grupo, jogador, canal e ordem (confirmação, .reembolsar e recuperação).
    const grupoId = `g_${crypto.randomBytes(5).toString('hex')}`;
    rs.forEach((r, i) => {
      Object.assign(r.dep, { grupoId, grupoTotal: totalPix, jogadorN: i + 1, jogadorId: idsPix[i], canalId: canal.id, guildId: guildId || null, valorTxt });
    });
    apSalvar();
    const textosPix = [];
    const pagoFlag = [false, false];
    const cx = {
      userId, grupoId, canal, canalId: canal.id, guildId, ids: idsPix, valorTxt, deps: rs.map(r => r.dep),
      msgs: msgsPix, pagoFlag, grupo: { pagos: 0, fim: false, nomes: [null, null] }
    };
    registrarGrupoPix(cx);
           // Imagem do QR dos dois jogadores, gerada ao mesmo tempo (anexada na mensagem, aparece dentro do Discord).
    // Sem baixar nada: só o link do QR no texto (o Discord mostra a imagem sozinho).
    // Nome do jogador para usar quando o servidor bloquear menções.
    const nomeSemMencao = async id => {
      try {
        const u = await canal.client.users.fetch(id);
        return String(u.globalName || u.username || id);
      } catch { return String(id); }
    };
    const montarPix = (i, quem) => {
      const fTitulo = sortearFuncao('pixTitulo') || ((t, v) => t === 1 ? `# 💳 PAGAMENTO — ${v}` : `# 💳 JOGADOR ${i + 1}/2 — ${v}`);
      const parCopia = sortearVariante('pixCopiaCola') || ['**Copia e cola:**', '-# ⚠️ Este código é só do jogador acima. Não pague o código do outro.'];
      const texto = [
        quem,
        fTitulo(totalPix, valorTxt, i + 1),
        parCopia[0],
        `\`${rs[i].dep.copiaCola}\``,
        totalPix === 1 ? '-# ⚠️ Este código é só do jogador marcado acima.' : parCopia[1]
      ].filter(Boolean).join('\n');
      conteudosProprios.add(texto.trim());
      return texto;
    };
    // Tenta marcando o jogador; se o servidor bloquear por limite de menções, reenvia sem marcar.
    for (let i = 0; i < totalPix; i++) {
      // 1º Pix: já esperou o "digitando". 2º Pix: digita de novo por ~0,6–1,2s.
      const opEnvio = { delayMs: i === 0 ? 0 : Math.round(600 + Math.random() * 600) };
      textosPix[i] = montarPix(i, `<@${idsPix[i]}>`);
      try {
        msgsPix[i] = await enviarCanal(canal, textosPix[i], opEnvio);
      } catch (eEnvio) {
        if (!/limite de men|mention/i.test(String(eEnvio && eEnvio.message))) throw eEnvio;
        aviso(`[${userId}] Servidor bloqueou a menção em #${canal.name} — reenviando o Pix sem marcar o jogador.`);
        const nomeJ = await nomeSemMencao(idsPix[i]);
        textosPix[i] = montarPix(i, `**${nomeJ}**`);
        msgsPix[i] = await enviarCanal(canal, textosPix[i], { delayMs: 0 });
      }
      try { rs[i].dep.msgId = msgsPix[i].id; apSalvar(); } catch {}
      // DIAGNÓSTICO: confirma no log que a mensagem do Pix existe no canal (id, conta, canal) e se sumiu depois.
      try {
        const mm = msgsPix[i];
        if (!mm || !mm.id) {
          aviso(`[${userId}] Pix ${i + 1}/${totalPix}: o envio NÃO devolveu mensagem (canal #${canal.name} ${canal.id}). Nada foi publicado.`);
        } else {
          info(`[${userId}] Pix ${i + 1}/${totalPix} publicado: msg=${mm.id} canal=#${canal.name} (${canal.id}) conta=${(canal.client && canal.client.user && canal.client.user.tag) || '?'}`);
          setTimeout(async () => {
            try { await canal.messages.fetch(mm.id); }
            catch (eF) { aviso(`[${userId}] Pix ${i + 1}/${totalPix} (msg ${mm.id}) NÃO está mais no canal #${canal.name}: ${String(eF && eF.message).slice(0, 80)} — apagada por bot/automod/moderador ou canal removido.`); }
          }, 4000);
        }
      } catch {}
    }
    // Índices alinhados aos 2 jogadores do canal (quem não precisa pagar conta como "já pago").
    const codigosJ = ids.map(id => { const k = idsPix.indexOf(id); return k >= 0 ? rs[k].dep.copiaCola : ''; });
    const pagosJ = ids.map(id => { const k = idsPix.indexOf(id); return k >= 0 ? !!pagoFlag[k] : true; });
    pagAutoCanais.set(canal.id, { ids: [...ids], codigos: codigosJ, pagos: pagosJ, t: Date.now() });
    info(`💳 [${userId}] Pagamentos auto: ${totalPix} Pix de ${formatarValor(cents / 100)} em #${canal.name} (${Date.now() - tInicio}ms)`);
    alertaOk(userId, 'autopay');
    return true;
  } catch (e) {
    aviso(`Pagamentos auto: ${e.message}`);
    try {   // Pix criado e nunca enviado não pode ficar valendo
      for (const d of Object.values(apUsuario(userId).depositos || {})) {
        if (d.grupoId && d.canalId === mensagem.channel.id && d.status === 'pendente' && !d.msgId) { d.status = 'cancelado'; d.notificadoExpirou = true; }
      }
      apSalvar();
    } catch {}
    if (msgsPix.some(Boolean)) {
      aviso(`[${userId}] Já havia Pix enviado em #${mensagem.channel?.name} — NÃO gero de novo. Use .rv ou .recriar para refazer.`);
      return true;
    }
    return false;
  } finally {

    gruposPixEmCriacao.delete(chaveCriacao);
  }
}
// RECUPERAÇÃO após reiniciar: religa os grupos de Pix que estavam em andamento (rodar ANTES do 1º apTick).
function apRestaurarGruposPix() {
  try {
    const db = apCarregar();
    const agora = Date.now();
    let n = 0;
    for (const [userId, u] of Object.entries(db.usuarios || {})) {
      const porGrupo = new Map();
      for (const d of Object.values(u.depositos || {})) {
        if (!d.grupoId || !d.canalId || !d.jogadorId || d.substituido) continue;
        if (agora - (d.criadoEm || 0) > 45 * 60 * 1000) continue;
        if (!porGrupo.has(d.grupoId)) porGrupo.set(d.grupoId, []);
        porGrupo.get(d.grupoId).push(d);
      }
      for (const lista of porGrupo.values()) {
        const totalR = lista[0].grupoTotal === 1 ? 1 : 2;
        if (lista.length !== totalR) continue;
        lista.sort((x, y) => (x.jogadorN || 0) - (y.jogadorN || 0));
        const [d1, d2] = lista;
        const pendente = lista.some(d =>
          d.status === 'pendente' ||
          (d.status === 'pago' && !d.notificadoPago) ||
          (['expirado', 'cancelado'].includes(d.status) && !d.notificadoExpirou) ||
          (lista.every(x => x.notificadoPago) && !d.salaEntregueEm));
        if (!pendente) continue;
        const cx = {
          userId, grupoId: d1.grupoId, canal: null, canalId: d1.canalId, guildId: d1.guildId || null,
          ids: lista.map(d => d.jogadorId), valorTxt: d1.valorTxt || apMoeda(d1.valorCents), deps: [...lista], msgs: [],
          pagoFlag: lista.map(d => !!d.notificadoPago),
          grupo: { pagos: lista.filter(d => d.notificadoPago).length, fim: lista.some(d => d.salaEntregueEm), nomes: lista.map(d => d.pagador || null) }
        };
        registrarGrupoPix(cx);
        n++;
        // Pagamentos que caíram enquanto o bot estava fora: confirma agora (uma vez só, com flag).
        (async () => {
          for (let i = 0; i < cx.deps.length; i++) {
            const d = cx.deps[i];
            if (d.taxaPendente && d.taxaDepId) {
              const ex = (apUsuario(userId).depositos || {})[d.taxaDepId];
              if (ex && ex.status === 'pago') { apCbDep.delete(ex.id); await cx.aoPagarTaxa(i, d.pagador); continue; }
            }
            if (d.status === 'pago' && !d.notificadoPago) { apCbDep.delete(d.id); await cx.aoPagar(i, d.pagador); }
            else if (['expirado', 'cancelado'].includes(d.status) && !d.notificadoExpirou) { apCbDep.delete(d.id); await cx.aoExpirar(i); }
          }
          if (cx.grupo.pagos >= cx.deps.length && !cx.grupo.fim) await cx.finalizar();
        })().catch(e => aviso(`[Recuperação] grupo ${cx.grupoId}: ${e.message}`));
      }
    }
    if (n) sucesso(`[AutoPay] Recuperação: ${n} grupo(s) de Pix religado(s) após reiniciar.`);
  } catch (e) { aviso(`[AutoPay] Recuperação de Pix: ${e.message}`); }
}
async function enviarInstrucoes(mensagem, userId, valor, nome, porComando = false, qtdPix = 2) {
  const cfg = obterConfigUsuario(userId);
  // Instruções: UMA única vez por canal. Só reenvia se usar .rv ou .recriar
  // (esses comandos limpam o registro em apComandoValorCanal).
  const chaveInstr = `${userId}|${mensagem.channel.id}`;
  {
    const tsI = ultimaInstrucaoPorCanal.get(chaveInstr);
    if (tsI !== undefined) return;
    // MODO FANTASMA: sem pagamentos auto não envia nada (só reage ✅/❌ ao verificar).
    // Com pagamentos auto ativo, gera os Pix, confirma e cria a sala normalmente.
    if (cfg.modoSilencioso === true && cfg.pagAuto !== true) return;
  }
  ultimaInstrucaoPorCanal.set(chaveInstr, Date.now());
  if (ultimaInstrucaoPorCanal.size > 5000) {
    const primeira = ultimaInstrucaoPorCanal.keys().next().value;
    ultimaInstrucaoPorCanal.delete(primeira);
  }
  try {
    if (cfg.pagAuto === true) {
  // Muitas filas juntas: se a geração do Pix falhar, tenta de novo (até 4x) com delay de 2,5–5s antes de desistir.
  for (let tentPA = 1; tentPA <= 4; tentPA++) {
    if (await pagamentosAuto(mensagem, userId, valor, porComando, qtdPix)) return;
    if (tentPA < 4) {
      aviso(`[${userId}] Pag. auto falhou em #${mensagem.channel?.name} — tentando de novo (${tentPA}/3).`);
      await delaySelfbot();
    }
  }
  // Pag. auto ligado: NÃO manda instruções. Libera para tentar de novo.
  ultimaInstrucaoPorCanal.delete(chaveInstr);
  aviso(`[${userId}] Pag. auto ativo mas falhou em #${mensagem.channel?.name} — instruções NÃO enviadas.`);
  return;
}
    const guildIdMsg = guildIdDaMensagem(mensagem);
    const textoInstr = obterMensagemVariada(userId, guildIdMsg, 'msgInstrucoes', 'instrucoes') || DEFAULT_MSG_INSTRUCOES;
    const imagemInstr = obterMensagem(userId, guildIdMsg, 'imagemInstrucoes');
    try {
      await enviarCanal(mensagem.channel, aplicarPlaceholders(textoInstr, { nome, valor }));
    } catch (eTxt) {
      ultimaInstrucaoPorCanal.delete(chaveInstr); // falhou: permite tentar de novo
      throw eTxt;
    }
    const textoPix = String(cfg.chavePix || '').replace(/`/g, '').trim();
    if (textoPix) {
      try { await enviarCanal(mensagem.channel, `### CHAVE: \`${textoPix}\``); }
      catch (ePix) { aviso(`Texto do PIX: ${ePix.message}`); }
    }
    if (imagemInstr) {
      try { await enviarCanal(mensagem.channel, imagemInstr); }
      catch (eImg) { aviso(`Foto das instruções: ${eImg.message}`); }
    }
    info(`📢 [${userId}] Instruções enviadas em #${mensagem.channel?.name}`);
  } catch (e) { aviso(`Instruções: ${e.message}`); }
}
// ----- HABILITAR PIX -----
// A chave PIX NUNCA confirma pagamento. Ela só define o valor esperado do canal
// (e libera as instruções). Quem confirma é o "pg nome e sobrenome" + e-mail com NOME E VALOR batendo.
async function procurarValorDaPessoa(mensagem) {
  const canal = mensagem.channel;
  const autorId = mensagem.author && mensagem.author.id;
  if (!canal || !canal.messages || !autorId) return null;
  const fimTs = mensagem.createdTimestamp || Date.now();
  const inicioTs = fimTs - PIX_JANELA_MS;
  const msgs = await canal.messages.fetch({ limit: PIX_LIMITE_HISTORICO });
  const lista = Array.from(msgs.values())
    .filter(m => m.id !== mensagem.id && m.author && m.author.id === autorId &&
      (m.createdTimestamp || 0) >= inicioTs && (m.createdTimestamp || 0) <= fimTs)
    .sort((a, b) => (b.createdTimestamp || 0) - (a.createdTimestamp || 0));
  for (const m of lista) {
    if (conteudosProprios.has(String(m.content || '').trim())) continue;
    const d = extrairValorENomeBot(extrairTextoComEmbeds(m));
    if (d) return d;
    const manual = extrairValorManual(m.content || '');
    if (manual !== null) return { nome: '', valor: manual };
  }
  return null;
}
async function processarChavePix(mensagem, userId) {
  const canal = mensagem.channel;
  let dados = null;
  // Item 7: sem valor definido no canal → não procura (pare).
  if (!canal || !valorEsperadoPorCanal.has(canal.id)) return;
  // Item 7: máximo 1 busca por canal a cada 30s.
  const agora = Date.now();
  if (agora - (ultimaBuscaPixPorCanal.get(canal.id) || 0) < 30000) return;
  ultimaBuscaPixPorCanal.set(canal.id, agora);
  for (let t = 1; t <= PIX_TENTATIVAS_BUSCA && !dados; t++) {
    try {
      dados = await procurarValorDaPessoa(mensagem);
    } catch (e) {
      aviso(`[${userId}] PIX: não consegui ler o histórico de #${canal.name}: ${e.message}`);
      if (tratarErroConta(e, userId)) return;
    }
    if (!dados && t < PIX_TENTATIVAS_BUSCA) {
      // Item 7: intervalo aleatório 2–4s entre buscas (nunca fixo).
      await esperar(500 + Math.floor(Math.random() * 501));
    }
  }
  if (!dados) {
    aviso(`[${userId}] 💠 Chave PIX detectada, mas não encontrei nome + valor da mesma pessoa. Não verificar.`);
    return;
  }
  const nome = String(dados.nome || '').trim();
  const valor = Number(dados.valor);
  if (!nome || !nomeValidoParaBusca(nome)) {
    aviso(`[${userId}] 💠 PIX ignorado: nome do pagador não identificado corretamente.`);
    return;
  }
  if (!Number.isFinite(valor) || valor <= 0) {
    aviso(`[${userId}] 💠 PIX ignorado: valor não identificado corretamente.`);
    return;
  }
  valorEsperadoPorCanal.set(canal.id, valor);
  registrarAtividadeValor(userId);
  sucesso(`💠 [${userId}] Chave PIX detectada — ${nome} — ${formatarValor(valor)} (aguardando "pg nome" para verificar)`);
  await enviarInstrucoes(mensagem, userId, valor, nome);
}
function valorMonetarioValido(v) {
  if (v === undefined || v === null || v === '') return false;
  const n = Number(v);
  return Number.isFinite(n) && n > 0;
}
const MSG_PG_SEM_NOME = [
  '# `🟡` ENVIE `pg` NOME E SOBRENOME, O BOT NÃO ACEITA APENAS `pg`',
  '',
  '## `🚨` IMPORTANTE!!',
  '## NÃO ENVIE O NOME DO BANCO NA MENSAGEM, NÃO PRECISA!'
].join('\n');
const avisoSemNomePorCanal = new Map();
async function processarPg(mensagem, dadosPg, userId) {
  const canalId = mensagem.channel.id;
  const guildId = guildIdDaMensagem(mensagem);
  const cfg = obterConfigUsuario(userId);
  // REGRA: sem valor monetário definido no canal = não faz nada (não responde, não reage, não avisa).
  let valorEsperado = valorEsperadoPorCanal.get(canalId);
  if (valorEsperado === undefined || valorEsperado === null) {
    valorEsperado = await recuperarValorDoCanal(mensagem.channel, userId);
  }
  if (!valorMonetarioValido(valorEsperado)) return;
  valorEsperado = Number(valorEsperado);
  if (!dadosPg.semNome && !nomeEhPessoa(dadosPg.nome)) {
    aviso(`[${userId}] "${dadosPg.nome}" não é um nome de pessoa (chave PIX/código) — ignorado, nada confirmado.`);
    return;
  }
  if (dadosPg.semNome) {
    const silenc = cfg.modoSilencioso === true;
    await enviarResultado(mensagem, '❌', silenc);
    const agoraSN = Date.now();
    if (!silenc && agoraSN - (avisoSemNomePorCanal.get(canalId) || 0) > 5000) {
      avisoSemNomePorCanal.set(canalId, agoraSN);
      try { await enviarCanal(mensagem.channel, sortearVariante('pgSemNome') || MSG_PG_SEM_NOME); }
      catch (e) { aviso(`pg sem nome: ${e.message}`); }
    }
    return;
  }
  const pend = pagamentosPendentesPorCanal.get(canalId);
  if (pend && nomesCorrespondem(dadosPg.nome, pend.nome)) {
    valorEsperado = pend.restante;
  }
  if (!nomeValidoParaBusca(dadosPg.nome)) {
    aviso(`[${userId}] Nome muito curto/incompleto ("${dadosPg.nome}") — precisa de nome e sobrenome. Não pesquisado.`);
    const silencioso = cfg.modoSilencioso === true;
    await enviarResultado(mensagem, '❌', silencioso);
    if (!silencioso) {
      try {
        await enviarCanal(mensagem.channel, aplicarPlaceholders(obterMensagemVariada(userId, guildId, 'msgNaoEncontrado', 'naoEncontrado'), { nome: dadosPg.nome, valor: valorEsperado }));
      } catch (e) { aviso(`Nome incompleto: ${e.message}`); }
    }
    return;
  }
  console.log('');
  console.log(`${C.blue}${C.bold}╭${linha(62)}╮${C.reset}`);
  console.log(`${C.blue}│  💳 VERIFICAÇÃO [${userId.slice(-4)}]${' '.repeat(Math.max(1, 60 - 17 - userId.slice(-4).length))}│${C.reset}`);
  console.log(`${C.blue}├${linha(62)}┤${C.reset}`);
  console.log(`${C.blue}│${C.reset}  👤 Cliente : ${dadosPg.nome}`);
  console.log(`${C.blue}│${C.reset}  💵 Valor   : ${formatarValor(valorEsperado)}`);
  console.log(`${C.blue}│${C.reset}  📌 Canal   : #${mensagem.channel?.name}`);
  console.log(`${C.blue}╰${linha(62)}╯${C.reset}`);
  console.log('');
  const ehRestanteParcial = pend && nomesCorrespondem(dadosPg.nome, pend.nome);
  if (!ehRestanteParcial && jaVerificadoRecente(userId, dadosPg.nome, canalId)) {
    info(`⏭️ [${userId}] "${dadosPg.nome}" já verificado nos últimos 10 min — ignorado.`);
    const silJa = cfg.modoSilencioso === true;
    await enviarResultado(mensagem, '✅', silJa);
    if (!silJa) { try { await enviarCanal(mensagem.channel, sortearVariante('jaVerificado') || MSG_JA_VERIFICADO); } catch {} }
    return;
  }
  if (pessoaEmBusca(userId, dadosPg.nome)) {
    info(`⏭️ [${userId}] "${dadosPg.nome}" já está sendo verificado agora — ignorado.`);
    return;
  }
  // ---- Busca ativa: se já está procurando esse nome no canal, ignora a duplicata ----
  const chaveBusca = `${canalId}|${normalizarNome(dadosPg.nome)}`;
  const registrosBusca = buscaAtivaPorCanal.get(chaveBusca);
  if (registrosBusca) {
    // "TUDO CERTO" já foi enviado nesta busca: não envia de novo.
    info(`⏭️ [${userId}] "pg" repetido (${dadosPg.nome}) em #${mensagem.channel?.name} — busca já ativa, ignorado.`);
    return;
  }
  if (!ehRestanteParcial && !podeBuscarNome(userId, dadosPg.nome, canalId)) {
    info(`⛔ [${userId}] "${dadosPg.nome}" já usou as ${MAX_BUSCAS_POR_NOME} buscas — libera em até 10 min.`);
    await enviarResultado(mensagem, '❌', cfg.modoSilencioso === true);
    return;
  }
  const listaEspera = [];
  buscaAtivaPorCanal.set(chaveBusca, listaEspera);
  const inicio = Date.now();
  marcarEmBusca(userId, dadosPg.nome);
  const buscaPromise = buscarPagamento(dadosPg.nome, valorEsperado, userId, canalId);
  const envioEspera = cfg.modoSilencioso === true
    ? Promise.resolve()
    : enviarCanal(mensagem.channel, sortearVariante('tudoCerto') || MSG_TUDO_CERTO).then(m => { listaEspera.push(m); }).catch(logErro);
  let pagamento;
  try { pagamento = await buscaPromise; }
  finally { desmarcarEmBusca(userId, dadosPg.nome); }
  await envioEspera;
  setTimeout(() => { if (buscaAtivaPorCanal.get(chaveBusca) === listaEspera) buscaAtivaPorCanal.delete(chaveBusca); }, 15000);
  info(`⚡ Busca em ${Date.now() - inicio}ms`);
  logEmbed('geral', pagamento ? '🔎 Busca: ENCONTRADO' : '🔎 Busca: NÃO ENCONTRADO', [
    ['Cliente digitou', dadosPg.nome, true],
    ['Valor esperado', formatarValor(valorEsperado), true],
    ['Tempo', `${Date.now() - inicio}ms`, true],
    ['Canal', `#${mensagem.channel?.name}`, true],
    ['Servidor', nomeDoServidor(userId, guildId), true],
    ['Autor', String((mensagem.author && mensagem.author.username) || '?'), true]
  ], userId).catch(logErro);
  // TRAVA FINAL: nome E valor precisam bater. Se não bater, NÃO confirma e libera o e-mail.
  if (pagamento) {
    const tolFinal = Math.max(0, Number(cfg.tolerancia) || 0);
    if (!pagamentoBateNomeEValor(pagamento, dadosPg.nome, valorEsperado, tolFinal)) {
      aviso(`[${userId}] Trava final: pagamento de "${pagamento.nome}" (${formatarValor(pagamento.valor)}) NÃO bate nome e valor com "${dadosPg.nome}" (${formatarValor(valorEsperado)}). Recusado.`);
      try { setUsuario(emailsEmUsoPorUsuario, userId).delete(pagamento.uid); } catch {}
      pagamento = null;
    }
  }
  if (!pagamento) {
    const menor = acharPagamentoMenor(dadosPg.nome, userId, (valorDefinidoEmPorCanal.get(canalId) || 0) - 300000, valorEsperado);
    if (menor && menor.valor < valorEsperado) {
      aviso(`[${userId}] Achei "${menor.nome}" com ${formatarValor(menor.valor)}, mas o esperado era ${formatarValor(valorEsperado)}.`);
      await pagamentoParcial(mensagem, menor, valorEsperado, userId);
      return;
    }
    erro(`[${userId}] Não encontrado: ${dadosPg.nome}`);
    evtRegistrar({ chave: `n|${userId}|${mensagem.id}`, tipo: 'nao_encontrado', via: 'gmail', resp: userId, nome: dadosPg.nome, valor: valorEsperado, banco: '' });
    const silencioso = cfg.modoSilencioso === true;
    await enviarResultado(mensagem, '❌', silencioso);
    if (!silencioso) {
      try {
        const txtNao = aplicarPlaceholders(obterMensagemVariada(userId, guildId, 'msgNaoEncontrado', 'naoEncontrado'), { nome: dadosPg.nome, valor: valorEsperado });
        await enviarOuEditarEspera(mensagem, dadosPg.nome, txtNao);
      } catch (e) { aviso(`Não encontrado: ${e.message}`); }
    }
    return;
  }
  const tolerancia = Math.max(0, Number(cfg.tolerancia) || 0);
  if (pagamento.valor >= valorEsperado || Math.abs(pagamento.valor - valorEsperado) < 0.005 ||
      (tolerancia > 0 && valorEsperado - pagamento.valor <= tolerancia + 0.005)) {
    await confirmarPagamento(mensagem, pagamento, valorEsperado, userId);
    return;
  }
  if (pagamento.valor > 0 && pagamento.valor < valorEsperado) {
    await pagamentoParcial(mensagem, pagamento, valorEsperado, userId);
    return;
  }
  await enviarResultado(mensagem, '❌', cfg.modoSilencioso === true);
}
const MSG_COMPROVANTE_INCERTO = '# `🟡` encontrei o comprovante mas não tenho certeza do nome e valor, envie o comprovante novamente mais nítido ou mande `pg` nome e sobrenome';
const avisosComprovante = new Map();
async function avisarComprovanteIncerto(mensagem, userId) {
  if (modoSilencioso(userId)) return;
  const k = `${userId}|${mensagem.id}`;
  if (avisosComprovante.has(k)) return;
  avisosComprovante.set(k, Date.now());
  if (avisosComprovante.size > 200) avisosComprovante.delete(avisosComprovante.keys().next().value);
  try { await enviarCanal(mensagem.channel, MSG_COMPROVANTE_INCERTO); }
  catch (e) { aviso(`Aviso comprovante: ${e.message}`); }
}
let jsQRLib = null;
try { jsQRLib = require('jsqr'); } catch {}
async function imagemEhQrCode(buffer) {
  if (!jsQRLib || !CanvasLib) return false;
  try {
    const img = await CanvasLib.loadImage(buffer);
    const esc = Math.min(1, 600 / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * esc));
    const h = Math.max(1, Math.round(img.height * esc));
    const cv = CanvasLib.createCanvas(w, h);
    const g = cv.getContext('2d');
    g.drawImage(img, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h);
    return !!jsQRLib(d.data, w, h);
  } catch { return false; }
}
async function processarImagem(mensagem, anexo, userId) {
  const idImg = String(anexo.id || anexo.url || '');
  if (!idImg) return;
  const chave = `${userId}|${idImg}`;
  if (verificacoesAtivas.has(chave)) return;
  verificacoesAtivas.add(chave);
  const nomeArq = anexo.name || 'imagem';
  try {
    // Se a mesma mensagem já tem "pg nome", o fluxo do texto cuida da verificação.
    if (extrairDadosPg(mensagem.content || '')) return;
    const url = anexo.url;
    if (!url) {
      blocoComprovante({ arquivo: nomeArq, status: 'FALHOU', motivo: 'Sem URL.' });
      return;
    }
    const buffer = await baixarImagem(url);
    if (!buffer || !buffer.length) {
      blocoComprovante({ arquivo: nomeArq, status: 'FALHOU', motivo: 'Não baixou.' });
      return;
    }
    if (await imagemEhQrCode(buffer)) {
      blocoComprovante({ arquivo: nomeArq, status: 'QR CODE IGNORADO' });
      return;
    }
    const textoOCR = await extrairTextoImagem(buffer);
    if (!textoOCR) {
      blocoComprovante({ arquivo: nomeArq, status: 'SEM TEXTO' });
      return;
    }
    if (!identificarComprovante(textoOCR)) {
      blocoComprovante({ arquivo: nomeArq, status: 'NÃO IDENTIFICADO' });
      return;
    }
    const chavePixCfg = String(obterConfigUsuario(userId).chavePix || '').trim();
    let nome = extrairNomeDoComprovante(textoOCR);
    if (nome && (!nomeEhPessoa(nome) || !nomeValidoParaBusca(nome) ||
        (chavePixCfg && textoContemChavePix(nome, chavePixCfg)))) nome = null;
    const valorImg = extrairValorPagamento(textoOCR);
    // Só prossegue se tiver CERTEZA do nome E do valor.
    if (!nome || !(Number(valorImg) > 0)) {
      blocoComprovante({
        arquivo: nomeArq, status: 'COMPROVANTE DETECTADO', nome: nome || undefined,
        motivo: `Sem certeza do ${!nome ? 'nome' : ''}${!nome && !(Number(valorImg) > 0) ? ' e do ' : ''}${!(Number(valorImg) > 0) ? 'valor' : ''} — pedindo novo envio.`
      });
      await avisarComprovanteIncerto(mensagem, userId);
      return;
    }
    blocoComprovante({
      arquivo: nomeArq, status: 'COMPROVANTE + NOME E VALOR OK', nome,
      motivo: `Valor lido: ${formatarValor(valorImg)} — conferindo no e-mail (nome e valor precisam bater).`
    });
    const chaveMsg = `${userId}|${mensagem.id}`;
    if (verificacoesAtivas.has(chaveMsg)) return;
    verificacoesAtivas.add(chaveMsg);
    try { await processarPg(mensagem, { nome, tipo: 'pagamento' }, userId); }
    finally { verificacoesAtivas.delete(chaveMsg); }
  } catch (e) {
    blocoComprovante({ arquivo: nomeArq, status: 'ERRO', motivo: e.message || 'Erro.' });
  } finally {
    verificacoesAtivas.delete(chave);
  }
}
async function processarImagensDaMensagem(mensagem, userId) {
  if (!mensagem || !mensagem.attachments) return;
  if (mensagem.author && mensagem.author.bot) return;
  const anexos = Array.from(mensagem.attachments.values());
  if (!anexos.length) return;
  const imagens = anexos.filter(a => {
    const ct = String(a.contentType || '').toLowerCase();
    const nm = String(a.name || '').toLowerCase();
    if (/qr/i.test(nm)) return false;
    return ct.startsWith('image/') || /\.(jpg|jpeg|png|webp|gif|bmp|tif|tiff)$/i.test(nm);
  });
  if (!imagens.length) return;
  await Promise.all(imagens.map(img => processarImagem(mensagem, img, userId)));
}
// ============================================================
//  BOT DO PAINEL (/central, /keys) + SELFBOTS DINÂMICOS
// ============================================================
// ============================================================
// CUPONS e CÓDIGOS PROMOCIONAIS (/criar-cupom, /codigo-promocional, botão CUPOM do carrinho)
// ============================================================
const CUP_ARQ = path.join(__dirname, 'cupons.json');
function cupCarregar() {
  try { const j = JSON.parse(fs.readFileSync(CUP_ARQ, 'utf8')); return Array.isArray(j) ? j : []; } catch { return []; }
}
function cupSalvar(lista) {
  fs.writeFileSync(CUP_ARQ + '.tmp', JSON.stringify(lista, null, 2));
  fs.renameSync(CUP_ARQ + '.tmp', CUP_ARQ);
}
function cupNorm(t) { return String(t || '').trim().toUpperCase().replace(/\s+/g, ''); }
function cupBuscar(nome) {
  const n = cupNorm(nome);
  return n ? (cupCarregar().find(c => c.nome === n) || null) : null;
}
function cupTelaPrincipal(tipo) {
  const ehCod = tipo === 'codigo';
  const n = cupCarregar().filter(c => c.tipo === tipo).length;
  const botoes = [
    btn(`cup_criar:${tipo}`, 'Criar', ButtonStyle.Success, '<:presente:1542526384172441651>'),
    btn(`cup_excluir:${tipo}`, 'Excluir', ButtonStyle.Danger, '<a:cancel:1553640762946756648>'),
    btn(`cup_enviar:${tipo}`, 'Enviar', ButtonStyle.Primary, '<:aviso_Storm:1553640765857603658>')
  ];
  if (ehCod) botoes.push(btn('cup_org:codigo', 'ORG DO CODIGO', ButtonStyle.Secondary, '<:dvida:1542524473796861952>'));
  return painel({
    cor: COR.principal,
    texto: `# ${ehCod ? '🏷️ Códigos promocionais' : '🎟️ Cupons'}\n\n${ehCod ? 'Códigos' : 'Cupons'} criados: **${n}**\nEscolha uma opção abaixo.`,
    linhas: [linhaBotoes(...botoes)]
  });
}
function cupTelaLista(idMenu, titulo, tipo) {
  const lista = cupCarregar().filter(c => c.tipo === tipo);
  if (!lista.length) return painel({ cor: COR.erro, texto: `❌ Nenhum ${tipo === 'codigo' ? 'código promocional' : 'cupom'} criado ainda. Use **Criar** primeiro.`, linhas: [] });
  return painel({
    cor: COR.principal,
    texto: titulo,
    linhas: [menu(idMenu, 'Escolha uma opção...', lista.slice(0, 25).map(c => ({
      label: String(c.nome).slice(0, 100),
      value: c.nome,
      description: `${c.percentual}% de desconto${tipo === 'codigo' ? ` • ORG ${c.org || 'não definida'}` : ''}`.slice(0, 100)
    })))]
  });
}
function cupEmbedAnuncio(c) {
  const ehCod = c.tipo === 'codigo';
  return new EmbedBuilder()
    .setColor(COR.principal)
    .setTitle(`${ehCod ? '🏷️ Código promocional' : '🎟️ Cupom'}: ${c.nome}`)
    .setDescription(`Use **${c.nome}** no botão **CUPOM** do seu carrinho e ganhe **${c.percentual}% de desconto**!`);
}
// Key vinculada a um servidor (código promocional com ORG): automed e autopay só funcionam nele.
function orgBloqueada(userId, guildId) {
  if (!guildId) return false;   // DM não é servidor: .testargmail, .perfil etc. continuam funcionando
  const vinc = servidorVinculadoDoUsuario(userId);
  return !!(vinc && String(guildId) !== vinc);
}

// ============================================================
// AUTO-MENSAGEM (/auto-mensagem) — somente o dono
// ============================================================
const AM_ARQ = path.join(__dirname, 'auto-mensagens.json');
let amRodando = false;
function amCarregar() {
  try { const j = JSON.parse(fs.readFileSync(AM_ARQ, 'utf8')); return Array.isArray(j) ? j : []; } catch { return []; }
}
function amSalvar(lista) {
  fs.writeFileSync(AM_ARQ + '.tmp', JSON.stringify(lista, null, 2));
  fs.renameSync(AM_ARQ + '.tmp', AM_ARQ);
}
function amEmbed(it) {
  const e = new EmbedBuilder().setColor(COR.principal).setTitle(String(it.titulo).slice(0, 256)).setDescription(String(it.descricao).slice(0, 4000));
  if (it.thumb) e.setThumbnail(it.thumb);
  return e;
}
async function amApagar(it) {
  if (it.canalId && it.msgId) {
    const canal = await botClient.channels.fetch(it.canalId).catch(() => null);
    if (canal && canal.messages) await canal.messages.delete(it.msgId).catch(logErro);
  }
  it.msgId = '';
}
// Atualiza SÓ este item no arquivo (relê a lista na hora de salvar: não sobrescreve criar/excluir feitos no meio tempo).
function amAtualizarItem(id, patch) {
  const lista = amCarregar();
  const it = lista.find(x => x.id === id);
  if (!it) return;
  Object.assign(it, patch);
  amSalvar(lista);
}
// Marcações: troca "@Nome do Cargo" por <@&id> (o modal do Discord não converte sozinho) e junta TODAS as menções
// (cargo, usuário, @everyone, @here) numa linha de "content" — menção dentro de embed NUNCA notifica, só fica visual.
async function amPrepararMencoes(canal, texto) {
  let t = String(texto || '');
  try {
    const guild = canal && canal.guild;
    if (guild) {
      if (!guild.roles.cache.size) await guild.roles.fetch().catch(() => null);
      const roles = [...guild.roles.cache.values()].filter(r => r.id !== guild.id && r.name)
        .sort((a, b) => b.name.length - a.name.length);
      for (const r of roles) {
        const nome = r.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        t = t.replace(new RegExp(`(^|[^<\\w])@${nome}(?![\\w])`, 'gi'), (_, p) => `${p}<@&${r.id}>`);
      }
    }
  } catch (e) { aviso(`[AutoMensagem] Resolver cargos: ${e.message}`); }
  const achadas = [...new Set(t.match(/<@&\d+>|<@!?\d+>|@everyone|@here/g) || [])];
  return { texto: t, mencoes: achadas };
}
async function amDisparar(id, novoCanalId, agendado = false) {
  const it = amCarregar().find(x => x.id === id);
  if (!it) return false;
  // Horário do PRÓXIMO envio fixado ANTES de apagar/enviar e ancorado no horário agendado (sem acumular atraso).
  const agora = Date.now();
  const passo = it.minutos * 60000;
  let proximo = (agendado && it.proximo) ? it.proximo + passo : agora + passo;
  if (proximo <= agora) proximo = agora + passo;
  await amApagar(it);
  const canalId = novoCanalId || it.canalId;
  const canal = canalId ? await botClient.channels.fetch(canalId).catch(() => null) : null;
  let m = null;
  if (canal && typeof canal.send === 'function') {
    try {
      const { texto: descricao, mencoes } = await amPrepararMencoes(canal, it.descricao);
      const { texto: titulo } = await amPrepararMencoes(canal, it.titulo);
      const todas = [...new Set([...mencoes, ...(titulo.match(/<@&\d+>|<@!?\d+>|@everyone|@here/g) || [])])];
      const linhaPing = todas.join(' ');
      const permitidas = {
        parse: [],
        roles: todas.filter(x => x.startsWith('<@&')).map(x => x.slice(3, -1)),
        users: todas.filter(x => /^<@!?\d+>$/.test(x)).map(x => x.replace(/\D/g, ''))
      };
      if (todas.includes('@everyone') || todas.includes('@here')) permitidas.parse.push('everyone');
      if (it.embed === false) {
        let txt = `**${titulo}**\n${descricao}`.slice(0, 2000);
        if (it.thumb && txt.length + it.thumb.length + 1 <= 2000) txt += `\n${it.thumb}`;
        m = await canal.send({ content: txt, allowedMentions: permitidas });
      } else {
        m = await canal.send({
          content: linhaPing ? linhaPing.slice(0, 2000) : undefined,
          embeds: [amEmbed({ ...it, titulo, descricao })],
          allowedMentions: permitidas
        });
      }
    } catch (e) { aviso(`[AutoMensagem] Falha ao enviar "${it.titulo}": ${e.message}`); }
  }
  amAtualizarItem(id, { canalId: canalId || it.canalId, msgId: m ? m.id : '', proximo });
  return !!m;
}
async function amTick() {
  if (amRodando || !botClient || !botClient.isReady()) return;
  amRodando = true;
  try {
    const agora = Date.now();
    for (const it of amCarregar()) {
      if (it.canalId && it.proximo && agora >= it.proximo) await amDisparar(it.id, null, true).catch(e => aviso(`[AutoMensagem] ${e.message}`));
    }
  } finally { amRodando = false; }
}
function iniciarAutoMensagens() {
  // Confere a cada 1s (antes 15s: o envio atrasava até 15s a cada ciclo e o atraso acumulava).
  setInterval(() => {
    amTick().catch(e => {
      erro(`[AutoMensagem] Falha inesperada no ciclo: ${e.message}`);
    });
  }, 1000);
}
function amTelaPrincipal() {
  const n = amCarregar().length;
  return painel({
    cor: COR.principal,
    texto: `# 🔁 Auto-mensagens\n\nCriadas: **${n}**\nEscolha uma opção abaixo.`,
    linhas: [linhaBotoes(
      btn('am_criar', 'Criar', ButtonStyle.Success, '<:presente:1542526384172441651>'),
      btn('am_excluir', 'Excluir', ButtonStyle.Danger, '<a:cancel:1553640762946756648>'),
      btn('am_enviar', 'Enviar', ButtonStyle.Primary, '<:aviso_Storm:1553640765857603658>')
    )]
  });
}
function amTelaLista(idMenu, titulo) {
  const lista = amCarregar();
  if (!lista.length) return painel({ cor: COR.erro, texto: '❌ Nenhuma auto-mensagem criada ainda. Use **Criar** primeiro.', linhas: [] });
  return painel({
    cor: COR.principal,
    texto: titulo,
    linhas: [menu(idMenu, 'Escolha uma auto-mensagem...', lista.slice(0, 25).map(x => ({
      label: String(x.titulo).slice(0, 100), value: x.id, description: `${x.embed === false ? 'Normal' : 'Embed'} • A cada ${x.minutos} min${x.canalId ? ' • ativa' : ' • não enviada'}`
    })))]
  });
}
// ============================================================
// EVENTOS CENTRAIS (Estatísticas / Histórico / Ranking) + ALERTAS POR DM (bot oficial)
// Um único arquivo (eventos.json) alimenta as três telas. Nenhuma consulta nova é feita.
// ============================================================
const EVENTOS_PATH = path.join(__dirname, 'eventos.json');
const EVT_MAX = 50000;
const EVT_PERIODOS = [
  { v: 'hoje', label: 'Hoje' },
  { v: '7', label: '7 dias' },
  { v: '15', label: '15 dias' },
  { v: '30', label: '30 dias' },
  { v: 'all', label: 'Todo período' }
];
const EVT_BANCOS = [
  { nome: 'Nubank', dominios: ['nubank.com.br', 'nu.com.br'], rx: /\bnubank\b|\bnu pagamentos\b/ },
  { nome: 'Inter', dominios: ['inter.co', 'bancointer.com.br'], rx: /\bbanco inter\b|\binter\b/ },
  { nome: 'Itaú', dominios: ['itau.com.br', 'itau-unibanco.com.br'], rx: /\bitau\b/ },
  { nome: 'Bradesco', dominios: ['bradesco.com.br', 'bradesco.com'], rx: /\bbradesco\b/ },
  { nome: 'Santander', dominios: ['santander.com.br'], rx: /\bsantander\b/ },
  { nome: 'Caixa', dominios: ['caixa.gov.br'], rx: /\bcaixa economica federal\b|\bcaixa economica\b/ },
  { nome: 'Banco do Brasil', dominios: ['bb.com.br'], rx: /\bbanco do brasil\b/ },
  { nome: 'C6 Bank', dominios: ['c6bank.com.br'], rx: /\bc6 bank\b|\bc6bank\b/ },
  { nome: 'PagBank', dominios: ['pagseguro.com.br', 'pagbank.com.br', 'pagseguro.uol.com.br'], rx: /\bpagbank\b|\bpagseguro\b/ },
  { nome: 'PicPay', dominios: ['picpay.com'], rx: /\bpicpay\b/ },
  { nome: 'Mercado Pago', dominios: ['mercadopago.com', 'mercadopago.com.br'], rx: /\bmercado pago\b|\bmercadopago\b/ },
  { nome: 'Sicredi', dominios: ['sicredi.com.br'], rx: /\bsicredi\b/ },
  { nome: 'Sicoob', dominios: ['sicoob.com.br'], rx: /\bsicoob\b/ },
  { nome: 'Safra', dominios: ['safra.com.br'], rx: /\bbanco safra\b/ },
  { nome: 'Original', dominios: ['original.com.br'], rx: /\bbanco original\b/ },
  { nome: 'Neon', dominios: ['neon.com.br'], rx: /\bbanco neon\b/ },
  { nome: 'Next', dominios: ['next.me'], rx: /\bbanco next\b/ },
  { nome: 'BTG Pactual', dominios: ['btgpactual.com'], rx: /\bbtg pactual\b/ },
  { nome: 'BMG', dominios: ['bancobmg.com.br'], rx: /\bbanco bmg\b/ },
  { nome: 'Pan', dominios: ['bancopan.com.br'], rx: /\bbanco pan\b/ },
  { nome: 'Will Bank', dominios: ['willbank.com.br'], rx: /\bwill bank\b/ },
  { nome: 'Stone', dominios: ['stone.com.br'], rx: /\bstone pagamentos\b/ },
  { nome: 'InfinitePay', dominios: ['infinitepay.io'], rx: /\binfinitepay\b/ },
  { nome: 'Asaas', dominios: ['asaas.com'], rx: /\basaas\b/ },
  { nome: 'Efí', dominios: ['sejaefi.com.br', 'gerencianet.com.br'], rx: /\bgerencianet\b|\befi bank\b/ },
  { nome: 'Digio', dominios: ['digio.com.br'], rx: /\bdigio\b/ },
  { nome: 'Banrisul', dominios: ['banrisul.com.br'], rx: /\bbanrisul\b/ }
];
let evtCache = null;
const evtChaves = new Set();
let evtTimerSalvar = null;
function evtDb() {
  if (evtCache) return evtCache;
  let d = null;
  try {
    if (fs.existsSync(EVENTOS_PATH)) d = JSON.parse(fs.readFileSync(EVENTOS_PATH, 'utf8'));
  } catch (e) {
    try { fs.copyFileSync(EVENTOS_PATH, `${EVENTOS_PATH}.corrompido-${Date.now()}`); } catch {}
    aviso(`eventos.json ilegível (cópia salva): ${e.message}`);
  }
  if (!d || typeof d !== 'object') d = {};
  if (!Array.isArray(d.eventos)) d.eventos = [];
  if (!d.nomes || typeof d.nomes !== 'object') d.nomes = {};
  if (!d.alertas || typeof d.alertas !== 'object') d.alertas = {};
  evtCache = d;
  for (const e of d.eventos) if (e && e.k) evtChaves.add(e.k);
  return evtCache;
}
function evtSalvarAgora() {
  try {
    if (!evtCache) return;
    const tmp = `${EVENTOS_PATH}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(evtCache), { mode: 0o600 });
    fs.renameSync(tmp, EVENTOS_PATH);
  } catch (e) { aviso(`Não consegui salvar eventos.json: ${e.message}`); }
}
function evtSalvar() {
  if (evtTimerSalvar) return;
  evtTimerSalvar = setTimeout(() => { evtTimerSalvar = null; evtSalvarAgora(); }, 1500);
}
process.on('exit', () => { if (evtTimerSalvar) evtSalvarAgora(); });
function evtLimpar(t, max = 60) {
  return String(t || '').replace(/[*_`~|>\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}
function evtBancoCanon(b) {
  const s = String(b || '').trim();
  if (!s) return '';
  const n = normalizarNome(s);
  for (const x of EVT_BANCOS) if (x.rx.test(n)) return x.nome;
  return s.toLowerCase().replace(/\b\p{L}/gu, c => c.toUpperCase()).slice(0, 40);
}
// Banco: 1) domínio do remetente; 2) assunto + prévia; 3) corpo, só se UM único banco aparecer.
function evtDetectarBanco(remetente, assunto, snippet, textoNorm) {
  try {
    const m = String(remetente || '').toLowerCase().match(/@([a-z0-9.\-]+)/);
    const dom = m ? m[1] : '';
    if (dom) {
      for (const b of EVT_BANCOS) {
        if (b.dominios.some(d => dom === d || dom.endsWith('.' + d))) return b.nome;
      }
    }
    const cab = normalizarNome(`${assunto || ''} ${snippet || ''}`);
    const noCab = EVT_BANCOS.filter(b => b.rx.test(cab));
    if (noCab.length === 1) return noCab[0].nome;
    if (noCab.length > 1) return '';
    const corpo = String(textoNorm || '').slice(0, 3000);
    const noCorpo = EVT_BANCOS.filter(b => b.rx.test(corpo));
    return noCorpo.length === 1 ? noCorpo[0].nome : '';
  } catch { return ''; }
}
// Registra UM evento. Nunca lança erro para o fluxo de pagamento. Duplicado (mesma chave) é ignorado.
// Campos: chave, tipo (confirmado|parcial|nao_encontrado|sala), resp, nome, valor, banco, via.
// ---------------- LOG DE SALAS (fonte do .lucro) ----------------
// Arquivo à parte, só de acréscimo (1 linha por sala), gravado NA HORA com fsync. Sem o limite de 50 mil eventos
// do eventos.json e sem atraso de gravação: nenhuma sala criada some do relatório, nem em reinício ou queda.
const SALAS_LOG_PATH = path.join(__dirname, 'salas_log.jsonl');
const salasLog = [];
const salasLogChaves = new Set();
let salasLogPronto = false;
function salasLogGravarLinha(r) {
  const fd = fs.openSync(SALAS_LOG_PATH, 'a', 0o600);
  try {
    fs.writeSync(fd, JSON.stringify(r) + '\n');
    try { fs.fsyncSync(fd); } catch {}
  } finally { fs.closeSync(fd); }
}
function salasLogIniciar() {
  if (salasLogPronto) return;
  salasLogPronto = true;
  try {
    if (fs.existsSync(SALAS_LOG_PATH)) {
      for (const ln of fs.readFileSync(SALAS_LOG_PATH, 'utf8').split('\n')) {
        if (!ln.trim()) continue;
        try {
          const r = JSON.parse(ln);
          if (r && r.k && !salasLogChaves.has(r.k)) { salasLog.push(r); salasLogChaves.add(r.k); }
        } catch {}
      }
    }
  } catch (e) { aviso(`salas_log.jsonl ilegível: ${e.message}`); }
  // Copia para o log o histórico de salas que já estava no eventos.json (o que já está no log é ignorado).
  let migradas = 0;
  try {
    for (const e of evtDb().eventos) {
      if (!e || e.t !== 'sala' || !e.k || salasLogChaves.has(e.k)) continue;
      const v = (e.valor === null || e.valor === undefined) ? null : Number(e.valor);
      const r = { k: e.k, ts: e.ts, resp: String(e.resp), valor: Number.isFinite(v) ? v : null };
      salasLogGravarLinha(r);
      salasLog.push(r);
      salasLogChaves.add(r.k);
      migradas++;
    }
  } catch (e) { aviso(`Migração do log de salas: ${e.message}`); }
  if (migradas) info(`📒 Log de salas: ${migradas} sala(s) antigas copiadas do eventos.json.`);
}
function salasLogRegistrar(chave, resp, valor) {
  try {
    salasLogIniciar();
    const k = String(chave).slice(0, 120);
    if (salasLogChaves.has(k)) return false;
    const r = { k, ts: Date.now(), resp: String(resp), valor: Number.isFinite(valor) ? Number(valor.toFixed(2)) : null };
    salasLogGravarLinha(r);
    salasLog.push(r);
    salasLogChaves.add(k);
    return true;
  } catch (e) { erro(`Sala NÃO gravada no log (${chave}): ${e.message}`); return false; }
}
function salasLogListar(resp) {
  salasLogIniciar();
  return salasLog.filter(r => r.resp === String(resp));
}
function evtRegistrar(e) {
  try {
    if (!e || !e.chave || !e.tipo || !e.resp) return false;
    if (e.tipo === 'sala') {
      const vS = (e.valor === undefined || e.valor === null) ? (Number(obterConfigUsuario(String(e.resp)).ganhoFila) || 0) : Number(e.valor);
      salasLogRegistrar(String(e.chave), e.resp, vS);   // grava na hora, antes de qualquer outra coisa
    }
    const db = evtDb();
    const k = String(e.chave).slice(0, 120);
    if (evtChaves.has(k)) return false;
    const resp = String(e.resp);
    const v = (e.tipo === 'sala' && (e.valor === undefined || e.valor === null))
      ? (Number(obterConfigUsuario(String(e.resp)).ganhoFila) || 0)
      : Number(e.valor);
    db.eventos.push({
      id: crypto.randomBytes(6).toString('hex'),
      k,
      t: String(e.tipo),
      ts: Date.now(),
      resp,
      nome: evtLimpar(e.nome, 80),
      valor: Number.isFinite(v) ? Number(v.toFixed(2)) : null,
      banco: evtBancoCanon(e.banco),
      via: e.via === 'autopay' ? 'autopay' : 'gmail'
    });
    evtChaves.add(k);
    if (db.eventos.length > EVT_MAX) {
      db.eventos.splice(0, db.eventos.length - EVT_MAX);
      evtChaves.clear();
      for (const x of db.eventos) if (x && x.k) evtChaves.add(x.k);
    }
    const nomeResp = evtLimpar(nomeDaConta(resp) || (botClient && botClient.users.cache.get(resp) && botClient.users.cache.get(resp).username) || '', 40);
    if (nomeResp) db.nomes[resp] = nomeResp;
    evtSalvar();
    if (e.tipo === 'nao_encontrado') alertaFalha(resp, 'naoenc');
    else if (e.tipo === 'confirmado' || e.tipo === 'parcial') alertaOk(resp, 'naoenc');
    if (e.tipo === 'confirmado' || e.tipo === 'sala') rankingAgendar();
    return true;
  } catch (err) { aviso(`Evento não registrado: ${err.message}`); return false; }
}
function evtInicioPeriodo(p) {
  if (p === 'hoje') { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }
  const n = Number(p);
  if (Number.isFinite(n) && n > 0) return Date.now() - n * 86400000;
  return 0;
}
function evtRotuloPeriodo(p) {
  const x = EVT_PERIODOS.find(i => i.v === p);
  return x ? x.label : 'Todo período';
}
function evtListar(periodo, filtro) {
  const ini = evtInicioPeriodo(periodo);
  return evtDb().eventos.filter(e => e && e.ts >= ini && (!filtro || filtro(e)));
}
function evtOpcoesPeriodo(atual) {
  return EVT_PERIODOS.map(p => ({ label: p.label, value: p.v, default: p.v === atual }));
}
function evtDataHora(ts) {
  return new Date(ts).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
// ---------------- ESTATÍSTICAS ----------------
const estPeriodoUsuario = new Map();
function telaEstatisticas(userId, aviso_) {
  const periodo = estPeriodoUsuario.get(String(userId)) || '7';
  const meus = evtListar(periodo, e => e.resp === String(userId));
  const conf = meus.filter(e => e.t === 'confirmado');
  const parc = meus.filter(e => e.t === 'parcial');
  const nao = meus.filter(e => e.t === 'nao_encontrado');
  const salas = meus.filter(e => e.t === 'sala').length;
  const totalValor = conf.reduce((s, e) => s + (Number(e.valor) || 0), 0);
  const gm = meus.filter(e => e.via !== 'autopay' && e.t !== 'sala');
  const gmEnc = gm.filter(e => e.t === 'confirmado' || e.t === 'parcial').length;
  let dias = 1;
  if (periodo === 'all') {
    const primeiro = meus.reduce((m, e) => Math.min(m, e.ts), Date.now());
    dias = Math.max(1, Math.ceil((Date.now() - primeiro) / 86400000));
  } else if (periodo !== 'hoje') dias = Number(periodo) || 1;
  const media = (conf.length / dias).toFixed(1).replace('.', ',');
  const perc = gm.length ? `${((gmEnc / gm.length) * 100).toFixed(1).replace('.', ',')}%` : '—';
  return painel({
    cor: COR.principal,
    texto: [
      '# Estatísticas',
      RODAPE,
      '',
      `**Período:** ${evtRotuloPeriodo(periodo)}`,
      '',
      `**Pagamentos confirmados:** ${conf.length}`,
      `**Valor total confirmado:** ${formatarValor(totalValor)}`,
      `**Pagamentos parciais:** ${parc.length}`,
      `**Pagamentos não encontrados:** ${nao.length}`,
      `**Verificações processadas (Gmail):** ${gm.length}`,
      `**Salas criadas:** ${salas}`,
      `**Média de confirmados por dia:** ${media}`,
      `**Percentual de pagamentos encontrados:** ${perc}`,
      '',
      '-# Percentual = (confirmados + parciais) ÷ verificações por Gmail. Pix do Auto Pay entram em confirmados e valor.'
    ].join('\n') + linhaAviso(aviso_),
    linhas: [
      menu('est_per', 'Selecione o período...', evtOpcoesPeriodo(periodo)),
      linhaBotoes(botaoVoltar('p_voltar'))
    ]
  });
}
// ---------------- HISTÓRICO ----------------
const HIST_POR_PAG = 6;
const histEstados = new Map();
const HIST_STATUS = { confirmado: 'Confirmado', parcial: 'Parcial', nao_encontrado: 'Não encontrado' };
function histEstado(userId) {
  const id = String(userId);
  let s = histEstados.get(id);
  if (!s) { s = { periodo: '7', busca: '', pag: 0 }; histEstados.set(id, s); }
  return s;
}
function telaHistorico(userId, aviso_) {
  const st = histEstado(userId);
  const termo = normalizarNome(st.busca);
  const lista = evtListar(st.periodo, e => e.resp === String(userId) && HIST_STATUS[e.t] && (!termo || normalizarNome(e.nome).includes(termo)))
    .sort((a, b) => b.ts - a.ts);
  const paginas = Math.max(1, Math.ceil(lista.length / HIST_POR_PAG));
  st.pag = Math.min(Math.max(0, st.pag), paginas - 1);
  const itens = lista.slice(st.pag * HIST_POR_PAG, (st.pag + 1) * HIST_POR_PAG);
  const corpo = itens.length
    ? itens.map(e => `**${evtLimpar(e.nome, 50) || 'Sem nome'}** — ${e.valor === null ? '—' : formatarValor(e.valor)}\n-# ${HIST_STATUS[e.t]} • Banco: ${e.banco || 'Não identificado'} • ${evtDataHora(e.ts)}`).join('\n\n')
    : 'Nenhum registro encontrado.';
  const botoes = [
    btn('hs_prev', 'Anterior', ButtonStyle.Secondary, '◀️').setDisabled(st.pag <= 0),
    btn('hs_next', 'Próxima', ButtonStyle.Secondary, '▶️').setDisabled(st.pag >= paginas - 1),
    btn('hs_busca', st.busca ? `Busca: ${st.busca}`.slice(0, 80) : 'Pesquisar', ButtonStyle.Secondary, '🔎')
  ];
  if (st.busca) botoes.push(btn('hs_limpar', 'Limpar', ButtonStyle.Secondary, '✖️'));
  botoes.push(botaoVoltar('p_voltar'));
  return painel({
    cor: COR.principal,
    texto: [
      '# Histórico de pagamentos',
      RODAPE,
      '',
      `**Período:** ${evtRotuloPeriodo(st.periodo)} • **Registros:** ${lista.length} • Página ${st.pag + 1}/${paginas}`,
      st.busca ? `**Busca:** ${evtLimpar(st.busca, 50)}` : '',
      '',
      corpo
    ].filter((x, i) => x !== '' || i > 3).join('\n').slice(0, 3800) + linhaAviso(aviso_),
    linhas: [
      menu('hs_per', 'Selecione o período...', evtOpcoesPeriodo(st.periodo)),
      linhaBotoes(...botoes)
    ]
  });
}
// ---------------- RANKING (/ranking, mensagem pública, só bot oficial) ----------------
const RANKING_DEBOUNCE_MS = 10000;
const RANKING_ESPACO_EDICAO_MS = 1500;
const RANKING_TTL_MS = 12 * 3600 * 1000;
const RANKING_MAX_ATIVOS = 25;
const rankingsAtivos = new Map();
let rankingTimer = null;
let rankingRodando = false;
function rkDados(periodo) {
  const por = new Map();
  for (const e of evtListar(periodo)) {
    if (!e.resp) continue;
    let r = por.get(e.resp);
    if (!r) { r = { id: e.resp, pag: 0, valor: 0, salas: 0 }; por.set(e.resp, r); }
    if (e.t === 'confirmado') { r.pag++; r.valor += Number(e.valor) || 0; }
    else if (e.t === 'sala') r.salas++;
  }
  return [...por.values()]
    .filter(r => r.pag || r.salas)
    .sort((a, b) => b.pag - a.pag || b.valor - a.valor || b.salas - a.salas)
    .slice(0, 10);
}
function rkConstruir(periodo) {
  const per = EVT_PERIODOS.find(p => p.v === periodo) || EVT_PERIODOS[1];
  const lista = rkDados(per.v);
  const corpo = lista.length
    ? lista.map((r, i) => `${i + 1}. ${evtLimpar(evtDb().nomes[r.id], 40) || 'Mediador'}\nPagamentos: ${r.pag}\nValor processado: ${formatarValor(r.valor)}\nSalas: ${r.salas}`).join('\n\n')
    : 'Nenhum dado registrado neste período.';
  const descricao = `Período exibido: ${per.label}\n\n${corpo}`.slice(0, 4000);
  const embed = new EmbedBuilder()
    .setColor(COR.principal)
    .setTitle('RANKING DE MEDIADORES')
    .setDescription(descricao)
    .setFooter({ text: `${NOME_MARCA} | Período: ${per.label}` });
  return {
    assin: descricao,
    payload: { embeds: [embed], components: [menu('rk_per', 'Selecione o período...', evtOpcoesPeriodo(per.v))] }
  };
}
function rkMontar(periodo) { return rkConstruir(periodo).payload; }
function rkRegistrar(msgId, canalId, periodo) {
  if (!msgId || !canalId) return;
  rankingsAtivos.set(String(msgId), { canalId: String(canalId), periodo, ts: Date.now(), ult: rkConstruir(periodo).assin });
  while (rankingsAtivos.size > RANKING_MAX_ATIVOS) rankingsAtivos.delete(rankingsAtivos.keys().next().value);
}
function rankingAgendar() {
  if (!rankingsAtivos.size || rankingTimer) return;
  rankingTimer = setTimeout(() => { rankingAtualizarTodos().catch(logErro); }, RANKING_DEBOUNCE_MS);
}
async function rankingAtualizarTodos() {
  rankingTimer = null;
  if (rankingRodando) { rankingAgendar(); return; }
  rankingRodando = true;
  try {
    for (const [msgId, r] of [...rankingsAtivos.entries()]) {
      if (Date.now() - r.ts > RANKING_TTL_MS) { rankingsAtivos.delete(msgId); continue; }
      const c = rkConstruir(r.periodo);
      if (c.assin === r.ult) continue;
      try {
        const canal = botClient.channels.cache.get(r.canalId) || await botClient.channels.fetch(r.canalId);
        await canal.messages.edit(msgId, c.payload);
        r.ult = c.assin;
      } catch (e) {
        rankingsAtivos.delete(msgId);
        aviso(`Ranking ${msgId} removido da atualização automática: ${String(e.message).slice(0, 100)}`);
      }
      await esperar(RANKING_ESPACO_EDICAO_MS);
    }
  } finally { rankingRodando = false; }
}
// ---------------- ALERTAS POR DM (somente bot oficial; sem retry infinito) ----------------
const ALERTAS_DEF = {
  gmail: { limite: 5, cooldownMs: 3 * 3600000,
    texto: '**PROBLEMA DETECTADO**\n\nForam encontradas várias falhas consecutivas ao consultar seu Gmail.\n\nAbra `/central` e verifique sua conexão.',
    ok: '**PROBLEMA RESOLVIDO**\n\nA consulta ao seu Gmail voltou ao normal.' },
  oauth: { limite: 1, cooldownMs: 6 * 3600000,
    texto: '**PROBLEMA DETECTADO**\n\nSua conexão com o Gmail está desconectada, inválida ou expirada.\n\nAbra `/central`, entre em **Gmail e pagamentos** e reconecte.',
    ok: '**PROBLEMA RESOLVIDO**\n\nSua conexão com o Gmail voltou ao normal.' },
  naoenc: { limite: 5, cooldownMs: 6 * 3600000,
    texto: '**PROBLEMA DETECTADO**\n\nVárias verificações seguidas não encontraram pagamento.\n\nConfira se os e-mails do banco estão chegando no Gmail conectado em `/central`.',
    ok: '**PROBLEMA RESOLVIDO**\n\nVoltei a encontrar pagamentos normalmente.' },
  autopay: { limite: 3, cooldownMs: 3 * 3600000,
    texto: '**PROBLEMA DETECTADO**\n\nO Auto Pay não conseguiu gerar cobranças várias vezes seguidas.\n\nAbra `/central` > **Auto Pay** e verifique. Se continuar, avise o administrador.',
    ok: '**PROBLEMA RESOLVIDO**\n\nO Auto Pay voltou a gerar cobranças normalmente.' },
  pausa: { limite: 1, cooldownMs: 3 * 3600000,
    texto: '**PROBLEMA DETECTADO**\n\nSua conta foi pausada por 2 horas por uma verificação de segurança do Discord.\n\nAcesse o Discord pelo navegador e confirme que foi você.' },
  token: { limite: 1, cooldownMs: 3 * 3600000,
    texto: '**PROBLEMA DETECTADO**\n\nO token da sua conta foi considerado inválido e removido. A automação foi desligada.\n\nAbra `/central` > **Discord** > **Token** e cadastre um novo.' },
  sessao: { limite: 1, cooldownMs: 3 * 3600000,
    texto: '**PROBLEMA DETECTADO**\n\nA sessão da sua conta foi invalidada e a automação foi parada.\n\nAbra `/central` > **Gerenciar sistema** para verificar.' }
};
const alertasEstado = new Map();
async function alertaEnviarDM(userId, texto) {
  try {
    if (!botClient) return false;
    const usr = await botClient.users.fetch(String(userId));
    await usr.send({ content: String(texto).slice(0, 1900), allowedMentions: { parse: [] } });
    return true;
  } catch (e) {
    aviso(`Alerta por DM não entregue a ${userId}: ${String(e.message).slice(0, 100)}`);
    return false;
  }
}
function alertaFalha(userId, chave) {
  try {
    const def = ALERTAS_DEF[chave];
    if (!def || !userId) return;
    const id = String(userId);
    const k = `${id}|${chave}`;
    const st = alertasEstado.get(k) || { falhas: 0, alertado: false };
    st.falhas++;
    alertasEstado.set(k, st);
    if (st.falhas < def.limite) return;
    const db = evtDb();
    if (Date.now() - (Number(db.alertas[k]) || 0) < def.cooldownMs) return;
    db.alertas[k] = Date.now();
    evtSalvar();
    st.alertado = true;
    alertaEnviarDM(id, def.texto).catch(logErro);
  } catch (e) { aviso(`Alerta: ${e.message}`); }
}
function alertaOk(userId, chave) {
  try {
    const def = ALERTAS_DEF[chave];
    const st = alertasEstado.get(`${String(userId)}|${chave}`);
    if (!def || !st) return;
    const estava = st.alertado;
    st.falhas = 0;
    st.alertado = false;
    if (estava && def.ok) alertaEnviarDM(String(userId), def.ok).catch(logErro);
  } catch (e) { aviso(`Alerta (normalização): ${e.message}`); }
}
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const USERS_PATH = path.join(__dirname, 'users.json');
const KEYS_PATH = path.join(__dirname, 'keys.json');
const DONO_ID = '1390599937485705337';
const DONO_ID_2 = '1561570716820967496';
const DONOS_IDS = new Set([DONO_ID, DONO_ID_2]);
const USUARIOS_LIBERADOS = new Set([DONO_ID, DONO_ID_2, '1561467102731182220']);
const ehLiberado = (id) => USUARIOS_LIBERADOS.has(String(id));
const ehMeuId = (id) => String(id) === '1561570716820967496'; // só este ID: comandos de app e .addsaldo/.remsaldo/.semanaladd/.semanalrem/.saldoall
// Quem está no servidor do convite abaixo recebe acesso de dono (enquanto continuar nele).
// Requisito: o bot precisa estar nesse servidor para conferir quem é membro.
const INVITE_LIBERADO = 'D8TRkpbPu2';
const DONOS_FIXOS = new Set(USUARIOS_LIBERADOS);
let guildLiberadaId = null;
let avisouBotForaGuildLiberada = false;
const liberadoChecadoEm = new Map();
async function resolverGuildLiberada() {
  return null;   // liberação por servidor DESATIVADA: apenas donos fixos têm acesso
}
async function atualizarLiberado(userId, forcar = false) {
  userId = String(userId);
  // ACESSO RESTRITO: apenas os donos fixos (DONO_ID/DONO_ID_2/1561467102731182220).
  // Ninguém é liberado por servidor/convite. Se um dia precisar liberar alguém, é só adicionar o ID em USUARIOS_LIBERADOS.
  if (DONOS_FIXOS.has(userId)) return;
  liberadoChecadoEm.set(userId, Date.now());
  if (USUARIOS_LIBERADOS.delete(userId)) {
    aviso(`🔒 ${userId} perdeu a liberação (acesso restrito apenas ao dono).`);
  }
}
// ---------------- Acesso exclusivo do responsável + servidor/hierarquia + canais individuais ----------------
const MEU_ID_ADMIN = '1561570716820967496';
// IDs antigos (servidor legado). Só valem se o servidor ainda tiver esses dois cargos E não tiver sido configurado com /iniciarservidor.

// Servidores configurados com /iniciarservidor: { [guildId]: { automedRoleId, adminRoleId, conviteCodigo, configuradoEm } }
const SERVIDORES_CONFIG_PATH = path.join(__dirname, 'servidores_configurados.json');
function carregarServidoresConfig() {
  try {
    const j = JSON.parse(fs.readFileSync(SERVIDORES_CONFIG_PATH, 'utf8'));
    return j && typeof j === 'object' && !Array.isArray(j) ? j : {};
  } catch { return {}; }
}
const servidoresConfig = carregarServidoresConfig();
function salvarServidoresConfig() {
  try {
    const tmp = SERVIDORES_CONFIG_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(servidoresConfig, null, 2));
    fs.renameSync(tmp, SERVIDORES_CONFIG_PATH);
  } catch (e) { aviso(`Salvar ${SERVIDORES_CONFIG_PATH}: ${e.message}`); }
}
// Config do servidor: o que o /iniciarservidor gravou; ou, se for um servidor antigo que já tem os dois cargos fixos, os IDs legados.
function configServidor(guild) {
  if (!guild) return null;
  const c = servidoresConfig[String(guild.id)];
  if (c && c.automedRoleId && c.adminRoleId) return c;
  if (guild.roles.cache.has(CARGO_ACESSO_ID) && guild.roles.cache.has(CARGO_SUPERIOR_ID)) {
    return { automedRoleId: CARGO_ACESSO_ID, adminRoleId: CARGO_SUPERIOR_ID, legado: true };
  }
  return null;
}
const NOME_MARCA = 'Zeroun Aplications';
const oauthPendentes = new Map();
const selfbots = new Map();
const tentativasLoginSelfbot = new Map();
function carregarUsuarios() {
  try {
    if (fs.existsSync(USERS_PATH)) {
      return JSON.parse(fs.readFileSync(USERS_PATH, 'utf8'));
    }
  } catch (e) { aviso(`users.json corrompido: ${e.message}`); }
  return {};
}
function salvarUsuarios(usuarios) {
  const tmp = USERS_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(usuarios, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, USERS_PATH);
}
function idDiscordDoToken(token) {
  try {
    const p1 = String(token).trim().split('.')[0];
    if (!p1) return null;
    const pad = p1 + '='.repeat((4 - (p1.length % 4)) % 4);
    const dec = Buffer.from(pad, 'base64').toString('utf8');
    if (/^\d{17,20}$/.test(dec)) return dec;
  } catch {}
  return null;
}

const UA_NAVEGADOR = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
// ============================================================
// HTTP NATURAL — delay variável entre requisições (600–1500ms),
// headers completos/naturais e 429 respeitando o Retry-After.
// ============================================================
const HTTP_ACCEPT_PADRAO = 'application/json, text/plain, */*';
const HTTP_ACCEPT_LANG = 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7';
const HTTP_DELAY_MIN_MS = 600;
const HTTP_DELAY_MAX_MS = 1500;
let httpUltimaReqMs = 0;
function httpUAAleatorio() {
  return UA_NAVEGADOR;
}
// Garante um intervalo aleatório (600–1500ms) desde a última requisição.
async function httpDelayVario() {
  const alvo = Math.round(HTTP_DELAY_MIN_MS + Math.random() * (HTTP_DELAY_MAX_MS - HTTP_DELAY_MIN_MS));
  const falta = alvo - (Date.now() - httpUltimaReqMs);
  if (falta > 0) await esperar(falta);
}
// Retry-After pode vir em segundos (número pequeno), em data HTTP ou em timestamp.
// Sempre devolve MILISSEGUNDOS, com piso de 1s e teto de 120s.
function httpMsRetryAfter(valor) {
  let n = Number(valor);
  if (!Number.isFinite(n) || n <= 0) return 2000 + Math.round(Math.random() * 1000);
  if (n > 1e12) return Math.min(Math.max(n - Date.now(), 1000), 120000); // timestamp em ms
  if (n > 1e9) n = Math.floor(n / 1000);                                  // timestamp em segundos
  return n > 1000 ? Math.min(Math.round(n), 120000) : Math.max(1000, Math.round(n * 1000));
}
// fetch com: delay variável global, headers naturais completos, retry automático em
// 429 (respeitando Retry-After do cabeçalho) e em falhas de rede (com backoff leve).
async function httpNatural(url, opcoes = {}, tentativas = 3) {
  let ultimo = null;
  for (let t = 1; t <= tentativas; t++) {
    await httpDelayVario();
    httpUltimaReqMs = Date.now();
    try {
      const r = await fetch(url, {
        ...opcoes,
        headers: {
          'User-Agent': httpUAAleatorio(),
          'Accept': HTTP_ACCEPT_PADRAO,
          'Accept-Language': HTTP_ACCEPT_LANG,
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache',
          ...(opcoes.headers || {})
        }
      });
      if (r.status === 429 && t < tentativas) {
        const ra = httpMsRetryAfter(r.headers.get('Retry-After'));
        aviso(`HTTP 429 — Retry-After ${(ra / 1000).toFixed(1)}s. Aguardando (tentativa ${t}/${tentativas - 1}).`);
        await esperar(ra + Math.round(Math.random() * 500));
        continue;
      }
      return r;
    } catch (e) {
      ultimo = e;
      if (t >= tentativas) throw e;
      await esperar(800 + Math.round(Math.random() * 1200));
    }
  }
  throw ultimo;
}
async function consultarDiscordMe(authorization, versao = 'v10') {
  await httpDelayVario();
  const r = await fetch(`https://discord.com/api/${versao}/users/@me`, {
    headers: { Authorization: authorization, 'User-Agent': UA_NAVEGADOR },
    signal: AbortSignal.timeout(15000)
  });
  let corpo = null;
  try { corpo = await r.json(); } catch {}
  const retryAfterMs = httpMsRetryAfter(r.headers && r.headers.get && r.headers.get('Retry-After'));
  return { status: r.status, corpo, retryAfterMs };
}
async function validarTokenDiscord(tokenBruto) {
  let token = String(tokenBruto || '').trim().replace(/^["'`]+|["'`]+$/g, '').trim();
  let prefixo = '';
  const mp = token.match(/^(bot|bearer)\s+(.+)$/i);
  if (mp) { prefixo = mp[1].toLowerCase(); token = mp[2].trim(); }
  if (!token || !/^[\w-]{10,}\.[\w-]{4,}(?:\.[\w-]{4,})?$/.test(token)) {
    return { ok: false, motivo: 'formato' };
  }
  const idToken = idDiscordDoToken(token);
  const tamanho = token.length;
  if (prefixo === 'bot') return { ok: false, motivo: 'bot', idToken, tamanho };
  if (prefixo === 'bearer') return { ok: false, motivo: 'bearer', idToken, tamanho };
  try {
    // 1 consulta REST (v10), com 1 retry se vier 429.
    let raw = await consultarDiscordMe(token, 'v10');
    if (raw.status === 429) {
      await esperar(Math.min(30000, raw.retryAfterMs || 2000));
      raw = await consultarDiscordMe(token, 'v10');
      if (raw.status === 429) return { ok: false, motivo: 'erro', detalhe: 'O Discord limitou as validações (429). Tente mais tarde.' };
    }
    if (raw.status === 200 && raw.corpo && raw.corpo.id) {
      const d = raw.corpo;
      return { ok: true, token, id: String(d.id), nome: String(d.global_name || d.username || '').trim() || String(d.id) };
    }
    if (raw.status === 401) return { ok: false, motivo: tamanho < 50 ? 'curto' : 'invalido', status: 401, idToken, tamanho };
    const msgDiscord = raw.corpo && raw.corpo.message ? ` — ${raw.corpo.message}` : '';
    if (raw.status === 403) {
      return { ok: false, motivo: 'bloqueado', status: 403, idToken, tamanho, detalhe: `Discord respondeu HTTP 403${msgDiscord}.` };
    }
    return { ok: false, motivo: 'erro', status: raw.status, detalhe: `Discord respondeu HTTP ${raw.status}${msgDiscord}.` };
  } catch (e) {
    return { ok: false, motivo: 'erro', detalhe: e.message || 'Falha de conexão.' };
  }
}
function mensagemErroToken(v) {
  switch (v.motivo) {
    case 'formato': return '❌ **Token inválido.** O texto não parece um token (blocos separados por ponto, sem espaços). Nada foi salvo.';
    case 'bot': return '❌ **Esse é um token de BOT.** O selfbot precisa do token da **conta de usuário**. Nada foi salvo.';
    case 'bearer': return '❌ **Esse é um token OAuth (Bearer).** O selfbot precisa do token de usuário. Nada foi salvo.';
    case 'curto': return `❌ **Token curto demais (${v.tamanho} caracteres).** Provavelmente foi copiado pela metade. Nada foi salvo.`;
    case 'invalido': return '❌ **O Discord recusou o token (401).** Ele expirou, foi revogado ou foi copiado errado. Pegue um novo pelo Discord Web (F12). Nada foi salvo.';
    case 'bloqueado': return `⚠️ **O Discord bloqueou a validação (403).** ${v.detalhe || ''} Abra a conta no navegador, resolva o que o Discord pedir e tente de novo.`;
    default: return `⚠️ Não consegui validar o token agora: ${v.detalhe || 'erro desconhecido'}`;
  }
}
function nomeDaConta(userId) {
  const u = carregarUsuarios()[userId];
  if (u && u.nomeConta) return u.nomeConta;
  const sb = selfbots.get(userId);
  const n = sb && sb.user && (sb.user.globalName || sb.user.username);
  return n || null;
}
const nomesServidores = new Map();
const nomesServidoresTentados = new Map();

function nomeBrutoGuild(g) {
  const id = String(g.id);
  const doBot = botClient && botClient.guilds.cache.get(id);
  return String(
    g.name || (g.properties && g.properties.name) ||
    (g.data && g.data.properties && g.data.properties.name) ||
    nomesServidores.get(id) || (doBot && doBot.name) || ''
  ).trim();
}
async function garantirNomesServidores(userId, limiteMs = 6000) {
  userId = String(userId);
  const sb = selfbots.get(userId);
  if (!sb || !sb.user || !sb.guilds || !sb.guilds.cache) return;
  const faltando = () => Array.from(sb.guilds.cache.values()).filter(g => !nomeBrutoGuild(g));
  if (!faltando().length) return;
  if (Date.now() - (nomesServidoresTentados.get(userId) || 0) < 120000) return;
  nomesServidoresTentados.set(userId, Date.now());
  const tarefa = (async () => {
    // 1) lista da API (/users/@me/guilds)
    try {
      const lista = await sb.api.users('@me').guilds.get({ query: { limit: 200 } });
      for (const x of (Array.isArray(lista) ? lista : [])) {
        if (x && x.id && x.name) nomesServidores.set(String(x.id), String(x.name));
      }
    } catch (e) { aviso(`[${userId}] Nomes (api do selfbot): ${String(e.message).slice(0, 120)}`); }
    // 2) fetch individual dos que ainda estão sem nome
    for (const g of faltando().slice(0, 25)) {
      try {
        const f = await sb.guilds.fetch(String(g.id));
        const n = f && (f.name || (f.properties && f.properties.name));
        if (n) nomesServidores.set(String(g.id), String(n));
      } catch {}
    }
    // 3) último recurso: 1 chamada /users/@me/guilds com o token da conta
    if (faltando().length) {
      try {
        const tk = (carregarUsuarios()[userId] || {}).token;
        if (tk) {
          const r = await fetch('https://discord.com/api/v10/users/@me/guilds?limit=200', {
            headers: { Authorization: tk, 'User-Agent': UA_NAVEGADOR },
            signal: AbortSignal.timeout(15000)
          });
          if (r.ok) {
            for (const x of await r.json()) if (x && x.id && x.name) nomesServidores.set(String(x.id), String(x.name));
          } else aviso(`[${userId}] Nomes (lista) HTTP ${r.status}`);
        }
      } catch (e) { aviso(`[${userId}] Nomes (lista): ${String(e.message).slice(0, 100)}`); }
    }
    const sem = faltando();
    if (sem.length) aviso(`[${userId}] ${sem.length} servidor(es) ainda sem nome. Campos do objeto: ${Object.keys(sem[0]).slice(0, 25).join(', ')}`);
    else sucesso(`[${userId}] Nomes dos servidores carregados.`);
  })();
  tarefa.catch(logErro);
  await Promise.race([tarefa, esperar(limiteMs)]);
}
function listarServidoresConta(userId) {
  const sb = selfbots.get(userId);
  if (!sb || !sb.user || !sb.guilds || !sb.guilds.cache) {
    // Conta antiban sem token: lê direto do bot oficial, sem depender da instância virtual estar online.
    const uL = carregarUsuarios()[userId];
    if (uL && !uL.token && abLivreCfg(uL) && botClient) {
      const vincL = servidorVinculadoDoUsuario(userId);
      return abLivreGuilds(userId)
        .filter(g => !vincL || String(g) === vincL)
        .map(g => botClient.guilds.cache.get(g))
        .filter(Boolean)
        .map(x => ({ id: String(x.id), nome: String(x.name || x.id) }))
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    }
    return [];
  }
  const vinc = servidorVinculadoDoUsuario(userId);   // key vinculada: só aparece/aceita o servidor da compra
  const base = Array.from(sb.guilds.cache.values())
    .filter(g => !vinc || String(g.id) === vinc)
    .map(g => ({
    id: String(g.id), nome: nomeBrutoGuild(g) || 'Servidor sem nome'
  }));
  const cont = new Map();
  for (const s of base) cont.set(s.nome, (cont.get(s.nome) || 0) + 1);
  return base
    .map(s => ({
      id: s.id,
      nome: cont.get(s.nome) > 1 || s.nome === 'Servidor sem nome'
        ? `${s.nome.slice(0, 80)} (${s.id})` : s.nome
    }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}
function nomeDoServidor(userId, guildId) {
  const g = listarServidoresConta(userId).find(s => s.id === String(guildId));
  return g ? g.nome : (nomesServidores.get(String(guildId)) || 'Servidor desconhecido');
}
// ============================================================
// OAUTH GMAIL AUTOMÁTICO
// ============================================================
function gerarUrlOAuthUsuario(userId, interacao) {
  const cred = carregarCredenciaisOAuth();
  const auth = new google.auth.OAuth2(cred.client_id, cred.client_secret, OAUTH_REDIRECT_URI);
  const state = `${userId}-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
  oauthPendentes.set(state, { userId, interacao: interacao || null, criadoEm: Date.now() });
  for (const [s, d] of oauthPendentes) {
    if (Date.now() - d.criadoEm > 10 * 60 * 1000) oauthPendentes.delete(s);
  }
  const url = auth.generateAuthUrl({
    access_type: 'offline', prompt: 'consent', scope: SCOPES,
    include_granted_scopes: true, state
  });
  info(`OAuth: redirect_uri enviado = ${OAUTH_REDIRECT_URI} | client_id = ${cred.client_id}`);
  return { url, state, auth };
}
async function concluirOAuthUsuario(userId, code) {
  const cred = carregarCredenciaisOAuth();
  const auth = new google.auth.OAuth2(cred.client_id, cred.client_secret, OAUTH_REDIRECT_URI);
  const resp = await auth.getToken(String(code).trim());
  auth.setCredentials(resp.tokens);
  if (!resp.tokens.refresh_token) {
    throw new Error('Google não retornou refresh_token. Tente novamente.');
  }
  if (!tokenPossuiEscopoExclusao(resp.tokens)) {
    throw new Error('Escopo https://mail.google.com/ não concedido.');
  }
  const gmailApi = google.gmail({ version: 'v1', auth });
  const perfil = await gmailApi.users.getProfile({ userId: 'me' });
  const email = perfil?.data?.emailAddress || '';
  const usuarios = carregarUsuarios();
  usuarios[userId] = {
    ...(usuarios[userId] || {}),
    gmailToken: resp.tokens, email, autorizadoEm: Date.now()
  };
  salvarUsuarios(usuarios);
  estadosGmail.delete(userId);
  sincronizacoesGmail.delete(userId);
  iniciarPollerGmail(userId);
  return email;
}
function escaparHtml(t) {
  return String(t || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function paginaOAuth(ok, titulo, texto) {
  const cor = ok ? '#57F287' : '#ED4245';
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escaparHtml(NOME_MARCA)}</title></head>` +
    `<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#1e1f22;font-family:system-ui,Segoe UI,Arial,sans-serif;color:#f2f3f5">` +
    `<div style="max-width:420px;margin:24px;padding:32px;border-radius:16px;background:#2b2d31;border-top:6px solid ${cor};text-align:center;box-shadow:0 8px 30px rgba(0,0,0,.4)">` +
    `<div style="font-size:54px">${ok ? '✅' : '❌'}</div><h2 style="margin:12px 0 8px">${escaparHtml(titulo)}</h2>` +
    `<p style="color:#b5bac1;line-height:1.5">${escaparHtml(texto)}</p>` +
    `<p style="margin-top:24px;font-size:12px;color:#80848e">${escaparHtml(NOME_MARCA)} · Mediação Automática</p></div></body></html>`;
}
let servidorOAuth = null;
// ---- Imagens por link: o bot NÃO envia o arquivo; manda só a URL e o Discord baixa/mostra sozinho (mais rápido). ----
const imagensHospedadas = new Map();   // token -> { buf, exp }
const IMG_TTL_MS = 10 * 60 * 1000;
function urlPublicaBase() {
  const v = String(process.env.PUBLIC_URL || '').trim().replace(/\/+$/, '');
  if (v) return v;
  try {
    const u = new URL(OAUTH_REDIRECT_URI);
    if (!/^(localhost|127\.|0\.0\.0\.0)/i.test(u.hostname)) return u.origin;
  } catch {}
  try { return SbRemoto.baseUrlPublica() || ''; } catch { return ''; }   // aprendido sozinho (sem precisar de PUBLIC_URL)
}
function hospedarImagem(buf, ttlMs = IMG_TTL_MS) {
  const base = urlPublicaBase();
  if (!base || !buf || !buf.length) return null;
  const agora = Date.now();
  for (const [k, v] of imagensHospedadas) if (v.exp < agora) imagensHospedadas.delete(k);
  if (imagensHospedadas.size > 200) imagensHospedadas.delete(imagensHospedadas.keys().next().value);
  const token = crypto.randomBytes(16).toString('hex');
  imagensHospedadas.set(token, { buf, exp: agora + ttlMs });
  return `${base}/img/${token}.png`;
}
// ===== App Android (ZEROUN AUTOMED): lê nome + valor da notificação e coloca no mesmo cache do Gmail =====
// O "pg nome" já existente passa a achar esses Pix e confirma no Discord (confirmarPagamento).
// Opt-in: só vale quando o usuário aperta "Ativar notificações app". Ativo = lê o app e, se houver Gmail conectado, o Gmail também.
function appNotifAtivo(userId) { return obterConfigUsuario(userId).appNotif === true; }
// Celular (app ZEROUN AUTOMED) vinculado a uma key ativa deste usuário.
function appVinculado(userId) {
  try {
    const id = String(userId);
    return Object.values(carregarKeys()).some(r => r && String(r.usadaPor) === id && r.appDevice && !keyExpirada(r));
  } catch { return false; }
}
// Nome quando o banco escreve o pagador ANTES do verbo: "FULANO DE TAL te enviou R$ 10", "FULANO te pagou",
// "FULANO enviou um Pix para você", "FULANO transferiu R$ 10 para você", "R$ 10,00 - FULANO DE TAL".
function nomeAntesDoVerboApp(t) {
  const c = limparTexto(t);
  if (!c) return null;
  const m = c.match(/^(.{3,90}?)\s+(?:te\s+)?(?:enviou|pagou|transferiu|mandou)\b/i);
  if (m) {
    const n = m[1]
      .replace(/^(?:pix\s+recebid[oa]|transfer[eê]ncia\s+recebida|pagamento\s+recebido|voc[eê]\s+recebeu(?:\s+(?:um|uma)\s+(?:pix|transfer[eê]ncia))?)\s*[:\-–]?\s*/i, '')
      .replace(/^[^A-Za-zÀ-ÿ]+/, '').replace(/[\s:\-–]+$/, '').trim();
    const ok = nomeExtraidoSeguro(n);
    if (ok) return ok;
  }
  const m2 = c.match(/R\$\s*[\d.]+(?:,\d{1,2})?\s*[-–:]\s*([A-Za-zÀ-ÿ'.]+(?:\s+[A-Za-zÀ-ÿ'.]+){1,7})/);
  if (m2) { const ok = nomeExtraidoSeguro(m2[1].trim()); if (ok) return ok; }
  return null;
}
function processarNotificacaoApp(chave, deviceId, d) {
  const rec = carregarKeys()[chave];
  if (!rec) return { ok: false, msg: 'Key inválida.' };
  if (keyExpirada(rec)) return { ok: false, msg: 'Key expirada.' };
  if (!rec.usadaPor || rec.appDevice !== deviceId) return { ok: false, msg: 'Celular não vinculado. Conecte de novo com a key.' };
  const dono = String(rec.usadaPor);
  if (!appNotifAtivo(dono)) return { ok: true, pix: false, ativo: false, msg: 'Notificações do app desativadas no bot.' };
  const app = String(d.app || d.pacote || 'app').slice(0, 60);
  const texto = `${d.titulo || ''} ${d.texto || ''}`.replace(/\s+/g, ' ').trim().slice(0, 1000);
  if (!texto) return { ok: true, pix: false };
  const textoNorm = normalizarNome(texto);
  // Pix ENVIADO por você: ignora. Mas "Fulano te enviou/te pagou" é ENTRADA e nunca pode cair aqui.
  const ehSaida = /voce (?:enviou|pagou|transferiu|fez um pix|realizou)|pix enviado|transferencia enviada|pagamento enviado|pix agendado/.test(textoNorm)
    && !/\bte (?:enviou|pagou|transferiu|mandou)\b/.test(textoNorm);
  if (ehSaida) { info(`📱 App [${dono}] ignorada (saída) em ${app}: ${texto.slice(0, 120)}`); return { ok: true, pix: false }; }
  // Pix RECEBIDO: bancos usam textos bem diferentes (Inter/C6: "enviou um Pix para você", PicPay: "te pagou", etc.).
  const ehEntrada = /receb(?:eu|id[oa]|imento)|credit(?:ad[oa]|o)|entrou|caiu|depositou|\bte (?:enviou|pagou|transferiu|mandou)\b|\b(?:enviou|transferiu|mandou|pagou)\b.{0,50}\b(?:para|pra) voce\b/.test(textoNorm);
  if (!ehEntrada) { info(`📱 App [${dono}] ignorada (não parece Pix recebido) em ${app}: ${texto.slice(0, 120)}`); return { ok: true, pix: false }; }
  const mv = texto.match(/R\$\s*([\d.]+(?:,\d{1,2})?)/);
  const valor = mv ? Number(mv[1].replace(/\./g, '').replace(',', '.')) : NaN;
  if (!Number.isFinite(valor) || valor <= 0) { info(`📱 App [${dono}] ignorada (sem valor R$ legível) em ${app}: ${texto.slice(0, 120)}`); return { ok: true, pix: false }; }
  let nome = null;
  try { nome = nomeAntesDoVerboApp(String(d.texto || '')) || nomeAntesDoVerboApp(texto) || null; } catch {}
  if (!nome) { try { nome = nomeExtraidoSeguro(extrairNomePagador(texto)) || nomePagadorGenerico(textoNorm) || null; } catch {} }
  if (nome && (/\b(?:para|pra)\s+voc[eê]\b/i.test(nome) || /^R\b/.test(nome) || /\bpix\b/i.test(nome))) nome = null;   // lixo de extração
  if (!nome) {
    const mn = texto.match(/\bde\s+([A-Za-zÀ-ÿ'.]+(?:\s+[A-Za-zÀ-ÿ'.]+){1,5})/);
    if (mn) { try { nome = nomeExtraidoSeguro(mn[1]) || null; } catch {} }
  }
  const ts = Number(d.ts) || Date.now();
  const uid = 'app-' + crypto.createHash('sha1').update(`${dono}|${app}|${texto}|${Math.floor(ts / 60000)}`).digest('hex').slice(0, 20);
  const cache = mapUsuario(cacheEmailsPorUsuario, dono);
  if (cache.has(uid)) return { ok: true, pix: true, ativo: true, valor, nome, repetido: true };
  cache.set(uid, { uid, nome, valor, data: new Date(), messageId: null, textoNorm, temBanco: true, banco: app, via: 'app', truncado: /…|\.\.\.\s*$/.test(texto) });
  registrarPixLido(dono, { uid, nome, valor, origem: 'app', fonte: app, ts });
  notificarNovosEmails(dono);   // acorda o "pg" que estiver esperando
  sucesso(`📱 App [${dono}] Pix lido em ${app}: ${nome || '(sem nome)'} — ${formatarValor(valor)}`);
  return { ok: true, pix: true, ativo: true, valor, nome, fonte: app, origem: 'app' };
}
// ===== App Android: painel completo (mensagens, variáveis, modo fantasma, comandos de sala, conta, servidores, antiban) =====
// Tudo usa as MESMAS funções do painel do Discord, então o que muda no app aparece no Discord e vice-versa.
function appDonoValido(chave, deviceId) {
  const rec = carregarKeys()[chave];
  if (!rec) return { erro: 'Key inválida.' };
  if (keyExpirada(rec)) return { erro: 'Key expirada.' };
  if (!rec.usadaPor || rec.appDevice !== deviceId) return { erro: 'Celular não vinculado. Conecte de novo com a key.' };
  return { userId: String(rec.usadaPor), rec };
}
function appServidorDaConta(userId, guildId) {
  return listarServidoresConta(userId).some(s => s.id === String(guildId));
}
function appListaSalaTipos() {
  return Object.entries(TIPOS_SALA).map(([k, t]) => ({
    k, rotulo: t.rotulo, descricao: t.descricao, padrao: DEFAULT_COMANDOS_SALA[k] || ''
  }));
}
function appListaMsgTipos() {
  return Object.entries(TIPOS_MENSAGEM).map(([k, t]) => ({
    k, rotulo: t.rotulo, descricao: t.descricao, placeholders: t.placeholders, padrao: String(t.padrao || '')
  }));
}
function appSnapshotPainel(userId, rec) {
  const cfg = obterConfigUsuario(userId);
  const u = carregarUsuarios()[userId] || {};
  const ab = new Set(antibanLista());
  const servs = listarServidoresConta(userId).map(s => ({
    id: s.id,
    nome: s.nome,
    antiban: ab.has(String(s.id)),
    salasAutomed: automedAtivoNoServidor(cfg, s.id)
  }));
  const bruto = carregarConfigs()[userId] || {};
  const g = bruto.msgsGlobal || {};
  const globalMsgs = {};
  for (const [k, t] of Object.entries(TIPOS_MENSAGEM)) globalMsgs[k] = g[t.campo] ? String(g[t.campo]) : '';
  return {
    ok: true,
    conta: {
      userId,
      nome: nomeDaConta(userId) || '',
      online: selfbots.has(userId),
      automed: cfg.automedAtivo !== false,
      email: u.email || '',
      semToken: !u.token,
      antibanLivre: !!(abLivreCfg(u) && !u.token),
      expira: restanteDaKey(rec),
      fantasma: modoSilencioso(userId),
      appNotif: appNotifAtivo(userId)
    },
    servidores: servs,
    antibanTotal: servs.filter(s => s.antiban).length,
    msgTipos: appListaMsgTipos(),
    salaTipos: appListaSalaTipos(),
    global: {
      ativo: mensagemGlobalAtiva(userId),
      msgs: globalMsgs,
      imagem: g.imagemInstrucoes ? String(g.imagemInstrucoes) : ''
    },
    win: bruto.msgWin ? String(bruto.msgWin) : '',
    meet: bruto.comandoMeet ? String(bruto.comandoMeet) : '',
    variaveis: variaveisMsg(userId).map(v => ({ id: String(v.id), gatilho: String(v.gatilho), mensagem: String(v.mensagem) }))
  };
}
function appSnapshotServidor(userId, guildId) {
  const gid = String(guildId || '');
  if (!appServidorDaConta(userId, gid)) return { ok: false, msg: 'Servidor não encontrado. A conta ainda está nele?' };
  const msgs = {};
  for (const [k, t] of Object.entries(TIPOS_MENSAGEM)) msgs[k] = textoModalServidor(userId, gid, t.campo);
  const comandos = {};
  for (const k of Object.keys(TIPOS_SALA)) {
    comandos[k] = { custom: comandoSalaDoServidor(userId, gid, k), efetivo: obterComandoSala(userId, gid, k) };
  }
  return {
    ok: true,
    id: gid,
    nome: nomeDoServidor(userId, gid),
    antiban: antibanAtivo(userId, gid),
    msgs,
    imagem: textoModalServidor(userId, gid, 'imagemInstrucoes'),
    comandos
  };
}
// ===== App Android 2.2: Gerenciar sistema, Lucros e IA (mesmos dados do painel do Discord) =====
function appSnapshotSistema(userId, rec) {
  const est = estadoInstancia(userId);
  return {
    ok: true,
    estado: est,                                   // sem | parado | conectando | online
    ativo: est === 'online' || est === 'conectando',
    congelada: !!rec.congeladaEm,
    expiraTs: rec.congeladaEm ? 0 : (Number(rec.expiraEm) || 0),
    expira: restanteDaKey(rec),
    plano: rec.dias ? `${rec.dias} dia(s)` : '',
    resgatada: !!carregarUsuarios()[userId],
    antibanLivre: !!abLivreCfg(carregarUsuarios()[userId]),
    servidoresAntiban: abLivreCfg(carregarUsuarios()[userId]) ? abLivreGuilds(userId).length : 0
  };
}
function appSnapshotHome(userId) {
  const uid = String(userId);
  const ativas = [...salasAtivas.values()].filter(r => String(r.userId) === uid && salaAtivaVigente(r.canalId));
  const itens = listarPixLidos(uid);
  const ini = new Date(); ini.setHours(0, 0, 0, 0);
  const hoje = itens.filter(x => x.ts >= ini.getTime());
  const nomeSrv = gid => { try { return (gid && nomeDoServidor(uid, gid)) || ''; } catch { return ''; } };
  const feed = [];
  for (const a of (appAtividade[uid] || [])) {
    if (a.t === 'sala') feed.push({ tipo: 'sala', titulo: 'Nova sala criada', sub: nomeSrv(a.guildId) || 'Servidor Discord', ts: a.ts });
  }
  for (const x of itens.slice(0, 20)) {
    feed.push({ tipo: 'pix', titulo: 'Pagamento recebido', sub: 'Pix' + (x.nome ? ' · ' + x.nome : ''), valor: Number(x.valor) || 0, ts: x.ts });
  }
  feed.sort((a, b) => b.ts - a.ts);
  // desempenho 24h: soma de Pix por hora (da mais antiga p/ a mais recente)
  const horas24 = new Array(24).fill(0);
  const agoraMs = Date.now();
  for (const x of itens) {
    const d = agoraMs - x.ts;
    if (d >= 0 && d < 24 * 3600 * 1000) horas24[23 - Math.floor(d / 3600000)] += Number(x.valor) || 0;
  }
  for (let i = 0; i < 24; i++) horas24[i] = Math.round(horas24[i] * 100) / 100;
  return {
    ok: true,
    salasAtivas: ativas.length,
    jogadores: ativas.reduce((t, r) => t + (Array.isArray(r.jogadores) ? r.jogadores.length : 0), 0),
    salas: ativas.slice(0, 20).map(r => ({ servidor: nomeSrv(r.guildId) || 'Servidor', iniciada: !!r.iniciadaEm, ts: r.iniciadaEm || r.criadaEm || 0 })),
    recebidoHoje: Math.round(hoje.reduce((a, x) => a + (Number(x.valor) || 0), 0) * 100) / 100,
    pixHoje: hoje.length,
    salasHoje: (appAtividade[uid] || []).filter(a => a.t === 'sala' && a.ts >= ini.getTime()).length,
    horas: horas24,
    atividade: feed.slice(0, 15)
  };
}
function appSnapshotLucros(userId) {
  const SP = 3 * 3600000; // UTC-3 (igual ao .lucro do Discord)
  const agora = Date.now();
  const d = new Date(agora - SP);
  const inicioDia = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) + SP;
  const dow = (d.getUTCDay() + 6) % 7; // segunda = 0
  const iniSemana = inicioDia - dow * 86400000;
  const iniMes = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) + SP;
  const cfg = obterConfigUsuario(userId);
  const ganhoCfg = Number(cfg.ganhoFila) || 0;
  const salas = salasLogListar(userId);
  const fat = e => (e.valor !== null && e.valor !== undefined && Number.isFinite(Number(e.valor))) ? Number(e.valor) : ganhoCfg;
  const faixa = a => {
    const l = salas.filter(e => e.ts >= a);
    return { salas: l.length, valor: Number(l.reduce((t, e) => t + fat(e), 0).toFixed(2)) };
  };
  return {
    ok: true,
    valorPorSala: ganhoCfg,
    acumulado: Number(cfg.lucro) || 0,
    hoje: faixa(inicioDia),
    semana: faixa(iniSemana),
    mes: faixa(iniMes),
    total: faixa(0),
    historico: salas.slice(-40).reverse().map(e => ({ ts: e.ts, valor: fat(e) }))
  };
}
function appSnapshotIa(userId, guildId) {
  const r = {
    ok: true,
    configurada: !!(GEMINI_KEY || GROQ_KEY),
    modelo: GEMINI_KEY ? (iaGeminiModelos()[0] || 'gemini-2.5-flash') : (iaModeloCache || ''),
    max: IA_MAX_CANAIS,
    online: selfbots.has(userId),
    servidores: listarServidoresConta(userId).map(s => ({ id: s.id, nome: s.nome, canais: iaConfig(userId, s.id).length }))
  };
  const gid = String(guildId || '');
  if (gid) {
    if (!appServidorDaConta(userId, gid)) return { ok: false, msg: 'Servidor não encontrado. A conta ainda está nele?' };
    r.guildId = gid;
    r.nome = nomeDoServidor(userId, gid);
    r.canais = canaisDoServidor(userId, gid, 'can');
    r.selecionados = iaConfig(userId, gid);
  }
  return r;
}
function appAcao(userId, d) {
  const acao = String(d.acao || '');
  const falha = msg => ({ ok: false, msg });
  if (acao === 'fantasma') {
    const novo = d.valor === true;
    salvarConfigUsuario(userId, { modoSilencioso: novo ? true : null });
    sucesso(`[${userId}] (app) Modo fantasma ${novo ? 'ATIVADO' : 'desativado'}.`);
    return { ok: true, msg: novo ? '👻 Modo fantasma ativado.' : 'Modo fantasma desativado.' };
  }
  if (acao === 'global_desativar') {
    salvarConfigUsuario(userId, { msgsGlobal: null });
    sucesso(`[${userId}] (app) Mensagens globais desativadas.`);
    return { ok: true, msg: 'Global desativado. Agora vale servidor por servidor.' };
  }
  if (acao === 'msg_salvar') {
    const tipo = String(d.tipo || '');
    const t = TIPOS_MENSAGEM[tipo];
    if (!t) return falha('Tipo de mensagem inválido.');
    const texto = String(d.texto || '').trim().slice(0, 1900);
    const img = String(d.imagem || '').trim().slice(0, 400);
    if (tipo === 'win') {
      salvarConfigUsuario(userId, { msgWin: texto });
      sucesso(`[${userId}] (app) Mensagem WIN ${texto ? 'personalizada' : 'padrão'}`);
      return { ok: true, msg: texto ? 'Mensagem de WIN atualizada.' : 'Mensagem de WIN voltou ao padrão.' };
    }
    if (tipo === 'instr' && img && !/^https?:\/\/\S+$/i.test(img)) return falha('Link da foto inválido. Use http:// ou https://');
    const patch = tipo === 'instr' ? { msgInstrucoes: texto, imagemInstrucoes: img } : { [t.campo]: texto };
    const escopo = String(d.escopo || '');
    if (escopo === 'global') {
      salvarMensagemGlobal(userId, patch);
      sucesso(`[${userId}] (app) Global • ${t.rotulo}: ${texto ? 'personalizada' : 'padrão'}`);
    } else {
      if (!appServidorDaConta(userId, escopo)) return falha('Servidor não encontrado. A conta ainda está nele?');
      salvarMensagemServidor(userId, escopo, patch);
      sucesso(`[${userId}] (app) ${nomeDoServidor(userId, escopo)} • ${t.rotulo}: ${texto ? 'personalizada' : 'padrão'}`);
    }
    return { ok: true, msg: texto || img ? `${t.rotulo} atualizada.` : `${t.rotulo} voltou ao padrão.` };
  }
  if (acao === 'var_salvar') {
    const gatilho = String(d.gatilho || '').trim().slice(0, 100);
    const mensagemVar = String(d.mensagem || '').trim().slice(0, 1900);
    if (!normalizarGatilho(gatilho) || !mensagemVar) return falha('Preencha o gatilho (com letras ou números) e a mensagem.');
    const lista = variaveisMsg(userId);
    const chave = normalizarGatilho(gatilho);
    let existente = d.id ? lista.find(v => String(v.id) === String(d.id)) : null;
    const igual = lista.find(v => normalizarGatilho(v.gatilho) === chave);
    if (existente && igual && igual.id !== existente.id) return falha('Já existe outra variável com esse gatilho.');
    if (!existente) existente = igual || null;
    if (existente) {
      existente.gatilho = gatilho;
      existente.mensagem = mensagemVar;
    } else if (lista.length >= 25) {
      return falha('Limite de 25 variáveis. Exclua alguma antes de criar outra.');
    } else {
      lista.push({ id: crypto.randomBytes(4).toString('hex'), gatilho, mensagem: mensagemVar });
    }
    salvarConfigUsuario(userId, { variaveisMsg: lista });
    sucesso(`[${userId}] (app) Variável ${existente ? 'atualizada' : 'criada'}: ${gatilho}`);
    return { ok: true, msg: existente ? 'Variável atualizada.' : 'Variável criada.' };
  }
  if (acao === 'var_excluir') {
    const ids = new Set((Array.isArray(d.ids) ? d.ids : []).map(String));
    if (!ids.size) return falha('Nenhuma variável selecionada.');
    const lista = variaveisMsg(userId);
    const restantes = lista.filter(v => !ids.has(String(v.id)));
    salvarConfigUsuario(userId, { variaveisMsg: restantes });
    sucesso(`[${userId}] (app) ${lista.length - restantes.length} variável(is) excluída(s).`);
    return { ok: true, msg: `${lista.length - restantes.length} variável(is) excluída(s).` };
  }
  if (acao === 'sala_salvar') {
    const tipo = String(d.tipo || '');
    if (!TIPOS_SALA[tipo]) return falha('Tipo de sala inválido.');
    const cmd = String(d.comando || '').trim().slice(0, 200);
    const gid = String(d.guildId || '');
    if (!gid || gid === 'global') {
      if (tipo !== 'meet') return falha('Escolha um servidor para este comando.');
      salvarConfigUsuario(userId, { comandoMeet: cmd });
    } else {
      if (!appServidorDaConta(userId, gid)) return falha('Servidor não encontrado. A conta ainda está nele?');
      salvarComandoSalaServidor(userId, gid, tipo, cmd);
    }
    sucesso(`[${userId}] (app) ${TIPOS_SALA[tipo].rotulo} (${gid || 'geral'}): ${cmd || 'padrão'}`);
    return { ok: true, msg: cmd ? `${TIPOS_SALA[tipo].rotulo} agora envia ${cmd}` : `${TIPOS_SALA[tipo].rotulo} voltou ao padrão.` };
  }
  if (acao === 'sistema_ativar') {
    if (d.valor === true) {
      if (statusAcesso(userId).congelada) return falha('🧊 Key congelada. Descongele no Discord (Gerenciar sistema).');
      if (!carregarUsuarios()[userId]) return falha('Esta key ainda não foi resgatada no Discord. Resgate em /central e configure o token (ou o antiban) antes de ativar pelo app.');
      const u = carregarUsuarios()[userId] || {};
      const livre = !u.token && !!abLivreCfg(u);
      if (!u.token && !livre) return falha('Configure o token no Discord (Token) antes de ativar.');
      if (livre && !abLivreGuilds(userId).length) return falha('Escolha ao menos um servidor antiban no Discord antes de ativar.');
      registrarAtividadeValor(userId);
      contasDesativadasInatividade.delete(String(userId));
      definirLigado(userId, true);
      if (typeof globalThis.iniciarSelfbot !== 'function') return falha('O bot ainda está iniciando no Discord. Tente de novo em alguns segundos.');
      try { iniciarSelfbot(userId); }
      catch (eIni) { erro(`[${userId}] (app) ligar falhou: ${eIni.message}`); return falha(`Não consegui ligar: ${eIni.message}`); }
      if (!selfbots.has(userId)) {
        const aIni = statusAcesso(userId);
        const motivoIni = !aIni.ok ? 'A key não está ativa (expirada ou não resgatada).'
          : aIni.congelada ? 'A key está congelada.'
          : livre ? 'Modo antiban: confira em /central-antiban se o servidor escolhido está liberado.'
          : 'O bot recusou ligar. Veja no log do servidor a linha "iniciarSelfbot recusado".';
        return falha('❌ ' + motivoIni);
      }
      sucesso(`▶️ [${userId}] (app) Instância ativada.`);
      return { ok: true, msg: '▶️ Sistema ativado! Conectando…' };
    }
    desligarUsuario(userId);
    sucesso(`⏹️ [${userId}] (app) Instância parada (a key continua valendo).`);
    return { ok: true, msg: '⏹️ Instância parada. Sua key continua valendo.' };
  }
  if (acao === 'sistema_reiniciar') {
    if (statusAcesso(userId).congelada) return falha('🧊 Key congelada. Descongele no Discord (Gerenciar sistema).');
    pararSelfbot(userId);
    definirLigado(userId, true);
    const esperaReinicio = Math.max(0, Number(process.env.RESTART_DELAY_MS ?? 8000));
    setTimeout(() => {
      try { globalThis.iniciarSelfbot(userId); sucesso(`🔄 [${userId}] (app) Instância reiniciada.`); }
      catch (e) { erro(`Reiniciar [${userId}] (app): ${e.message}`); }
    }, esperaReinicio);
    return { ok: true, msg: '🔄 Reiniciando… a instância volta em instantes.' };
  }
  if (acao === 'lucro_valor') {
    const num = normalizarNumero(d.valor);
    if (num === null || num < 0 || num > 100000) return falha('Valor inválido. Use um número como 0,50.');
    salvarConfigUsuario(userId, { ganhoFila: num });
    sucesso(`[${userId}] (app) ganhoFila = ${formatarValor(num)}`);
    return { ok: true, msg: `💰 Agora você ganha ${formatarValor(num)} por sala.` };
  }
  if (acao === 'ia_canais') {
    const gid = String(d.guildId || '');
    if (!appServidorDaConta(userId, gid)) return falha('Servidor não encontrado. A conta ainda está nele?');
    let ids = Array.isArray(d.canais) ? [...new Set(d.canais.map(x => String(x)))] : [];
    if (ids.length > IA_MAX_CANAIS) return falha(`Máximo de ${IA_MAX_CANAIS} canais.`);
    if (ids.length) {
      const validos = new Set(canaisDoServidor(userId, gid, 'can').map(c => c.id));
      if (!validos.size) return falha('A conta precisa estar online para validar os canais. Ative o sistema primeiro.');
      ids = ids.filter(x => validos.has(x));
    }
    salvarIaCanais(userId, gid, ids);
    sucesso(`[${userId}] (app) IA • ${nomeDoServidor(userId, gid)}: ${ids.length} canal(is).`);
    return { ok: true, msg: ids.length ? `IA lendo ${ids.length}/${IA_MAX_CANAIS} canal(is).` : 'IA sem canais neste servidor.' };
  }
  if (acao === 'ia_limpar') {
    iaMsgCache.clear();
    iaRespCache.clear();
    iaBase = {}; iaBaseSalvar();
    for (const g of Object.values(iaTodosCanais(userId))) for (const cid of (g || [])) setImmediate(() => iaAtualizarCanal(userId, cid));
    return { ok: true, msg: '🧹 Base da IA apagada; relendo os canais agora.' };
  }
  return falha('Ação desconhecida.');
}
function iniciarServidorOAuth() {
  if (servidorOAuth) return;
  servidorOAuth = http.createServer(async (req, res) => {
    const responder = (codigo, html) => { res.writeHead(codigo, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); };
    try {
      const u = new URL(req.url, 'http://localhost');
      if (await SbRemoto.tratarRequisicao(req, res, u)) return;
      {
        const mi = u.pathname.match(/^\/img\/([a-f0-9]{32})\.png$/);
        if (mi) {
          const it = imagensHospedadas.get(mi[1]);
          if (!it || it.exp < Date.now()) { res.writeHead(404); res.end(); return; }
          res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': it.buf.length, 'Cache-Control': 'public, max-age=600' });
          res.end(it.buf);
          return;
        }
      }
      if (u.pathname.startsWith('/api/')) {
        const responderJson = (codigo, obj) => {
          res.writeHead(codigo, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify(obj));
        };
        let corpo = '';
        req.on('data', pedaco => { corpo += pedaco; if (corpo.length > 1e6) req.destroy(); });
        req.on('end', async () => {
          try {
            const dados = corpo ? JSON.parse(corpo) : {};
            const chave = String(dados.key || '').trim().toUpperCase();
            const deviceId = String(dados.deviceId || 'desconhecido').trim();

            if (u.pathname === '/api/key') {
              const keys = carregarKeys();
              const rec = keys[chave];
              if (!rec) { responderJson(200, { ok: false, msg: '❌ Key inválida.' }); return; }
              if (rec.usadaPor && rec.usadaPor !== deviceId) {
                if (rec.appDevice && rec.appDevice !== deviceId) {
                  if (appPodeTrocarCelular(chave, deviceId, dados)) {
                    rec.appDevice = deviceId; salvarKeys(keys);
                    appRegistrarCelular(chave, deviceId, dados, true);
                    sucesso(`🔑 App: mesmo modelo de celular reinstalou o app — key ${chave} agora em …${deviceId.slice(-6)}`);
                  } else {
                    responderJson(200, { ok: false, msg: '❌ Key já está vinculada a outro celular.' }); return;
                  }
                }
                if (!rec.appDevice) { rec.appDevice = deviceId; salvarKeys(keys); sucesso(`🔑 App: celular …${deviceId.slice(-6)} vinculado à key ${chave}`); }
              }
              if (keyExpirada(rec)) { responderJson(200, { ok: false, msg: '❌ Key expirada.' }); return; }
              if (!rec.usadaPor) {
                rec.usadaPor = deviceId;
                rec.usadaEm = Date.now();
                rec.expiraEm = Date.now() + rec.dias * 86400000;
                rec.congeladaEm = null;
                rec.expiradaTratada = false;
                salvarKeys(keys);
                sucesso(`🔑 App: key ${chave} ativada (device …${deviceId.slice(-6)}, ${rec.dias} dia(s))`);
              }
              if (rec.appDevice === deviceId) appRegistrarCelular(chave, deviceId, dados, false);
              responderJson(200, { ok: true, msg: `✅ Key válida! Expira em ${restanteDaKey(rec)}.` });
              return;
            }

            if (u.pathname === '/api/modo') {
              info(`📱 App: modo "${dados.modo || dados.fonte || '?'}" (key …${chave.slice(-6)})`);
              let ligou = false;
              try {
                const recM = carregarKeys()[chave];
                if (recM && !keyExpirada(recM) && recM.usadaPor && recM.appDevice === deviceId) {
                  const donoM = String(recM.usadaPor);
                  if (!appNotifAtivo(donoM)) {
                    salvarConfigUsuario(donoM, { appNotif: true });
                    ligou = true;
                    sucesso(`📱 [${donoM}] Notificações do app ATIVADAS automaticamente (celular conectado) — o bot lê os Pix pelo celular.`);
                  }
                }
              } catch (eM) { aviso(`App /api/modo: ${eM.message}`); }
              responderJson(200, { ok: true, appNotif: ligou ? true : undefined });
              return;
            }

            if (u.pathname === '/api/pix') {
              const rec = carregarKeys()[chave];
              if (!rec) { responderJson(200, { ok: false, msg: 'Key inválida.' }); return; }
              if (keyExpirada(rec)) { responderJson(200, { ok: false, msg: 'Key expirada.' }); return; }
              if (!rec.usadaPor || rec.appDevice !== deviceId) { responderJson(200, { ok: false, msg: 'Celular não vinculado. Conecte de novo com a key.' }); return; }
              const dono = String(rec.usadaPor);
              const itens = listarPixLidos(dono);
              const inicioHoje = new Date(); inicioHoje.setHours(0, 0, 0, 0);
              const hoje = itens.filter(x => x.ts >= inicioHoje.getTime());
              responderJson(200, {
                ok: true,
                ativoApp: appNotifAtivo(dono),
                hoje: hoje.length,
                totalHoje: Math.round(hoje.reduce((a, x) => a + x.valor, 0) * 100) / 100,
                itens: itens.slice(0, 40)
              });
              return;
            }

            if (u.pathname === '/api/notificacao') {
              responderJson(200, processarNotificacaoApp(chave, deviceId, dados));
              return;
            }

            if (u.pathname === '/api/sistema' || u.pathname === '/api/lucros' || u.pathname === '/api/ia' || u.pathname === '/api/home') {
              const v = appDonoValido(chave, deviceId);
              if (v.erro) { responderJson(200, { ok: false, msg: v.erro }); return; }
              if (u.pathname === '/api/sistema') responderJson(200, appSnapshotSistema(v.userId, v.rec));
              else if (u.pathname === '/api/lucros') responderJson(200, appSnapshotLucros(v.userId));
              else if (u.pathname === '/api/home') responderJson(200, appSnapshotHome(v.userId));
              else {
                try { await garantirNomesServidores(v.userId, 3000); } catch {}
                responderJson(200, appSnapshotIa(v.userId, dados.guildId));
              }
              return;
            }

            if (u.pathname === '/api/painel' || u.pathname === '/api/servidor' || u.pathname === '/api/acao') {
              const v = appDonoValido(chave, deviceId);
              if (v.erro) { responderJson(200, { ok: false, msg: v.erro }); return; }
              try { await garantirNomesServidores(v.userId, 3000); } catch {}
              if (u.pathname === '/api/painel') responderJson(200, appSnapshotPainel(v.userId, v.rec));
              else if (u.pathname === '/api/servidor') responderJson(200, appSnapshotServidor(v.userId, dados.guildId));
              else responderJson(200, appAcao(v.userId, dados));
              return;
            }

            // ───── 🏦 APP: aba Banco (saldo + extrato da carteira AutoPay) e envio de Pix ─────
            if (u.pathname === '/api/banco' || u.pathname === '/api/pix_enviar') {
              const v = appDonoValido(chave, deviceId);
              if (v.erro) { responderJson(200, { ok: false, msg: v.erro }); return; }
              const uAp = apUsuario(v.userId);

              if (u.pathname === '/api/banco') {
                const extrato = (uAp.transacoes || []).slice(-80).map(t => {
                  const saida = t.tipo === 'saque';
                  const sq = saida ? (uAp.saques && uAp.saques[t.id]) : null;
                  let status = String(t.status || 'concluido');
                  if (sq) status = sq.status === 'concluido' ? 'concluido' : (sq.status === 'falhou' ? 'falhou' : 'processando');
                  else if (status === 'processando') status = 'processando';
                  const comp = (sq && sq.comprovante) || {};
                  let nome = String(t.nome || comp.nome || '');
                  if (!nome) nome = saida ? (sq ? apMascarar(sq.chave) : 'Saldo removido') : (t.tipo === 'reembolso' ? 'Reembolso' : 'Depósito Pix');
                  let descricao = saida ? 'Pix enviado' : (t.tipo === 'reembolso' ? 'Reembolso' : 'Depósito');
                  if (sq && sq.taxaCents) descricao += ` · taxa ${apMoeda(sq.taxaCents)}`;
                  return {
                    id: String(t.id || ''),
                    tipo: saida ? 'saida' : 'entrada',
                    valor: (Number(t.valorCents) || 0) / 100,
                    nome,
                    descricao,
                    chave: sq ? String(sq.chave || '') : '',
                    ts: Number(t.em) || Date.now(),
                    status
                  };
                }).reverse();
                responderJson(200, {
                  ok: true,
                  saldo: (Number(uAp.saldoCents) || 0) / 100,
                  titular: (() => { try { return nomeDaConta(v.userId) || ''; } catch { return ''; } })(),
                  conta: `AutoPay …${String(uAp.carteira || '').slice(-6)}`,
                  extrato
                });
                return;
              }

              // /api/pix_enviar — dinheiro de verdade: saldo conferido NO SERVIDOR (apReservarSaque), fila serial por usuário
              const chavePix = String(dados.chave || '').trim();
              const valorNum = Number(dados.valor);
              const cents = Math.round(valorNum * 100);
              if (!chavePix || !Number.isFinite(valorNum) || !(cents > 0)) { responderJson(200, { ok: false, msg: 'Chave ou valor inválido.' }); return; }
              const recentes = global.__appPixRecentes || (global.__appPixRecentes = new Map());
              const dupKey = `${v.userId}|${chavePix}|${cents}`;
              if (Date.now() - (recentes.get(dupKey) || 0) < 8000) { responderJson(200, { ok: false, msg: 'Esse mesmo Pix acabou de ser enviado. Confira o extrato antes de repetir.' }); return; }
              recentes.set(dupKey, Date.now());
              for (const [k, t] of recentes) if (Date.now() - t > 60000) recentes.delete(k);

              const rPix = await Promise.race([
                apSerial(v.userId, () => apExecutarSaque(v.userId, chavePix, cents, null)),
                new Promise(r => setTimeout(() => r({ ok: true, codigo: 'pendente', demorou: true }), 13000))
              ]);
              const sqPix = rPix && rPix.saque ? rPix.saque : null;
              const saldoAgora = (Number(apUsuario(v.userId).saldoCents) || 0) / 100;
              info(`📱 App Pix [${v.userId}] ${apMoeda(cents)} → ${apMascarar(chavePix)} • ${rPix && rPix.codigo}`);

              if (rPix && rPix.ok && rPix.codigo === 'ok') {
                const comp = (sqPix && sqPix.comprovante) || {};
                responderJson(200, { ok: true, msg: 'Pix enviado!', id: String(comp.e2e || (sqPix && sqPix.id) || ''), nome: String(comp.nome || apMascarar(chavePix)), saldo: saldoAgora });
              } else if (rPix && rPix.ok) {
                responderJson(200, { ok: true, msg: 'Pix em processamento. Você pode conferir o status no extrato.', id: String((sqPix && sqPix.id) || ''), nome: apMascarar(chavePix), saldo: saldoAgora });
              } else {
                const cod = rPix && rPix.codigo;
                let msgPix = 'Não foi possível enviar o Pix.';
                if (cod === 'saldo') msgPix = `Saldo insuficiente. O Pix cobra taxa fixa de ${apMoeda(AP_TAXA_SAQUE_CENTS)} além do valor.`;
                else if (cod === 'bloqueado') msgPix = `Envio bloqueado por ${apDuracao(rPix.restanteMs || 0)}.`;
                else if (cod === 'chave_invalida') msgPix = 'Chave Pix inválida.';
                else if (cod === 'valor_invalido') msgPix = `Valor inválido (máximo ${apMoeda(AP_MAX_CENTS)}).`;
                else if (cod === 'revisao') msgPix = 'Não consegui confirmar se o Pix saiu. Confira o extrato antes de enviar de novo.';
                else if (cod === 'falhou') msgPix = (sqPix && sqPix.motivo) ? `Pix não enviado: ${sqPix.motivo}. O valor voltou para sua carteira.` : 'Pix não enviado. O valor voltou para sua carteira.';
                else if (cod === 'indisponivel') msgPix = 'AutoPay indisponível no momento. Tente de novo em instantes.';
                responderJson(200, { ok: false, msg: msgPix, saldo: saldoAgora });
              }
              return;
            }

            // ───── 🏦 APP: gerar Pix para RECEBER (o bot cria a cobrança) + conferir se foi pago ─────
            if (u.pathname === '/api/pix_gerar' || u.pathname === '/api/pix_status') {
              const v = appDonoValido(chave, deviceId);
              if (v.erro) { responderJson(200, { ok: false, msg: v.erro }); return; }

              if (u.pathname === '/api/pix_status') {
                const depS = (apUsuario(v.userId).depositos || {})[String(dados.id || '')];
                if (!depS) { responderJson(200, { ok: false, msg: 'Pix não encontrado.' }); return; }
                const credS = Number.isInteger(depS.creditoCents) ? depS.creditoCents : apCreditoDeposito(depS.valorCents);
                responderJson(200, { ok: true, id: depS.id, status: depS.status, valor: (Number(depS.valorCents) || 0) / 100, credito: (Number(credS) || 0) / 100 });
                return;
              }

              // /api/pix_gerar — mesma cobrança do /gerarpix do Discord; é creditada sozinha quando o Pix é pago
              const centsG = Math.round(Number(dados.valor) * 100);
              if (!Number.isFinite(centsG) || centsG < AP_MIN_CENTS || centsG > AP_MAX_CENTS) {
                responderJson(200, { ok: false, msg: `Valor inválido. O mínimo é ${apMoeda(AP_MIN_CENTS)} e o máximo ${apMoeda(AP_MAX_CENTS)}.` });
                return;
              }
              let rG = await apCriarDeposito(v.userId, centsG, false, true).catch(() => ({ ok: false, motivo: 'api' }));
              if (!rG.ok && rG.motivo === 'api') { await esperar(300); rG = await apCriarDeposito(v.userId, centsG, false, true).catch(() => ({ ok: false, motivo: 'api' })); }
              if (!rG.ok) {
                const motivosG = {
                  offline: 'AutoPay offline no momento. Tente novamente em instantes.',
                  minimo: `O depósito mínimo é ${apMoeda(AP_MIN_CENTS)}.`,
                  limite: `Você já tem ${AP_MAX_DEP_PENDENTES} depósitos pendentes. Pague ou aguarde expirar antes de gerar outro.`,
                  rapido: 'Aguarde alguns segundos antes de gerar outro Pix.',
                  chave_recebedor: 'O sistema de pagamentos está com a chave PIX do recebedor incorreta. O dono precisa corrigir a chave no painel Turbofy.',
                  api: 'Não foi possível gerar o Pix agora. Tente novamente em instantes.'
                };
                responderJson(200, { ok: false, msg: motivosG[rG.motivo] || motivosG.api });
                return;
              }
              info(`📱 App gerou Pix [${v.userId}] ${apMoeda(rG.dep.valorCents)} (crédito ${apMoeda(rG.dep.creditoCents)}) • ${rG.dep.id}`);
              responderJson(200, {
                ok: true, id: rG.dep.id, copiaCola: rG.dep.copiaCola,
                valor: (Number(rG.dep.valorCents) || 0) / 100, credito: (Number(rG.dep.creditoCents) || 0) / 100
              });
              return;
            }

            responderJson(404, { ok: false, msg: 'Endpoint desconhecido.' });
          } catch (e) {
            responderJson(500, { ok: false, msg: e.message });
          }
        });
        return;
      }
      if (u.pathname !== OAUTH_CAMINHO) { responder(404, paginaOAuth(false, 'Página não encontrada', 'Esse endereço não existe.')); return; }
      const code = u.searchParams.get('code');
      const state = u.searchParams.get('state');
      const pend = oauthPendentes.get(state);
      if (u.searchParams.get('error') || !code || !state || !pend) {
        responder(400, paginaOAuth(false, 'Link inválido', 'Autorização negada, inválida ou expirada. Volte ao Discord e clique em Reconectar Gmail.'));
        return;
      }
      oauthPendentes.delete(state);
      try {
        const email = await concluirOAuthUsuario(pend.userId, code);
        sucesso(`✅ Email conectado: ${pend.userId} → ${email}`);
        try {
          if (pend.interacao) {
            await pend.interacao.editReply({ content: '# **`🟢` EMAIL CONECTADO COM SUCESSO!**', components: [] });
          }
        } catch (eEdit) { aviso(`Editar mensagem do Gmail: ${eEdit.message}`); }
        responder(200, paginaOAuth(true, 'EMAIL CONFIGURADO COM SUCESSO', 'PODE VOLTAR AO PAINEL PARA CONFIGURAR SEU AUTOMED'));
      } catch (e) {
        erro(`OAuth: ${e.message}`);
        responder(500, paginaOAuth(false, 'Não foi possível conectar', e.message));
      }
    } catch (e) {
      responder(500, paginaOAuth(false, 'Erro', e.message));
    }
  });
  servidorOAuth.on('error', e => {
    aviso(`Servidor OAuth: ${e.message}`);
    servidorOAuth = null;
  });
  servidorOAuth.listen(OAUTH_PORT, '0.0.0.0', () => {
    sucesso(`Servidor OAuth ouvindo na porta ${OAUTH_PORT}`);
  });
}

// ============================================================
// KEYS DE ACESSO (persistidas em keys.json)
// ============================================================
let keysCache = null;
function carregarKeys() {
  if (keysCache) return keysCache;
  try {
    if (fs.existsSync(KEYS_PATH)) {
      const bruto = fs.readFileSync(KEYS_PATH, 'utf8');
      try {
        const d = JSON.parse(bruto);
        keysCache = d && typeof d === 'object' ? d : {};
        return keysCache;
      } catch (e) {
        try { fs.copyFileSync(KEYS_PATH, KEYS_PATH + '.bak'); } catch {}
        aviso(`keys.json corrompido (backup em keys.json.bak): ${e.message}`);
      }
    }
  } catch (e) { aviso(`Erro lendo keys.json: ${e.message}`); }
  keysCache = {};
  return keysCache;
}
function salvarKeys(k) {
  keysCache = k;
  const tmp = KEYS_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(k, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, KEYS_PATH);
}
// ===== Celulares do app (app_dispositivos.json — salvo em JSON, igual o keys.json) =====
// Guarda, por key, os celulares que já usaram o app (modelo, versão, 1º e último acesso) e as trocas de celular.
const APP_DISP_PATH = path.join(__dirname, 'app_dispositivos.json');
let appDispCache = null;
function carregarAppDisp() {
  if (appDispCache) return appDispCache;
  try {
    if (fs.existsSync(APP_DISP_PATH)) {
      const d = JSON.parse(fs.readFileSync(APP_DISP_PATH, 'utf8'));
      appDispCache = d && typeof d === 'object' ? d : {};
      return appDispCache;
    }
  } catch (e) {
    try { fs.copyFileSync(APP_DISP_PATH, APP_DISP_PATH + '.bak'); } catch {}
    aviso(`app_dispositivos.json corrompido (backup em .bak): ${e.message}`);
  }
  appDispCache = {};
  return appDispCache;
}
function salvarAppDisp(d) {
  appDispCache = d;
  const tmp = APP_DISP_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(d, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, APP_DISP_PATH);
}
function appInfoCelular(dados) {
  const lim = (x, n) => String(x || '').trim().slice(0, n);
  return { modelo: lim(dados && dados.modelo, 60), versao: lim(dados && dados.versao, 20) };
}
function appRegistrarCelular(chave, deviceId, dados, trocou) {
  try {
    const todos = carregarAppDisp();
    const reg = todos[chave] || { atual: deviceId, celulares: [], trocas: [] };
    const info = appInfoCelular(dados);
    const agora = Date.now();
    let c = reg.celulares.find(x => x.id === deviceId);
    if (!c) { c = { id: deviceId, primeiro: agora }; reg.celulares.push(c); }
    c.ultimo = agora;
    if (info.modelo) c.modelo = info.modelo;
    if (info.versao) c.versao = info.versao;
    reg.atual = deviceId;
    if (trocou) reg.trocas.push(agora);
    reg.celulares = reg.celulares.slice(-10);
    reg.trocas = reg.trocas.slice(-20);
    todos[chave] = reg;
    salvarAppDisp(todos);
  } catch (e) { aviso(`app_dispositivos.json: ${e.message}`); }
}
// Reinstalou o app e o ID do celular mudou? Só aceita a troca se for o MESMO MODELO de celular e dentro do limite
// (padrão: 3 trocas em 7 dias; mude com APP_TROCA_MAX no .env, ou desligue com APP_TROCA_AUTO=0).
function appPodeTrocarCelular(chave, deviceId, dados) {
  if (process.env.APP_TROCA_AUTO === '0') return false;
  const reg = carregarAppDisp()[chave];
  const atual = reg && reg.celulares.find(x => x.id === reg.atual);
  const novo = appInfoCelular(dados).modelo.toLowerCase();
  if (!atual || !atual.modelo || !novo || atual.modelo.toLowerCase() !== novo) return false;
  const max = Math.max(1, Number(process.env.APP_TROCA_MAX || 3));
  const recentes = (reg.trocas || []).filter(t => Date.now() - t < 7 * 86400000).length;
  return recentes < max;
}
const ALFABETO_KEY = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
function blocoAleatorio(n) {
  const b = crypto.randomBytes(n);
  let s = '';
  for (let i = 0; i < n; i++) s += ALFABETO_KEY[b[i] % ALFABETO_KEY.length];
  return s;
}
const REGEX_KEY = /^ZEROUN-AUTOMED-[A-Z0-9]{6}-[A-Z0-9]{6}$/;
function gerarKey(dias, criadaPor) {
  const keys = carregarKeys();
  let chave;
  do { chave = `ZEROUN-AUTOMED-${blocoAleatorio(6)}-${blocoAleatorio(6)}`; } while (keys[chave]);
  keys[chave] = {
    chave, dias, criadaEm: Date.now(), criadaPor,
    usadaPor: null, usadaEm: null, expiraEm: null, congeladaEm: null, expiradaTratada: false
  };
  salvarKeys(keys);
  logKey('Key gerada', keys[chave]);
  return keys[chave];
}
function keyExpirada(rec) {
  return !!(rec && rec.usadaPor && rec.expiraEm && !rec.congeladaEm && Date.now() >= rec.expiraEm);
}
function keyAtivaDoUsuario(userId) {
  let melhor = null;
  for (const rec of Object.values(carregarKeys())) {
    if (!rec || rec.usadaPor !== userId || keyExpirada(rec)) continue;
    if (!melhor || (rec.expiraEm || 0) > (melhor.expiraEm || 0)) melhor = rec;
  }
  return melhor;
}
function statusAcesso(userId) {
  const rec = keyAtivaDoUsuario(userId);
  if (!rec) return { ok: false, key: null, congelada: false };
  return { ok: true, key: rec, congelada: !!rec.congeladaEm };
}
// ---- KEY VINCULADA AO SERVIDOR DA COMPRA ----
// Toda key vinda de compra (/painel-compra) ou de .semanaladd guarda o servidor onde foi criada (compraGuildId).
// Quem ativa a key só pode usar o automed/autopay NAQUELE servidor, mesmo configurando pelo /central de outro.
// Exceção: keys criadas no servidor central abaixo (e keys do /keys, sem servidor) valem em qualquer servidor.
const SERVIDORES_CENTRAIS = new Set(['1541560769148362903', '1569823053133783141']);
function keyServidorVinculado(rec) {
  if (!rec) return null;
  if (rec.orgGuildId) return String(rec.orgGuildId);                         // código promocional com ORG
  if (rec.origem !== 'compra' && rec.origem !== 'semanaladd') return null;  // key do /keys: livre
  const g = rec.compraGuildId ? String(rec.compraGuildId) : '';
  if (!g || SERVIDORES_CENTRAIS.has(g)) return null;                         // comprada no servidor central: livre
  return g;
}
// Contas que podem usar a key em QUALQUER servidor (ignora a trava de servidor da key),
// sem ganhar as outras liberações de dono (salas grátis etc.).
const USUARIOS_SEM_TRAVA_SERVIDOR = new Set(['1526367355998048266']);
function servidorVinculadoDoUsuario(userId) {
  try {
    if (!userId || ehLiberado(userId) || USUARIOS_SEM_TRAVA_SERVIDOR.has(String(userId))) return null;
    return keyServidorVinculado(keyAtivaDoUsuario(String(userId)));
  } catch { return null; }
}
function resgatarKey(userId, texto) {
  const chave = String(texto || '').trim().toUpperCase();
  if (!REGEX_KEY.test(chave)) return { ok: false, msg: '❌ **Key inválida, já usada ou expirada.**' };
  const keys = carregarKeys();
  const rec = keys[chave];
  if (!rec) return { ok: false, msg: '❌ **Key inválida, já usada ou expirada.**' };
  if (rec.usadaPor) {
    if (rec.usadaPor === userId && !keyExpirada(rec)) return { ok: false, msg: 'ℹ️ Você já está usando essa key.' };
    return { ok: false, msg: '❌ **Key já usada ou expirada.**' };
  }
  if (statusAcesso(userId).ok) {
    return { ok: false, msg: '⚠️ Você já possui uma key ativa. Aguarde ela expirar para adicionar outra.' };
  }
  rec.usadaPor = userId;
  rec.usadaEm = Date.now();
  rec.expiraEm = Date.now() + rec.dias * 86400000;
  rec.congeladaEm = null;
  rec.expiradaTratada = false;
  salvarKeys(keys);
  sucesso(`🔑 Key ${chave} ativada por ${userId} (${rec.dias} dia(s))`);
  logKey('Key ATIVADA', rec);
  return { ok: true, msg: `✅ **Key ativada com sucesso!** Acesso liberado por **${rec.dias} dia(s)**.` };
}
function excluirKey(chave) {
  const keys = carregarKeys();
  const rec = keys[chave];
  if (!rec) return null;
  delete keys[chave];
  salvarKeys(keys);
  logKey('Key EXCLUÍDA', rec);
  return rec;
}
function alternarCongelamentoKey(userId) {
  const keys = carregarKeys();
  const rec = Object.values(keys).find(r => r && r.usadaPor === userId && !keyExpirada(r));
  if (!rec) return null;
  if (rec.congeladaEm) {
    rec.expiraEm += Date.now() - rec.congeladaEm;
    rec.congeladaEm = null;
  } else {
    if ((rec.congelamentos || 0) >= 2) return { limite: 'congelar' };
    rec.congeladaEm = Date.now();
    rec.congelamentos = (rec.congelamentos || 0) + 1;
  }
  salvarKeys(keys);
  return rec;
}
function formatarDuracao(ms) {
  ms = Math.max(0, ms);
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}min`;
  return `${Math.max(1, m)}min`;
}
function restanteDaKey(rec) {
  if (!rec.usadaPor) return `${rec.dias} dia(s) (começa ao ativar)`;
  if (rec.congeladaEm) return `${formatarDuracao(rec.expiraEm - rec.congeladaEm)} (congelada)`;
  return formatarDuracao(rec.expiraEm - Date.now());
}
// ============================================================
// CONTROLE DOS SELFBOTS
// ============================================================
function usuarioPodeRodar(userId) {
  const u = carregarUsuarios()[userId];
  if (!u || (!u.token && !abLivreCfg(u)) || u.ligado !== true) return false;
  const a = statusAcesso(userId);
  return a.ok && !a.congelada;
}
function pararSelfbot(userId, motivo = 'desligado') {
  try { aviso(`pararSelfbot [${userId}] motivo=${motivo} ← ${String(new Error().stack).split('\n')[2].trim()}`); } catch {}
  const sb = selfbots.get(userId);
  const tinha = !!sb;
  selfbots.delete(userId);
  tentativasLoginSelfbot.delete(userId);
  if (sb) { try { sb.destroy(); } catch {} }
  pararPollerGmail(userId);
  if (tinha) logEmbed('geral', '📴 Selfbot OFFLINE', [['Conta', `<@${userId}>`], ['Motivo', motivo]], userId).catch(logErro);
}
function definirLigado(userId, ligado) {
  const usuarios = carregarUsuarios();
  if (!usuarios[userId]) return;
  usuarios[userId].ligado = !!ligado;
  salvarUsuarios(usuarios);
}
function desligarUsuario(userId) {
  definirLigado(userId, false);
  pararSelfbot(userId);
}
function erroDeTokenInvalido(e) {
  if (!e) return false;
  const msg = String(e.message || e).toLowerCase();
  const ehDiscord = e.name === 'DiscordAPIError' || (e.constructor && e.constructor.name === 'DiscordAPIError');
  const status = ehDiscord ? Number(e.httpStatus || e.status || 0) : 0;
  // Somente token inválido (401). Captcha/verificação NÃO entram aqui (ver tratarErroConta).
  // "invalid token"/"401: unauthorized" só valem quando vierem de erro real do Discord (DiscordAPIError,
  // marcado no sbremoto.js). Falha genérica do Python/proxy nunca pode apagar o token.
  return status === 401 || (ehDiscord && (msg.includes('invalid token') || msg.includes('incorrect login') ||
         msg.includes('401: unauthorized')));
}
// ------------------------------------------------------------
// Verificação de segurança (captcha / novo acesso / conta restrita) — APENAS conta de usuário.
// NÃO apaga o token: pausa a conta por 2h, em silêncio, e avisa no canal de logs.
// ------------------------------------------------------------
const PAUSA_VERIFICACAO_MS = 2 * 60 * 60 * 1000;
const contasPausadasAte = new Map();
function contaPausada(userId) {
  const id = String(userId);
  const ate = contasPausadasAte.get(id);
  if (!ate) return false;
  if (Date.now() >= ate) { contasPausadasAte.delete(id); return false; }
  return true;
}
function pausarContaPorVerificacao(userId) {
  const id = String(userId);
  if (contaPausada(id)) return;
  contasPausadasAte.set(id, Date.now() + PAUSA_VERIFICACAO_MS);
  aviso(`[${id}] Conta pausada por 2h — verificação de segurança detectada.`);
  alertaFalha(id, 'pausa');
  logEvento('seguranca', `⚠️ Conta pausada — verificação de segurança detectada. Acesse o Discord pelo navegador e confirme que foi você.\n-# Conta: <@${id}> • sem respostas por 2 horas`, id).catch(logErro);
}
// Retorna true se o erro foi tratado (verificação → pausa; 401 → remove token e para só essa conta).
function tratarErroConta(e, userId) {
  if (AD.sinalDeVerificacao(e)) { pausarContaPorVerificacao(userId); return true; }
  if (erroDeTokenInvalido(e)) { removerTokenInvalido(userId); return true; }
  return false;
}
function removerTokenInvalido(userId, tokenUsado = null) {
  try {
    const usuarios = carregarUsuarios();
    const u = usuarios[userId];
    if (!u || !u.token) { pararSelfbot(userId); return; }
    if (tokenUsado && u.token !== tokenUsado) return;
    delete u.token;
    delete u.nomeConta;
    delete u.contaId;
    delete u.userIdDetectado;
    u.ligado = false;
    salvarUsuarios(usuarios);
    pararSelfbot(userId);
    atualizarPainelSistema(userId, '🗑️ **Token inválido removido.** Cadastre um novo em Discord → Token.');
    erro(`🗑️ Token inválido de ${userId} REMOVIDO. Instância desligada.`);
      alertaFalha(userId, 'token');
  logEvento('seguranca', `🚨 TOKEN INVÁLIDO REMOVIDO de <@${userId}> (\`${userId}\`). A conta foi desligada automaticamente. Cadastre um novo token no painel.`, userId).catch(logErro);
    // Sem DM: o aviso já foi para o canal de logs (logEvento 'seguranca' acima).
  } catch (e) { aviso(`Remover token: ${e.message}`); }
}

// ---- Diagnóstico por conta: mostra POR QUE cada conta responde ou não (key, ligado, online, Gmail, app, servidor da key) ----
function diagnosticoContas() {
  try {
    const usuarios = carregarUsuarios();
    const linhas = [];
    for (const id of Object.keys(usuarios)) {
      const u = usuarios[id] || {};
      if (!u.token && !abLivreCfg(u)) continue;
      const a = statusAcesso(id);
      const problemas = [];
      if (!a.ok) problemas.push('SEM key/expirada');
      else if (a.congelada) problemas.push('key congelada');
      if (u.ligado !== true) problemas.push('desligada (ligado=false)');
      if (u.ligado === true && !selfbots.has(id) && !abLivreCfg(u)) problemas.push('ligada mas OFFLINE (login falhou?)');
      if (!u.gmailToken && !appVinculado(id)) problemas.push('sem Gmail e sem celular vinculado');
      if (gmailOauthBloq.get(id) && Date.now() < gmailOauthBloq.get(id).ate) problemas.push('Gmail recusado (reconectar no /central)');
      if (contaPausada(id)) problemas.push('pausada 2h (verificação de segurança)');
      if (obterConfigUsuario(id).automedAtivo === false) problemas.push('automed desativado');
      const vinc = servidorVinculadoDoUsuario(id);
      const info_ = `${a.ok ? 'key ok' : 'sem key'} • ${selfbots.has(id) ? 'online' : 'offline'} • gmail=${u.gmailToken ? 'sim' : 'não'} • app=${appNotifAtivo(id) ? 'sim' : 'não'}${vinc ? ' • key só no servidor ' + vinc : ''}`;
      linhas.push({ id, ok: !problemas.length, txt: `[${id}] ${info_}${problemas.length ? ' ⚠ ' + problemas.join('; ') : ''}` });
    }
    const ruins = linhas.filter(l => !l.ok);
    info(`🩺 Diagnóstico das contas: ${linhas.length - ruins.length}/${linhas.length} sem problema`);
    for (const l of ruins) aviso(`🩺 ${l.txt}`);
  } catch (e) { aviso(`Diagnóstico das contas: ${e.message}`); }
}
setTimeout(diagnosticoContas, 90 * 1000);
setInterval(diagnosticoContas, 10 * 60 * 1000);
function estadoInstancia(userId) {
  const sb = selfbots.get(userId);
  if (sb) return sb.user ? 'online' : 'conectando';
  const u = carregarUsuarios()[userId] || {};
  if ((!u.token && !abLivreCfg(u)) || !u.gmailToken || u.ligado === undefined) return 'sem';
  return 'parado';
}
const paineisSistema = new Map();
function registrarPainelSistema(userId, interacao) {
  paineisSistema.set(userId, { interacao, ts: Date.now(), aviso: null, ultimo: estadoInstancia(userId) });
}
async function atualizarPainelSistema(userId, aviso_) {
  const r = paineisSistema.get(userId);
  if (!r) return;
  if (Date.now() - r.ts > 14 * 60 * 1000) { paineisSistema.delete(userId); return; }
  if (!r.interacao.replied && !r.interacao.deferred) return;
  if (aviso_) r.aviso = aviso_;
  r.ultimo = estadoInstancia(userId);
  try { await r.interacao.editReply(telaSistema(userId, r.aviso)); }
  catch { paineisSistema.delete(userId); }
}
setInterval(() => {
  for (const [uid, r] of paineisSistema) {
    if (estadoInstancia(uid) !== r.ultimo) atualizarPainelSistema(uid).catch(logErro);
  }
}, 3000);
function varrerKeys() {
  try {
    const keys = carregarKeys();
    let mudou = false;
    for (const [chave, rec] of Object.entries(keys)) {
      if (keyExpirada(rec)) {
        aviso(`?? Key ${chave} expirou — excluída e acesso removido de ${rec.usadaPor}`);
        logKey('Key EXPIRADA (excluída)', rec);
        desligarUsuario(rec.usadaPor);
        cargosRemoverAtivo(rec).catch(logErro);
        delete keys[chave];
        mudou = true;
      }
    }
    if (mudou) salvarKeys(keys);
  } catch (e) { aviso(`Varredura de keys: ${e.message}`); }
}
// ============================================================
// UI
// ============================================================
const COR = {
  principal: '#5865F2', discord: '#5865F2', gmail: '#EA4335', sistema: '#F0B232',
  pagamentos: '#57F287', salas: '#3BA55D', mensagens: '#FEE75C', erro: '#ED4245', keys: '#EB459E'
};
const RODAPE = `-# ${NOME_MARCA} · Mediação Automática`;
const EFEMERO = MessageFlagsDJS ? { flags: MessageFlagsDJS.Ephemeral } : { ephemeral: true };
function painel({ cor = COR.principal, texto, linhas = [] }) {
  if (V2_OK) {
    const c = new ContainerBuilder().setAccentColor(parseInt(String(cor).replace('#', ''), 16));
    const textoE = emojiTexto(texto);
    c.addTextDisplayComponents(new TextDisplayBuilder().setContent((textoE.length <= 3900 ? textoE : String(texto)).slice(0, 3900)));
    if (linhas.length) {
      if (SeparatorBuilder) {
        try { c.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize ? SeparatorSpacingSize.Small : 1)); } catch {}
      }
      for (const l of linhas) c.addActionRowComponents(l);
    }
    return { components: [c], flags: MessageFlagsDJS.IsComponentsV2 };
  }
  const textoE2 = emojiTexto(texto);
  const embed = new EmbedBuilder().setColor(cor).setDescription((textoE2.length <= 4000 ? textoE2 : String(texto)).slice(0, 4000));
  return { embeds: [embed], components: linhas };
}
function opcoesResposta(p, efemero) {
  const o = { ...p };
  if (efemero) {
    if (p.flags !== undefined && MessageFlagsDJS) o.flags = p.flags | MessageFlagsDJS.Ephemeral;
    else o.ephemeral = true;
  }
  return o;
}
// ============================================================
// EMOJIS DO PACK NA INTERFACE — troca automática, SEM quebrar nada
// ------------------------------------------------------------
// Botões, menus, painéis e embeds do AutoPay usam o emoji Unicode de sempre; se o emoji equivalente do pack
// (emojis.zip → pasta emojis/, versão amarela `y_*` tem prioridade) já estiver no bot, ele assume sozinho.
// Se o pack ainda não subiu (ou AUTO_EMOJIS=false), continua o Unicode: o visual nunca fica pior que antes.
// Também aceita o NOME do pack direto: emojiUI('play', '▶️').
// ============================================================
const EMOJI_UI_MAP = {
  '✅': 'check',
  '❌': 'circle_x',
  '⚠️': 'warning',
  '⚠': 'warning',
  '⛔': 'block',
  '👤': 'account',
  '💳': 'credit_card',
  '💰': 'money',
  '🚨': 'siren',
  '🔑': 'key',
  '⏳': 'hourglass',
  '⌛': 'hourglass',
  '🗑️': 'trash_2',
  '⚙️': 'settings',
  '🎮': 'gamepad',
  '⏰': 'clock',
  '🛒': 'cart',
  '🌐': 'world',
  '➕': 'plus',
  '➖': 'minus',
  '🔎': 'discover',
  '🔍': 'discover',
  '🤖': 'bot',
  '📋': 'clipboard_list',
  '💸': 'saque',
  '🧾': 'receipt',
  '🔒': 'lock',
  '🔓': 'unlock',
  '🏷️': 'tag',
  '▶️': 'arrow_right',
  '◀️': 'left',
  '🧊': 'snowflake',
  '🏠': 'house',
  '🧹': 'brush',
  '🎁': 'gift',
  '🖼️': 'image',
  '🏞️': 'banner',
  '💻': 'laptop',
  '📱': 'mobile',
  '📊': 'stats',
  '🎟️': 'ticket',
  '🔥': 'flame',
  '🤝': 'handshake',
  '💬': 'message_circle',
  '💵': 'banknote',
  '📌': 'pin',
  '📝': 'notepad_text',
  '🏆': 'trophy',
  '🔇': 'bell_off',
  '🛡️': 'shield',
  '📜': 'description',
  '🎨': 'palette',
  '✏️': 'pencil',
  '📦': 'package',
  '📩': 'mail',
  '🎥': 'tv',
  '🔁': 'repeat',
  '🔄': 'refresh',
  '✖️': 'x',
  '📍': 'map_pin',
  '⚡': 'zap',
  '📅': 'calendar',
  '📈': 'chart_up',
  '👑': 'crown',
  '🕒': 'clock',
  '🏦': 'landmark',
  '⏱️': 'timer',
  '📷': 'qr_code',
  '📁': 'folder',
  '🔔': 'bell',
  '🧱': 'cube',
  '🎯': 'target'
};
function emojiUI(x, fallback) {
  try {
    if (!x) return x;
    const bruto = String(x);
    if (bruto.startsWith('<')) return x;                       // já é emoji personalizado
    const nome = /^[a-z][a-z0-9_]*$/.test(bruto) ? bruto : EMOJI_UI_MAP[bruto];
    if (!nome) return fallback !== undefined ? fallback : x;
    const custom = E.get(nome);
    if (custom && custom.startsWith('<')) return custom;
    return fallback !== undefined ? fallback : (/^[a-z][a-z0-9_]*$/.test(bruto) ? undefined : x);
  } catch { return fallback !== undefined ? fallback : (/^[a-z][a-z0-9_]*$/.test(String(x)) ? undefined : x); }
}
const EMOJI_UI_REGEX = new RegExp(Object.keys(EMOJI_UI_MAP).sort((a, b) => b.length - a.length).map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
// Troca os emojis Unicode de um TEXTO (painel/embed) pelos do pack — fora de blocos de código, onde emoji personalizado não renderiza.
function emojiTexto(texto) {
  try {
    const t = emojiTitulos(texto);
    const partes = t.split(/(```[\s\S]*?```|`[^`\n]*`)/g);
    for (let i = 0; i < partes.length; i += 2) partes[i] = partes[i].replace(EMOJI_UI_REGEX, m => emojiUI(m) || m);
    return partes.join('');
  } catch { return String(texto); }
}
// Títulos (#, ##, ###) das telas ganham o emoji do pack ao lado — só quando o emoji já está no bot.
const EMOJI_TITULOS = {
  'Depósito criado': 'pix', 'Depósito confirmado': 'check', 'Depósito expirado': 'hourglass', 'Operação não concluída': 'circle_x',
  'AutoPay': 'wallet', 'Estatísticas': 'stats', 'Histórico de pagamentos': 'history', 'Painel de controle': 'layout_dashboard',
  'Configurar selfbot': 'bot', 'AutoMed · Salas': 'rooms', 'AutoMed · Mensagens': 'message_circle', 'Gmail e pagamentos': 'mail',
  'Gerenciar sistema': 'settings', 'Acesso bloqueado': 'lock', 'Gerenciar keys': 'key', 'Keys ativas': 'key', 'Key gerada': 'key',
  'Excluir key': 'trash_2', 'Perfil': 'user_round', 'Ops!': 'warning', 'Mediação Automatizada': 'swords', 'CONFIGURAÇÃO DA IA ZEROUN': 'sparkles'
};
function emojiTitulos(texto) {
  try {
    return String(texto).replace(/^(#{1,3}) ([^\n]+)$/gm, (m, h, t) => {
      const nome = EMOJI_TITULOS[t.trim()];
      if (!nome) return m;
      const e = E.get(nome);
      return e && e.startsWith('<') ? `${h} ${e} ${t}` : m;
    });
  } catch { return String(texto); }
}
function emojiOpcaoUI(o) { return o && o.emoji ? { ...o, emoji: emojiUI(o.emoji) } : o; }
function btn(id, rotulo, estilo, emoji) {
  const b = new ButtonBuilder().setCustomId(id).setLabel(rotulo).setStyle(estilo);
  const em = emojiUI(emoji);
  if (em) b.setEmoji(em);
  return b;
}
function menu(id, placeholder, opcoes) {
  const s = new StringSelectMenuBuilder()
    .setCustomId(id)
    .setPlaceholder(placeholder)
    .setMinValues(1).setMaxValues(1)
    .addOptions(...opcoes.map(emojiOpcaoUI));
  return new ActionRowBuilder().addComponents(s);
}
function linhaBotoes(...botoes) { return new ActionRowBuilder().addComponents(...botoes); }
function botaoVoltar(id = 'p_voltar') { return btn(id, 'Voltar', ButtonStyle.Secondary, '<:1002683762:1558314477227876425>'); }
function modalCampos(customId, titulo, campos) {
  const m = new ModalBuilder().setCustomId(customId).setTitle(String(titulo).slice(0, 45));
  for (const c of campos) {
    const t = new TextInputBuilder()
      .setCustomId(c.id).setLabel(String(c.label).slice(0, 45))
      .setStyle(c.paragrafo ? TextInputStyle.Paragraph : TextInputStyle.Short)
      .setRequired(c.obrigatorio === true);
    if (c.placeholder) t.setPlaceholder(String(c.placeholder).slice(0, 100));
    if (c.valor && typeof t.setValue === 'function') { try { t.setValue(String(c.valor).slice(0, 4000)); } catch {} }
    if (c.max && typeof t.setMaxLength === 'function') { try { t.setMaxLength(c.max); } catch {} }
    m.addComponents(new ActionRowBuilder().addComponents(t));
  }
  return m;
}
function mascararToken(t) {
  const s = String(t || '');
  return s.length > 16 ? `${s.slice(0, 8)}••••••••${s.slice(-4)}` : '••••••••';
}
function linhaAviso(aviso_) { return aviso_ ? `\n\n${aviso_}` : ''; }

const buscaMenus = new Map();
function buscaTermo(userId, escopo) { return buscaMenus.get(`${userId}|${escopo}`) || ''; }
function buscaDefinir(userId, escopo, termo) {
  const t = String(termo || '').trim().slice(0, 50);
  if (t) buscaMenus.set(`${userId}|${escopo}`, t); else buscaMenus.delete(`${userId}|${escopo}`);
}
function buscaFiltrar(lista, termo, getTexto) {
  const palavras = normalizarNome(termo).split(' ').filter(Boolean);
  if (!palavras.length) return lista;
  return lista.filter(x => {
    const n = normalizarNome(getTexto(x));
    return palavras.every(p => n.includes(p));
  });
}
function botoesBusca(userId, escopo) {
  const termo = buscaTermo(userId, escopo);
  const b = [btn(`bs_abrir:${escopo}`, termo ? `Pesquisa: ${termo}`.slice(0, 80) : 'Pesquisar', ButtonStyle.Secondary, '🔎')];
  if (termo) b.push(btn(`bs_limpar:${escopo}`, 'Limpar', ButtonStyle.Secondary, '✖️'));
  return b;
}
function telaPorEscopo(userId, escopo, aviso_) {
  const p = String(escopo).split(':');
  if (p[0] === 'srv') {
    const mapa = {
      sl_srv: telaSalas, bi_srv: telaBuscaServidores, on_srv: telaOndeServidores,
      ms_srv: telaMensagens, ia_srv: telaIAServidores, sl_auto: telaSalasAutomed, ab_srv: telaAntiban
    };
    const f = mapa[p[1]];
    return f ? f(userId, aviso_) : telaInicio();
  }
  if (p[0] === 'keys' && p[1] === 'del') return telaExcluirKey(aviso_, userId);
  if (p[0] === 'can' && p[1] === 'on') return telaOndeLista(userId, p[2], p[3], 0, aviso_);
  if (p[0] === 'can' && p[1] === 'ia') return telaIACanais(userId, p[2], 0, aviso_);
  return telaInicio();
}

function telaInicio() {
  return painel({
    cor: COR.principal,
    texto: [
      '## Mediação Automatizada',
      '> Plataforma de mediação com detecção de PIX em tempo real.',
      '-# Zeroun Aplications — Mediação Automática',
      '',
      ' Acesso restrito — apenas mediadores autorizados podem configurar o sistema.'
    ].join('\n'),
    linhas: [linhaBotoes(btn('c_cfg', 'Configurar painel', ButtonStyle.Primary, '<:1002682625:1556634754567110797>'))]
  });
}
function telaInicioAb() {
  return painel({
    cor: COR.principal,
    texto: [
      '## Mediação Automatizada • Antiban',
      '> Sem token: o bot oficial responde por você, 100% antiban.',
      '-# Zeroun Aplications — Mediação Automática',
      '',
      ' Acesso restrito — apenas mediadores autorizados podem configurar o sistema.'
    ].join('\n'),
    linhas: [linhaBotoes(btn('cab_cfg', 'Configurar painel', ButtonStyle.Primary, '<:1002682625:1556634754567110797>'))]
  });
}
function telaAbLivre(userId, aviso_) {
  const sel = abLivreGuilds(userId);
  const ativos = antibanLista().map(g => {
    const x = botClient && botClient.guilds.cache.get(g);
    return x ? { id: g, nome: String(x.name || g).slice(0, 100) } : null;
  }).filter(Boolean).slice(0, 25);
  const opcoes = ativos.length
    ? ativos.map(g => ({ label: (sel.includes(g.id) ? '✅ ' : '') + g.nome, value: g.id, description: sel.includes(g.id) ? 'Ativo — selecione para desativar' : 'Selecione para ativar', emoji: emojiUI('🏠') }))
    : [{ label: 'Nenhum servidor antiban disponível', value: 'busca_vazia', emoji: emojiUI('🔎') }];
  return painel({
    cor: COR.sistema,
    texto: ['# Antiban sem token', RODAPE, '',
      'Escolha os **servidores** com antiban ativo onde você é o mediador. Seu ID (`' + userId + '`) é usado para reconhecer você nos cards de jogadores/mediador.',
      '-# Não precisa de token: o bot oficial responde. Selecione de novo um servidor ativo para desativar.',
      sel.length ? '\n**Ativo em**\n' + sel.map(g => `• ${(botClient.guilds.cache.get(g) || {}).name || g}`).join('\n') : ''
    ].filter(x => x !== null).join('\n') + linhaAviso(aviso_),
    linhas: [
      menu('abl_srv', 'Selecione um servidor...', opcoes),
      linhaBotoes(
        btn('v_automed', 'Gerenciar automed', ButtonStyle.Primary, '<:1002682625:1556634754567110797>'),
        botaoVoltar('p_voltar')
      )
    ]
  });
}
function telaPrincipal(userId, aviso_) {
  const a = statusAcesso(userId);
  const opcoes = [];
  let status;
  if (a.ok) {
    status = a.congelada
      ? '🧊 **Key congelada** — apenas *Gerenciar sistema* está liberado.'
      : `<:1002682620:1556632145898905620> **Key ativa** · expira <t:${Math.floor(a.key.expiraEm / 1000)}:R>`;
    opcoes.push(
      abLivreCfg(carregarUsuarios()[userId]) && !(carregarUsuarios()[userId] || {}).token
        ? { label: 'Servidores antiban', value: 'm_discord', description: 'Escolher os servidores (sem token)', emoji: '<a:1002682616:1556630095731494912>' }
        : { label: 'Discord', value: 'm_discord', description: 'Token do selfbot e configurações do automed', emoji: '<a:1002682616:1556630095731494912>' },
      { label: 'Gmail e pagamentos', value: 'm_gmail', description: 'Conectar/desconectar o Gmail e habilitar o PIX', emoji: '<:1002682619:1556631772031094855>' },
      { label: 'Auto Pay', value: 'm_autopay', description: 'Carteira, depósitos e saques via PIX', emoji: '<:1002683757:1558310911926738994>' },
      { label: 'Gerenciar sistema', value: 'm_sistema', description: 'Ativar, reiniciar, parar e gerenciar a key', emoji: '<:1002682625:1556634754567110797>' },
      { label: 'Configurar IA', value: 'm_ia', description: 'Escolher os canais que a IA lê para responder', emoji: '<:1002684186:1559203407359639572>' },
      { label: 'Estatísticas', value: 'm_stats', description: 'Pagamentos, valores e salas por período', emoji: '📊' },
      { label: 'Histórico de pagamentos', value: 'm_hist', description: 'Últimos pagamentos com banco, valor e status', emoji: '🧾' }
    );
  } else {
    status = '<:1002682621:1556632555166507089> **Acesso bloqueado** — adicione uma key válida para liberar o painel.';
  }
  opcoes.push({ label: 'Adicionar key', value: 'm_key', description: 'Ativar a key de acesso', emoji: '<:1002682620:1556632145898905620>' });
  return painel({
    cor: COR.principal,
    texto: [
      '# Painel de controle',
      RODAPE,
      '',
      'Escolha uma categoria no menu abaixo.',
      status
    ].join('\n') + linhaAviso(aviso_),
    linhas: [
      menu('p_main', 'Selecione uma opção...', opcoes),
      linhaBotoes(botaoVoltar('c_inicio'))
    ]
  });
}
function telaDiscord(userId, aviso_) {
  const u = carregarUsuarios()[userId] || {};
  const tokenTxt = u.token ? `Configurado · \`${mascararToken(u.token)}\`` : 'Não configurado';
  const contaTxt = u.nomeConta ? `\n\n**Conta logada**\n${u.nomeConta}${u.contaId ? ` · \`${u.contaId}\`` : ''}` : '';
  return painel({
    cor: COR.discord,
    texto: ['# Discord', RODAPE, '', '**Token do selfbot**', tokenTxt].join('\n') + contaTxt + linhaAviso(aviso_),
    linhas: [
      menu('d_menu', 'Selecione uma opção...', [
        { label: 'Token', value: 'd_token', description: 'Definir o token da conta que verifica os pagamentos', emoji: '<:1002682621:1556632555166507089>' },
        { label: 'Gerenciar automed', value: 'd_automed', description: 'Pagamentos, salas e mensagens', emoji: '<:1002682625:1556634754567110797>' }
      ]),
      linhaBotoes(botaoVoltar('p_voltar'))
    ]
  });
}
function telaAutomed(userId, aviso_) {
  const u = carregarUsuarios()[userId] || {};
  const est = estadoInstancia(userId);
  const ligado = est === 'online' || est === 'conectando';
  const status = `${ligado ? '🟢 Ligado' : '🔴 Desligado'} · \`${u.contaId || u.userIdDetectado || '—'}\``;
  return painel({
    cor: COR.sistema,
    texto: [
      '# Configurar selfbot',
      RODAPE,
      '',
      'Escolha uma categoria para editar as configurações sem percorrer uma lista longa.',
      '',
      '**Status da instância**',
      status,
      '',
      '-# Os atalhos abaixo controlam recursos globais; as demais opções ficam agrupadas por assunto.'
    ].join('\n') + linhaAviso(aviso_),
    linhas: [
      menu('a_menu', 'Selecione uma categoria...', [
        { label: 'Pagamentos', value: 'a_pag', description: 'Entrega do PIX, tolerância e ganho por fila', emoji: '<:1002682632:1556640539116572752>' },
        { label: 'Comandos', value: 'a_salas', description: 'Comandos de sala e MEET', emoji: '<:1002682631:1556639952950001735>' },
        { label: 'Mensagens', value: 'a_msgs', description: 'Textos automáticos por servidor', emoji: '💬' }
      ]),
      linhaBotoes(botaoVoltar('v_discord'))
    ]
  });
}
function telaPagamentos(userId, aviso_) {
  const cfg = obterConfigUsuario(userId);
  return painel({
    cor: COR.pagamentos,
    texto: [
      '# automed · Pagamentos',
      RODAPE,
      '',
      '**Entrega do PIX**',
      'Chave + QR Code',
      '',
      '**Tolerancia**',
      `${formatarValor(cfg.tolerancia || 0)} · ganho/fila ${formatarValor(cfg.ganhoFila || 0)}`,
      '',
      '**Lucro acumulado (.lucro)**',
      `${formatarValor(cfg.lucro || 0)}`,
      '',
      '**App Android (notificações)**',
      appNotifAtivo(userId) ? '🟢 Ativado' : '🔴 Desativado',
      '',
      '-# A cada 2 pagamentos verificados no mesmo canal, o ganho/fila é somado ao .lucro. Digite `.lucro` no Discord para ver o total (`.lucro zerar` limpa).'
    ].join('\n') + linhaAviso(aviso_),
    linhas: [
      menu('pg_menu', 'Selecione uma opção...', [
        { label: 'Ganho/fila', value: 'pg_ganho', description: 'Valor que você ganha a cada fila (2 pagamentos)', emoji: '<:1002682632:1556640539116572752>' },
        { label: 'Tolerância', value: 'pg_tol', description: 'Diferença aceita no valor do pagamento', emoji: '🎯' }
      ]),
      linhaBotoes(
        btn('appn_pag', appNotifAtivo(userId) ? 'Desativar notificações app' : 'Ativar notificações app', appNotifAtivo(userId) ? ButtonStyle.Danger : ButtonStyle.Success, '📱'),
        botaoVoltar('v_automed')
      )
    ]
  });
}
function linhasSelecaoServidor(userId, idMenu, extras = []) {
  const todos = listarServidoresConta(userId);
  if (!todos.length && !extras.length) return { linhas: [], total: 0, mostrados: 0 };
  const escopoBusca = `srv:${idMenu}`;
  const servidores = buscaFiltrar(todos, buscaTermo(userId, escopoBusca), s => s.nome);
  const mostrados = servidores.slice(0, 25 - extras.length);
  const opcoes = [
    ...extras,
    ...mostrados.map(s => ({
      label: String(s.nome).slice(0, 100) || s.id,
      value: s.id,
      emoji: emojiUI('🏠')
    }))
  ];
  if (!opcoes.length) opcoes.push({ label: 'Nenhum servidor encontrado', value: 'busca_vazia', emoji: emojiUI('🔎') });
  const linhas = [menu(idMenu, 'Selecione uma opção...', opcoes), linhaBotoes(...botoesBusca(userId, escopoBusca))];
  return { linhas, total: servidores.length || 1, mostrados: mostrados.length || 1 };
}
function textoSemServidores(userId) {
  const uAb = carregarUsuarios()[userId];
  if (abLivreCfg(uAb) && !(uAb || {}).token) return '⚠️ Nenhum servidor antiban ativo. Volte em **Servidores antiban** e selecione os servidores onde você é mediador.';
  const est = estadoInstancia(userId);
  return est === 'online'
    ? '⚠️ A conta não está em nenhum servidor.'
    : '⚠️ A instância precisa estar **online** para listar os servidores da conta. Ative em **Gerenciar sistema**.';
}
function telaSalas(userId, aviso_) {
  const sel = linhasSelecaoServidor(userId, 'sl_srv', [
    { label: 'Chamar telador', value: 'sl_telador', description: 'Comando enviado quando alguém falar "tela"', emoji: '🎥' }
  ]);
  const corpo = sel.total
    ? `Escolha o **servidor** para definir os comandos de sala dele.${sel.total > sel.mostrados ? `\n-# Mostrando ${sel.mostrados} de ${sel.total} servidores.` : ''}`
    : textoSemServidores(userId);
  return painel({
    cor: COR.salas,
    texto: [
      '# AutoMed · Salas',
      RODAPE,
      '',
      corpo,
      '',
      '-# Cada servidor tem seus próprios comandos. Sem personalização, vale o comando padrão.'
    ].join('\n') + linhaAviso(aviso_),
    linhas: [...sel.linhas, linhaBotoes(
      btn('sl_modo', 'Ativar salas automed', ButtonStyle.Success, '🤖'),
      btn('cp_comprar', 'Comprar salas', ButtonStyle.Primary, '🛒'),
      btn('on_cfg', 'Onde responder', ButtonStyle.Secondary, '📍'),
      botaoVoltar('v_automed')
    )]
  });
}
function telaSalasAutomed(userId, aviso_) {
  const todosServ = listarServidoresConta(userId);
  const escopoBusca = 'srv:sl_auto';
  const servidores = buscaFiltrar(todosServ, buscaTermo(userId, escopoBusca), x => x.nome).slice(0, 25);
  if (!todosServ.length) {
    return painel({
      cor: COR.salas,
      texto: ['# AutoMed · Salas automed', RODAPE, '', textoSemServidores(userId)].join('\n') + linhaAviso(aviso_),
      linhas: [linhaBotoes(botaoVoltar('v_salas'))]
    });
  }
  if (!servidores.length) {
    return painel({
      cor: COR.salas,
      texto: ['# AutoMed · Salas automed', RODAPE, '', `Nenhum servidor encontrado para **${buscaTermo(userId, escopoBusca)}**.`].join('\n') + linhaAviso(aviso_),
      linhas: [linhaBotoes(...botoesBusca(userId, escopoBusca)), linhaBotoes(botaoVoltar('v_salas'))]
    });
  }
  const cfg = obterConfigUsuario(userId);
  const s = new StringSelectMenuBuilder()
    .setCustomId('sl_auto_sel')
    .setPlaceholder('Marque os servidores com sala automed...')
    .setMinValues(0)
    .setMaxValues(servidores.length)
    .addOptions(...servidores.map(x => ({
      label: String(x.nome).slice(0, 100) || x.id,
      value: x.id,
      emoji: emojiUI('🏠'),
      default: automedAtivoNoServidor(cfg, x.id)
    })));
  return painel({
    cor: COR.salas,
    texto: ['# AutoMed · Salas automed', RODAPE, '',
      'Marque os **servidores** onde a sala deve ser criada pela API após 2 pagamentos. Nos demais, vale o comando do servidor.',
      '-# Desmarque para desativar.'].join('\n') + linhaAviso(aviso_),
    linhas: [new ActionRowBuilder().addComponents(s), linhaBotoes(...botoesBusca(userId, escopoBusca)), linhaBotoes(botaoVoltar('v_salas'))]
  });
}
function telaBuscaServidores(userId, aviso_) {
  const sel = linhasSelecaoServidor(userId, 'bi_srv');
  const corpo = sel.total
    ? `Escolha o **servidor** para definir o modelo de busca dele.${sel.total > sel.mostrados ? `\n-# Mostrando ${sel.mostrados} de ${sel.total} servidores.` : ''}`
    : textoSemServidores(userId);
  return painel({
    cor: COR.salas,
    texto: ['# AutoMed · Busca instruções', RODAPE, '', corpo, '',
      '-# Sem modelo no servidor, vale o modelo geral e depois a leitura automática.'].join('\n') + linhaAviso(aviso_),
    linhas: [...sel.linhas, linhaBotoes(botaoVoltar('v_salas'))]
  });
}
function telaOndeServidores(userId, aviso_) {
  const sel = linhasSelecaoServidor(userId, 'on_srv');
  const corpo = sel.total
    ? `Escolha o **servidor** onde quer limitar as respostas.${sel.total > sel.mostrados ? `\n-# Mostrando ${sel.mostrados} de ${sel.total} servidores.` : ''}`
    : textoSemServidores(userId);
  return painel({
    cor: COR.salas,
    texto: ['# AutoMed · Onde responder', RODAPE, '', corpo, '',
      '-# Sem nada configurado, o bot responde em todo o servidor.'].join('\n') + linhaAviso(aviso_),
    linhas: [...sel.linhas, linhaBotoes(botaoVoltar('v_salas'))]
  });
}
function telaOndeModo(userId, guildId, aviso_) {
  const c = ondeConfig(userId, guildId);
  const cats = c.categorias.length ? c.categorias.map(x => `<#${x}>`).join(' ') : 'nenhuma';
  const cans = c.canais.length ? c.canais.map(x => `<#${x}>`).join(' ') : 'nenhum';
  const tudo = !c.categorias.length && !c.canais.length;
  return painel({
    cor: COR.salas,
    texto: ['# AutoMed · Onde responder', RODAPE, '',
      `**Servidor:** ${nomeDoServidor(userId, guildId)}`, '',
      '**Categorias**', cats, '',
      '**Canais**', cans, '',
      c.desativado ? '🔇 Mensagens **desativadas** neste servidor. O bot não responde aqui.'
        : (tudo ? '🌐 Respondendo em **todo o servidor**.' : '📍 Respondendo **só** nos locais acima.'),
      `-# Até ${ONDE_MAX} categorias e ${ONDE_MAX} canais.`].join('\n') + linhaAviso(aviso_),
    linhas: [
      linhaBotoes(
        btn(`on_cat:${guildId}`, 'Categoria', ButtonStyle.Primary, '📁'),
        btn(`on_can:${guildId}`, 'Canal', ButtonStyle.Primary, '💬'),
        btn(`on_limpar:${guildId}`, 'Responder em tudo', ButtonStyle.Secondary, '🧹'),
        btn(`on_off:${guildId}`, c.desativado ? 'Ativar mensagens' : 'Desativar mensagens', c.desativado ? ButtonStyle.Success : ButtonStyle.Danger, c.desativado ? '🔊' : '🔇')
      ),
      linhaBotoes(botaoVoltar('on_cfg'))
    ]
  });
}
function telaOndeLista(userId, guildId, tipo, pag, aviso_) {
  const campo = tipo === 'cat' ? 'categorias' : 'canais';
  const nomeTipo = tipo === 'cat' ? 'Categorias' : 'Canais';
  const escopoBusca = `can:on:${guildId}:${tipo}`;
  const info_ = ondePagina(userId, guildId, tipo, pag, escopoBusca);
  if (!info_.itens.length && info_.totalGeral > 0) {
    return painel({
      cor: COR.salas,
      texto: ['# AutoMed · Onde responder', RODAPE, '', `**${nomeTipo}** · nenhum resultado para **${buscaTermo(userId, escopoBusca)}**.`].join('\n') + linhaAviso(aviso_),
      linhas: [linhaBotoes(...botoesBusca(userId, escopoBusca)), linhaBotoes(botaoVoltar(`on_voltar:${guildId}`))]
    });
  }
  const selecionados = ondeConfig(userId, guildId)[campo];
  if (!info_.itens.length) {
    return painel({
      cor: COR.salas,
      texto: ['# AutoMed · Onde responder', RODAPE, '',
        `⚠️ Nenhum item de **${nomeTipo.toLowerCase()}** encontrado. A instância precisa estar **online**.`].join('\n') + linhaAviso(aviso_),
      linhas: [linhaBotoes(botaoVoltar(`on_voltar:${guildId}`))]
    });
  }
  const opcoes = info_.itens.map(c => {
    const o = { label: (tipo === 'cat' ? c.nome : `#${c.nome}`).slice(0, 100), value: c.id, default: selecionados.includes(c.id) };
    if (tipo !== 'cat' && c.cat) o.description = c.cat.slice(0, 100);
    return o;
  });
  const s = new StringSelectMenuBuilder()
    .setCustomId(`on_sel:${guildId}:${tipo}:${info_.pag}`)
    .setPlaceholder(`Selecione até ${ONDE_MAX}...`)
    .setMinValues(0)
    .setMaxValues(Math.min(ONDE_MAX, opcoes.length))
    .addOptions(...opcoes.map(emojiOpcaoUI));
  const botoes = [];
  if (info_.paginas > 1) {
    botoes.push(
      btn(`on_pg:${guildId}:${tipo}:${info_.pag - 1}`, 'Anterior', ButtonStyle.Secondary, '◀️').setDisabled(info_.pag <= 0),
      btn(`on_pg:${guildId}:${tipo}:${info_.pag + 1}`, 'Próxima', ButtonStyle.Secondary, '▶️').setDisabled(info_.pag >= info_.paginas - 1)
    );
  }
  botoes.push(...botoesBusca(userId, escopoBusca), botaoVoltar(`on_voltar:${guildId}`));
  return painel({
    cor: COR.salas,
    texto: ['# AutoMed · Onde responder', RODAPE, '',
      `**${nomeTipo}** · selecionados: **${selecionados.length}/${ONDE_MAX}**`,
      info_.paginas > 1 ? `-# Página ${info_.pag + 1} de ${info_.paginas} (${info_.total} no total). A seleção de outras páginas é mantida.` : '',
      '-# Para remover, desmarque no menu.'].filter(Boolean).join('\n') + linhaAviso(aviso_),
    linhas: [new ActionRowBuilder().addComponents(s), linhaBotoes(...botoes)]
  });
}
function telaSalasServidor(userId, guildId, aviso_) {
  const lista = Object.entries(TIPOS_SALA)
    .map(([k, t]) => `${t.emoji} **${t.rotulo}** · \`${obterComandoSala(userId, guildId, k)}\``)
    .join('\n');
  return painel({
    cor: COR.salas,
    texto: [
      '# AutoMed · Salas',
      RODAPE,
      '',
      `**Servidor:** ${nomeDoServidor(userId, guildId)}`,
      '',
      '**Modo de sala**',
      lista,
      '',
      '-# Escolha abaixo o modo de sala para editar o comando deste servidor.'
    ].join('\n') + linhaAviso(aviso_),
    linhas: [
      menu(`sl_menu:${guildId}`, 'Selecione o modo de sala...', [
        ...Object.entries(TIPOS_SALA).map(([k, t]) => ({
          label: t.rotulo, value: `sl_${k}`, description: `${t.descricao}`.slice(0, 100), emoji: t.emoji
        })),
      ]),
      linhaBotoes(botaoVoltar('v_salas'))
    ]
  });
}
function telaMensagens(userId, aviso_) {
  const globalAtivo = mensagemGlobalAtiva(userId);
  const sel = globalAtivo ? { linhas: [], total: 0, mostrados: 0 } : linhasSelecaoServidor(userId, 'ms_srv');
  const corpo = globalAtivo
    ? '🌐 **Global ativo.** As mensagens configuradas valem para **todos os servidores**.\nClique em **Desativar global** para configurar servidor por servidor.'
    : (sel.total
      ? `Escolha o **servidor** para personalizar as mensagens dele.${sel.total > sel.mostrados ? `\n-# Mostrando ${sel.mostrados} de ${sel.total} servidores.` : ''}`
      : textoSemServidores(userId));
  const botaoGlobal = globalAtivo
    ? btn('ms_global', 'Desativar global', ButtonStyle.Danger, '🌐')
    : btn('ms_global', 'Global', ButtonStyle.Success, '🌐');
  return painel({
    cor: COR.mensagens,
    texto: [
      '# AutoMed · Mensagens',
      RODAPE,
      '',
      corpo,
      '',
      '-# Cada servidor tem suas próprias mensagens. Sem personalização, vale o texto padrão.'
    ].join('\n') + linhaAviso(aviso_),
    linhas: [...sel.linhas, linhaBotoes(
      botaoGlobal,
      btn('ms_win', 'WIN', ButtonStyle.Primary, '🏆'),
      btn('ms_fantasma', modoSilencioso(userId) ? 'Desativar modo fantasma' : 'Ativar modo fantasma', modoSilencioso(userId) ? ButtonStyle.Danger : ButtonStyle.Success, '👻'),
      botaoVoltar('v_automed')
    ), linhaBotoes(
      btn('ms_var', 'Configurar variável', ButtonStyle.Primary, '➕'),
      btn('ms_var_del', 'Excluir variável', ButtonStyle.Danger, '🗑️')
    )]
  });
}
function telaMensagensServidor(userId, guildId, aviso_) {
  const lista = Object.values(TIPOS_MENSAGEM).map(t => {
    const personalizada = !!textoModalServidor(userId, guildId, t.campo);
    return `${t.emoji} **${t.rotulo}** · ${personalizada ? 'personalizada' : 'padrão'}`;
  }).join('\n');
  return painel({
    cor: COR.mensagens,
    texto: [
      '# AutoMed · Mensagens',
      RODAPE,
      '',
      `**Servidor:** ${nomeDoServidor(userId, guildId)}`,
      '',
      lista,
      '',
      '-# Placeholders: `{nome}` · `{valor}` (0,05) · `{valor_real}` (R$ 0,05) · `{restante}` (só no parcial). Campo vazio = volta ao padrão.'
    ].join('\n') + linhaAviso(aviso_),
    linhas: [
      menu(`ms_menu:${guildId}`, 'Selecione a mensagem...', Object.entries(TIPOS_MENSAGEM).map(([k, t]) => ({
        label: t.rotulo, value: `ms_${k}`, description: t.descricao.slice(0, 100), emoji: t.emoji
      }))),
      linhaBotoes(botaoVoltar('v_msgs'))
    ]
  });
}
function telaMensagensGlobal(userId, aviso_) {
  const lista = Object.values(TIPOS_MENSAGEM).map(t => {
    const definida = !!textoModalGlobal(userId, t.campo);
    return `${t.emoji} **${t.rotulo}** · ${definida ? 'global' : 'padrão'}`;
  }).join('\n');
  return painel({
    cor: COR.mensagens,
    texto: [
      '# SELECIONE A MENSAGEM QUE DESEJA CONFIGURAR GLOBALMENTE',
      RODAPE,
      '',
      lista,
      '',
      '-# Vale para todos os servidores. Placeholders: `{nome}` · `{valor}` · `{valor_real}` · `{restante}` (só no parcial). Campo vazio = volta ao padrão.'
    ].join('\n') + linhaAviso(aviso_),
    linhas: [
      menu('mg_menu', 'Selecione a mensagem...', Object.entries(TIPOS_MENSAGEM).map(([k, t]) => ({
        label: t.rotulo, value: `mg_${k}`, description: t.descricao.slice(0, 100), emoji: t.emoji
      }))),
      linhaBotoes(botaoVoltar('v_msgs'))
    ]
  });
}
const variaveisCooldown = new Map();
function variaveisMsg(userId) {
  const l = obterConfigUsuario(userId).variaveisMsg;
  return Array.isArray(l) ? l.filter(v => v && v.id && v.gatilho && v.mensagem) : [];
}
function telaVariaveisExcluir(userId, aviso_) {
  const vars = variaveisMsg(userId).slice(0, 25);
  if (!vars.length) {
    return painel({
      cor: COR.mensagens,
      texto: ['# AutoMed · Variáveis', RODAPE, '', 'Nenhuma variável configurada.'].join('\n') + linhaAviso(aviso_),
      linhas: [linhaBotoes(botaoVoltar('v_msgs'))]
    });
  }
  const s = new StringSelectMenuBuilder()
    .setCustomId('ms_var_del_sel')
    .setPlaceholder('Selecione as variáveis para excluir...')
    .setMinValues(1)
    .setMaxValues(vars.length)
    .addOptions(...vars.map(v => ({
      label: String(v.gatilho).slice(0, 100),
      value: v.id,
      description: String(v.mensagem).replace(/\s+/g, ' ').slice(0, 100),
      emoji: emojiUI('🗑️')
    })));
  return painel({
    cor: COR.mensagens,
    texto: ['# AutoMed · Excluir variáveis', RODAPE, '', 'Selecione uma ou mais variáveis desta conta para **excluir**.'].join('\n') + linhaAviso(aviso_),
    linhas: [new ActionRowBuilder().addComponents(s), linhaBotoes(botaoVoltar('v_msgs'))]
  });
}
function telaIA(userId, aviso_) {
  const o = iaTodosCanais(userId);
  const lista = Object.entries(o)
    .map(([g, l]) => `**${nomeDoServidor(userId, g)}** · ${l.map(c => `<#${c}>`).join(' ')}`)
    .join('\n') || 'Nenhum canal configurado.';
  return painel({
    cor: COR.principal,
    texto: [
      '## CONFIGURAÇÃO DA IA ZEROUN',
      RODAPE,
      '',
      '**Canais lidos pela IA**',
      lista,
      '',
      '-# Use `.ia pergunta` ou responda uma pergunta com `.ia`. A IA só procura a resposta nos canais escolhidos.'
    ].join('\n') + linhaAviso(aviso_),
    linhas: [linhaBotoes(btn('ia_cfg', 'Configurar IA', ButtonStyle.Primary, '<:1002684186:1559203407359639572>'), botaoVoltar('p_voltar'))]
  });
}
function telaIAServidores(userId, aviso_) {
  const sel = linhasSelecaoServidor(userId, 'ia_srv');
  const corpo = sel.total
    ? `Escolha o **servidor** onde a IA vai ler os canais.${sel.total > sel.mostrados ? `\n-# Mostrando ${sel.mostrados} de ${sel.total} servidores.` : ''}`
    : textoSemServidores(userId);
  return painel({
    cor: COR.principal,
    texto: ['## CONFIGURAÇÃO DA IA ZEROUN', RODAPE, '', corpo].join('\n') + linhaAviso(aviso_),
    linhas: [...sel.linhas, linhaBotoes(botaoVoltar('ia_voltar'))]
  });
}
function telaIACanais(userId, guildId, pag, aviso_) {
  const escopoBusca = `can:ia:${guildId}`;
  const info_ = ondePagina(userId, guildId, 'can', pag, escopoBusca);
  if (!info_.itens.length && info_.totalGeral > 0) {
    return painel({
      cor: COR.principal,
      texto: ['## CONFIGURAÇÃO DA IA ZEROUN', RODAPE, '', `Nenhum canal encontrado para **${buscaTermo(userId, escopoBusca)}**.`].join('\n') + linhaAviso(aviso_),
      linhas: [linhaBotoes(...botoesBusca(userId, escopoBusca)), linhaBotoes(botaoVoltar('ia_cfg'))]
    });
  }
  const sel = iaConfig(userId, guildId);
  if (!info_.itens.length) {
    return painel({
      cor: COR.erro,
      texto: ['## CONFIGURAÇÃO DA IA ZEROUN', RODAPE, '', '⚠️ Nenhum canal encontrado. A instância precisa estar **online**.'].join('\n') + linhaAviso(aviso_),
      linhas: [linhaBotoes(botaoVoltar('ia_cfg'))]
    });
  }
  const opcoes = info_.itens.map(c => {
    const o = { label: `#${c.nome}`.slice(0, 100), value: c.id, default: sel.includes(c.id) };
    if (c.cat) o.description = c.cat.slice(0, 100);
    return o;
  });
  const s = new StringSelectMenuBuilder()
    .setCustomId(`ia_sel:${guildId}:${info_.pag}`)
    .setPlaceholder(`Selecione até ${IA_MAX_CANAIS} canais...`)
    .setMinValues(0)
    .setMaxValues(Math.min(IA_MAX_CANAIS, opcoes.length))
    .addOptions(...opcoes.map(emojiOpcaoUI));
  const botoes = [];
  if (info_.paginas > 1) {
    botoes.push(
      btn(`ia_pg:${guildId}:${info_.pag - 1}`, 'Anterior', ButtonStyle.Secondary, '◀️').setDisabled(info_.pag <= 0),
      btn(`ia_pg:${guildId}:${info_.pag + 1}`, 'Próxima', ButtonStyle.Secondary, '▶️').setDisabled(info_.pag >= info_.paginas - 1)
    );
  }
  botoes.push(...botoesBusca(userId, escopoBusca), botaoVoltar('ia_cfg'));
  return painel({
    cor: COR.principal,
    texto: [
      '## CONFIGURAÇÃO DA IA ZEROUN',
      RODAPE,
      '',
      `**Servidor:** ${nomeDoServidor(userId, guildId)}`,
      `**Canais escolhidos:** ${sel.length}/${IA_MAX_CANAIS}`,
      info_.paginas > 1 ? `-# Página ${info_.pag + 1} de ${info_.paginas}. A seleção de outras páginas é mantida.` : '',
      '-# Para remover um canal, desmarque no menu.'
    ].filter(Boolean).join('\n') + linhaAviso(aviso_),
    linhas: [new ActionRowBuilder().addComponents(s), linhaBotoes(...botoes)]
  });
}
function telaGmail(userId, aviso_) {
  const u = carregarUsuarios()[userId] || {};
  const conectado = !!u.gmailToken;
  const chavePix = String(obterConfigUsuario(userId).chavePix || '').trim();
  const pixAtivo = !!chavePix;
  const pixTxt = pixAtivo
    ? `🟢 Ativa · \`${mascararChavePix(chavePix.replace(/\s+/g, ' '))}\`\n-# Esse texto é enviado exatamente como você digitou, junto da mensagem de instruções. Ele não é usado para verificar valor nem pagamento.`
    : '🔴 Desativada\n-# Clique em **Ativar chave PIX** e informe o texto que será enviado junto das instruções.';
  return painel({
    cor: COR.gmail,
    texto: [
      '# Gmail e pagamentos',
      RODAPE,
      '',
      '**Gmail**',
      conectado ? `Conectado via OAuth2${u.email ? ` · \`${u.email}\`` : ''}` : 'Não conectado',
      '',
      '**Fonte ativa**',
      'Gmail API · e-mails do banco',
      '',
      '**App Android (notificações)**',
      appNotifAtivo(userId) ? '🟢 Ativado' : '🔴 Desativado',
      '',
      '**Chave PIX**',
      pixTxt,
      '',
      '**Banco proibido**',
      (() => { const v = valorBancoProibido(userId); return v > 0 ? `🟢 Inter, PicPay e Mercado Pago · extra de **${formatarValor(v)}**` : '🔴 Desativado (valor R$ 0,00)'; })()
    ].join('\n') + linhaAviso(aviso_),
    linhas: [
      linhaBotoes(
        btn('g_reconectar', conectado ? 'Reconectar Gmail' : 'Conectar Gmail', ButtonStyle.Primary, '<:1002683754:1558309690058870894>'),
        btn('g_pauto', obterConfigUsuario(userId).pagAuto === true ? 'Desativar turbofy' : 'Ativar turbofy', obterConfigUsuario(userId).pagAuto === true ? ButtonStyle.Danger : ButtonStyle.Success, '💳'),
        btn('g_desconectar', 'Desconectar', ButtonStyle.Danger, '<:1002682623:1556633508246589470>').setDisabled(!conectado),
        btn('g_pix', pixAtivo ? 'Desativar chave PIX' : 'Ativar chave PIX', pixAtivo ? ButtonStyle.Danger : ButtonStyle.Success, '<:1002683755:1558310471461904394>'),
        botaoVoltar('p_voltar')
      ),
      linhaBotoes(
        btn('g_bancoprob', 'Configurar banco proibido', ButtonStyle.Secondary, '🚫'),
        btn('appn_gmail', appNotifAtivo(userId) ? 'Desativar notificações app' : 'Ativar notificações app', appNotifAtivo(userId) ? ButtonStyle.Danger : ButtonStyle.Success, '📱')
      )
    ]
  });
}
// ----- BANCO PROIBIDO: Inter, PicPay e Mercado Pago pagam um valor extra -----
function valorBancoProibido(userId) {
  const v = Number(obterConfigUsuario(userId).valorBancoProibido);
  return Number.isFinite(v) && v >= 0 ? v : 0.10;
}
function telaAntiban(userId, aviso_) {
  const sel = linhasSelecaoServidor(userId, 'ab_srv');
  const ativos = antibanLista(userId).map(g => `• ${nomeDoServidor(userId, g)}`);
  const corpo = sel.total
    ? [
        'Escolha o **servidor** para ativar o antiban. O bot oficial precisa estar nele.',
        '-# Nos servidores ativos o bot responde no lugar da conta, só nos canais em que você é o mediador, e as mensagens não variam. Selecione de novo um servidor ativo para desativar.',
        ativos.length ? `\n**Antiban ativo em**\n${ativos.join('\n')}` : ''
      ].filter(Boolean).join('\n')
    : textoSemServidores(userId);
  return painel({
    cor: COR.sistema,
    texto: ['# AutoMed Antiban', RODAPE, '', corpo].join('\n') + linhaAviso(aviso_),
    linhas: [...sel.linhas, linhaBotoes(botaoVoltar('ab_voltar'))]
  });
}
function telaAntibanAdmin(aviso_) {
  const lista = antibanLista();
  const nome = g => { const x = botClient && botClient.guilds.cache.get(g); return x ? x.name : 'Servidor desconhecido'; };
  return painel({
    cor: COR.sistema,
    texto: ['# AutoMed Antiban', RODAPE, '',
      lista.length ? lista.map(g => `• ${nome(g)} (\`${g}\`)`).join('\n') : 'Nenhum servidor em antiban.',
      '', '-# Nesses servidores o bot oficial responde no lugar das contas e as mensagens não variam.'
    ].join('\n') + linhaAviso(aviso_),
    linhas: [linhaBotoes(
      btn('abg_add', 'Servidor antiban add', ButtonStyle.Success, '🛡️'),
      btn('abg_rem', 'Servidor antiban rem', ButtonStyle.Danger, '🗑️')
    )]
  });
}
function telaSistema(userId, aviso_) {
  const a = statusAcesso(userId);
  const est = estadoInstancia(userId);
  const inst = { sem: '⚫ Não provisionado', parado: '🔴 Parado', conectando: '🟡 Conectando...', online: '🟢 Online' }[est];
  const rec = a.key;
  const statusKey = !rec ? 'Inativa'
    : rec.congeladaEm ? '🧊 Congelada'
    : `expira <t:${Math.floor(rec.expiraEm / 1000)}:R>`;
  const rodando = est === 'online' || est === 'conectando';
  const botoes = rodando
    ? [btn('s_reiniciar', 'Reiniciar', ButtonStyle.Secondary, '<:1002682622:1556633148178305056>'), btn('s_parar', 'Parar', ButtonStyle.Danger, '')]
    : [btn('s_ativar', 'Ativar', ButtonStyle.Success, emojiUI('play', '▶️'))];
  botoes.push(botaoVoltar('p_voltar'));
  return painel({
    cor: COR.sistema,
    texto: [
      '# Gerenciar sistema',
      RODAPE,
      '',
      '**Instância**',
      inst,
      '',
      '**Chave de acesso**',
      rec ? `Ativa · \`${rec.chave}\` · ${statusKey}` : 'Inativa',
      rec ? (keyServidorVinculado(rec) ? `-# 🔒 Vale somente em **${nomeDoServidor(userId, keyServidorVinculado(rec))}**` : '-# 🌐 Vale em qualquer servidor') : '',
      '',
      '**AutoMed Antiban**',
      antibanLista(userId).length ? `🛡️ Ativo em **${antibanLista(userId).length}** servidor(es)` : 'Desativado'
    ].join('\n') + linhaAviso(aviso_),
    linhas: [
      linhaBotoes(...botoes),
      menu('s_menu', 'Selecione uma opção...', [
        { label: 'Copiar token', value: 's_copiar', description: 'Enviar sua key de acesso no chat (só você vê)', emoji: '<:1002682630:1556639507896340522>' },
        rec && rec.congeladaEm
          ? { label: 'Descongelar token', value: 's_congelar', description: 'Retoma o tempo da key', emoji: '🔥' }
          : { label: 'Congelar token', value: 's_congelar', description: 'Pausa a key e o tempo restante', emoji: '🧊' }
      ])
    ]
  });
}
function telaBloqueada(congelada) {
  return painel({
    cor: COR.erro,
    texto: [
      '# Acesso bloqueado',
      RODAPE,
      '',
      congelada
        ? '🧊 Sua key está **congelada**. Abra **Gerenciar sistema** e descongele para liberar o painel.'
        : '🔒 Você precisa de uma **key válida** (ela pode ter expirado ou sido removida).\nAbra o painel em **Configurar painel** e use **Adicionar key**.'
    ].join('\n')
  });
}
function telaErro(msg) {
  // Nunca mostra link, nome de variável do .env nem trecho de chave/token nas telas de erro.
  const limpa = String(msg || 'Erro inesperado.')
    .replace(/https?:\/\/\S+/gi, '[link oculto]')
    .replace(/\b(?:Bearer|Bot)\s+[\w.\-]+/gi, '[oculto]')
    .replace(/\bAPP_USR-[\w-]+/g, '[oculto]')
    .replace(/\b[\w-]{24,}\.[\w-]{6,}\.[\w-]{20,}\b/g, '[oculto]')
    .replace(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g, '[config]');
  return painel({ cor: COR.erro, texto: `# Ops!\n${RODAPE}\n\n❌ ${limpa}`.slice(0, 3900) });
}
function telaKeys(aviso_) {
  const todas = Object.values(carregarKeys()).filter(r => !keyExpirada(r));
  const emUso = todas.filter(r => r.usadaPor).length;
  return painel({
    cor: COR.keys,
    texto: [
      '# Gerenciar keys',
      RODAPE,
      '',
      'Painel exclusivo do dono.',
      `<:1002682620:1556632145898905620> **Keys ativas:** ${todas.length} · 👤 **Em uso:** ${emUso} · 🆓 **Livres:** ${todas.length - emUso}`
    ].join('\n') + linhaAviso(aviso_),
    linhas: [
      linhaBotoes(
        btn('k_gerar', 'Gerar key', ButtonStyle.Success, '➕'),
        btn('k_ver', 'Ver keys', ButtonStyle.Primary, '📋'),
        btn('k_excluir', 'Excluir key', ButtonStyle.Danger, '🗑️'),
        btn('k_addt', 'Adicionar tempo', ButtonStyle.Primary, '⏳'),
        btn('k_remt', 'Remover tempo', ButtonStyle.Secondary, '⌛')
      )
    ]
  });
}
function ajustarTempoKey(chave, horas) {
  const keys = carregarKeys();
  const rec = keys[chave];
  if (!rec) return null;
  if (rec.usadaPor && rec.expiraEm) rec.expiraEm += horas * 3600000;
  else rec.dias = Math.max(1 / 24, (rec.dias || 0) + horas / 24);
  logKey(horas > 0 ? 'Tempo ADICIONADO' : 'Tempo REMOVIDO', rec, [['Horas', String(horas), true]]);
  salvarKeys(keys);
  return rec;
}
function telaTempoKey(modo) {
  const todas = Object.values(carregarKeys()).filter(r => !keyExpirada(r))
    .sort((a, b) => (b.criadaEm || 0) - (a.criadaEm || 0));
  const linhas = todas.length ? [menu(`k_tsel:${modo}`, 'Escolha a key...', todas.slice(0, 25).map(r => ({
    label: r.chave, value: r.chave,
    description: `${r.usadaPor ? `Em uso por ${r.usadaPor}` : 'Livre'} · ${restanteDaKey(r)}`.slice(0, 100), emoji: '⏳'
  })))] : [];
  return painel({
    cor: COR.keys,
    texto: [`# ${modo === 'add' ? 'Adicionar' : 'Remover'} tempo`, RODAPE, '',
      todas.length ? 'Selecione a key e depois informe a quantidade de **horas**.' : 'Nenhuma key ativa.'].join('\n'),
    linhas
  });
}
function telaPerfil(userId, aviso_) {
  const cfg = obterConfigUsuario(userId);
  const senha = String(cfg.senhaFixa || '').trim();
  return painel({
    cor: COR.principal,
    texto: [
      '# Perfil', RODAPE, '',
      '**Salas criadas**', `${Number(cfg.salasCriadas) || 0}`, '',
      '**Salas disponíveis**', (salasBot.ativo && cfg.salasBotInfinito === true ? '♾️ Ilimitadas' : `${Number(cfg.salasCompradas) || 0}`) + (salasBot.ativo ? ' *(bot de salas)*' : ''), '',
      '**Senha fixa**', senha ? `\`${senha}\`` : '`22` (padrão)', '',
      '**Tempo de go**', `${Number(cfg.tempoGo) || 3} min`
    ].join('\n') + linhaAviso(aviso_),
    linhas: [linhaBotoes(
      btn(`pf_senha:${userId}`, 'Senha fixa', ButtonStyle.Primary, '🔑'),
      btn(`pf_go:${userId}`, 'Tempo de go', ButtonStyle.Secondary, '⏱️')
    )]
  });
}
async function enviarPerfilDM(userId) {
  try {
    const usr = await botClient.users.fetch(userId);
    await usr.send(opcoesResposta(telaPerfil(userId), false));
  } catch (e) { aviso(`.perfil [${userId}]: ${e.message} (DMs abertas para o bot?)`); }
}
function telaAdmin() {
  const lista = Object.values(TIPOS_MENSAGEM)
    .map(t => `${t.emoji} **${t.rotulo}** · ${msgAdmin(t.campo) ? 'definida p/ todos' : 'padrão de cada usuário'}`).join('\n');
  return painel({
    cor: COR.keys,
    texto: ['# PAINEL ADMIN', RODAPE, '', 'Selecione a mensagem que será alterada para **TODOS os usuários**.', '', lista, '',
      '-# Placeholders: `{nome}` · `{valor}` · `{valor_real}` · `{restante}`. Campo vazio = remove.'].join('\n'),
    linhas: [
      menu('adm_menu', 'Selecione a mensagem...', Object.entries(TIPOS_MENSAGEM).map(([k, t]) => ({
        label: t.rotulo, value: `adm_${k}`, description: t.descricao.slice(0, 100), emoji: t.emoji
      }))),
      linhaBotoes(...Object.entries(TIPOS_MENSAGEM).map(([k, t]) => btn(`adm_b:${k}`, `Gerenciar ${t.rotulo}`.slice(0, 80), ButtonStyle.Secondary, t.emoji))),
      linhaBotoes(
        btn('sd_add', 'Add saldo salas', ButtonStyle.Success, '➕'),
        btn('sd_rem', 'Remover saldo', ButtonStyle.Danger, '➖')
      )
    ]
  });
}
function telaVerKeys() {
  const todas = Object.values(carregarKeys())
    .filter(r => !keyExpirada(r))
    .sort((a, b) => (a.usadaPor ? 0 : 1) - (b.usadaPor ? 0 : 1) || (a.expiraEm || 0) - (b.expiraEm || 0));
  let corpo = '';
  let mostradas = 0;
  for (const r of todas) {
    const bloco = `<:1002682620:1556632145898905620> \`${r.chave}\`\n> ${r.usadaPor ? `👤 <@${r.usadaPor}> (\`${r.usadaPor}\`)` : '🆓 Ninguém usando'}\n> ⏳ ${restanteDaKey(r)}\n\n`;
    if (corpo.length + bloco.length > 3300) break;
    corpo += bloco;
    mostradas++;
  }
  if (!todas.length) corpo = 'Nenhuma key ativa no momento.';
  else if (mostradas < todas.length) corpo += `-# … e mais ${todas.length - mostradas} key(s) não exibidas.`;
  return painel({
    cor: COR.keys,
    texto: `# Keys ativas\n${RODAPE}\n\n${corpo}`,
    linhas: [linhaBotoes(btn('k_ver_refresh', 'Atualizar', ButtonStyle.Secondary, '<a:1002683760:1558313037188833300>'))]
  });
}
function nomeUsuarioKey(uid) {
  if (!uid) return 'Livre';
  const n = (botClient && botClient.users.cache.get(String(uid)) && botClient.users.cache.get(String(uid)).username) || nomeDaConta(uid);
  return `@${n || uid}`;
}
function telaExcluirKey(aviso_, userId) {
  const ESC = 'keys:del';
  const termo = userId ? buscaTermo(userId, ESC) : '';
  const todasBrutas = Object.values(carregarKeys())
    .sort((a, b) => (keyExpirada(a) ? 1 : 0) - (keyExpirada(b) ? 1 : 0) || (b.criadaEm || 0) - (a.criadaEm || 0));
  // Pesquisa por: key (ou pedaço), @usuário, ID do Discord, "livre" / "expirada"
  const todas = termo
    ? buscaFiltrar(todasBrutas, termo, r => `${r.chave} ${r.usadaPor || 'livre'} ${nomeUsuarioKey(r.usadaPor)} ${keyExpirada(r) ? 'expirada' : ''}`)
    : todasBrutas;
  const mostradas = todas.slice(0, 25);
  const linhas = [];
  if (mostradas.length) {
    linhas.push(menu('k_del', 'Escolha a key para excluir...', mostradas.map(r => ({
      label: r.chave,
      value: r.chave,
      description: `${nomeUsuarioKey(r.usadaPor)} · ${keyExpirada(r) ? 'expirada' : restanteDaKey(r)}`.slice(0, 100),
      emoji: emojiUI('🗑️')
    }))));
  }
  if (userId) linhas.push(linhaBotoes(...botoesBusca(userId, ESC)));
  let corpo;
  if (!todasBrutas.length) corpo = 'Nenhuma key cadastrada.';
  else if (!todas.length) corpo = `🔎 Nenhuma key encontrada para **${termo}**.\n-# Pesquise por parte da key, @usuário ou ID. Toque em **Limpar** para ver todas.`;
  else {
    corpo = `Selecione uma key para **excluí-la na hora**. Quem estava usando perde o acesso automaticamente.\n` +
      (termo ? `🔎 Pesquisa: **${termo}** — ${todas.length} resultado(s)\n` : '') + '\n' +
      mostradas.map(r => `\`${r.chave.slice(-6)}\` → ${r.usadaPor ? `<@${r.usadaPor}>` : '🆓 livre'}`).join('\n') +
      (todas.length > 25 ? `\n-# Mostrando 25 de ${todas.length} keys. Use **Pesquisar** para filtrar.` : '');
  }
  return painel({
    cor: COR.erro,
    texto: ['# Excluir key', RODAPE, '', corpo].join('\n') + linhaAviso(aviso_),
    linhas
  });
}
// ============================================================
// AUTOPAY — TurbofyPay (depósito via PIX, saque via Payout)
// ============================================================
const TURBOFY_API = String(process.env.TURBOFY_API_URL || process.env.TURBOFY_BASE_URL || 'https://api.turbofypay.com').replace(/\/+$/, '');
const TURBOFY_CLIENT_ID = String(process.env.TURBOFY_CLIENT_ID || '').trim();
const TURBOFY_CLIENT_SECRET = String(process.env.TURBOFY_CLIENT_SECRET || '').trim();
const AUTOPAY_PATH = path.join(__dirname, 'autopay.json');
const AP_MIN_CENTS = 10;                 // mínimo de DEPÓSITO: R$ 0,20
const AP_MIN_SAQUE_CENTS = 1;            // mínimo de ENVIO/SAQUE PIX: R$ 0,01
const AP_MAX_CENTS = Math.round((Number(process.env.AUTOPAY_MAX_REAIS) || 50000) * 100);
const AP_TAXA_SAQUE_CENTS = Math.max(0, Math.round((Number(process.env.AUTOPAY_TAXA_SAQUE_REAIS) || 0.04) * 100));
const AP_CREDITO_DEPOSITO_PERCENT = (() => {
  const n = Number(String(process.env.AUTOPAY_CREDITO_DEPOSITO_PERCENT || '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 && n <= 100 ? n : 97; // depósito: usuário recebe 97% (taxa de 3%)
})();
const AP_APAGAR_SEG = Math.max(0, Number(process.env.AUTOPAY_APAGAR_SEG) || 0);
const AP_POLL_MS = 5000;
const AP_DEP_EXPIRA_MIN = 0; // expiração do QR Code Pix (máximo 15 min)
const AP_MAX_DEP_PENDENTES = 20;
const AP_BLOQUEIO_BASE_MS = 60 * 1000;
const AP_BLOQUEIO_MAX_MS = 30 * 60 * 1000;
const AP_ERROS_RESET_MS = 60 * 60 * 1000;
const AP_GLOBAL_JANELA_MS = 10 * 60 * 1000;
const AP_GLOBAL_MAX_ERROS = 5;
const AP_GLOBAL_BLOQUEIO_MS = 10 * 60 * 1000;
const AP_INTERVALO_POST_SAQUE_MS = 1500;
const AP_RETRY_BUSY = 3;
const AP_MAX_TENTATIVAS_ENVIO = 10;
const AP_ESPERA_SALDO_MS = Math.max(1, Number(process.env.AUTOPAY_ESPERA_SALDO_MIN) || 30) * 60 * 1000;
const AP_RETRY_SALDO_MS = 15 * 1000;

let QRCodeLib = null;
try { QRCodeLib = require('qrcode'); } catch {}
let CanvasLib = null;
try { CanvasLib = require('@napi-rs/canvas'); } catch {}
const LOGO_PATH = path.join(__dirname, 'logo.png');
async function apCarregarLogo() {
  const cand = [LOGO_PATH, path.join(process.cwd(), 'logo.png')];
  try { for (const f of fs.readdirSync(__dirname)) if (/^logo\.(png|jpe?g|webp)$/i.test(f)) cand.push(path.join(__dirname, f)); } catch {}
  for (const p of cand) {
    try { if (fs.existsSync(p)) return await CanvasLib.loadImage(fs.readFileSync(p)); }
    catch (e) { aviso(`Comprovante: logo ilegível (${p}): ${e.message}`); }
  }
  aviso(`Comprovante: logo.png não encontrado em ${__dirname}`);
  return null;
}
async function apGerarComprovanteV4(s) {
  if (!CanvasLib) { aviso('Comprovante: pacote @napi-rs/canvas NÃO instalado.'); return null; }
  try {
    const { createCanvas } = CanvasLib;
    const W = 900, H = 1560;
    const cv = createCanvas(W, H);
    const g = cv.getContext('2d');
    const c = s.comprovante || {};
    const txt = (t, x, y, size, cor, neg, maxW, al) => {
      let sz = size;
      g.fillStyle = cor; g.textAlign = al || 'left';
      do { g.font = `${neg ? 'bold ' : ''}${sz}px sans-serif`; sz -= 2; }
      while (maxW && g.measureText(String(t)).width > maxW && sz > 12);
      g.fillText(String(t), x, y);
    };
    const linhaFina = y => { g.fillStyle = '#242424'; g.fillRect(70, y, W - 140, 2); };
    g.fillStyle = '#000000'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#FFFFFF'; g.beginPath(); g.arc(120, 120, 56, 0, Math.PI * 2); g.fill();
    const logo = await apCarregarLogo();
    if (logo) {
      g.save(); g.beginPath(); g.arc(120, 120, 52, 0, Math.PI * 2); g.clip();
      g.drawImage(logo, 68, 68, 104, 104); g.restore();
    } else txt('Z', 120, 156, 80, '#000000', true, 0, 'center');
    txt('ZEROUN APPS', 200, 138, 46, '#FFFFFF', true, 620, 'left');
    linhaFina(210);
    txt('Comprovante de transferência', 70, 285, 36, '#FFFFFF', true, 760, 'left');
    txt(new Date(s.concluidoEm || Date.now()).toLocaleString('pt-BR'), 70, 332, 26, '#9A9A9A', false, 760, 'left');
    linhaFina(375);
    txt('Valor', 70, 430, 26, '#9A9A9A', false, 300, 'left');
    txt(formatarValor(s.valorCents / 100), 70, 505, 70, '#FFFFFF', true, 760, 'left');
    g.strokeStyle = '#FFFFFF'; g.lineWidth = 4; g.beginPath(); g.arc(88, 560, 18, 0, Math.PI * 2); g.stroke();
    g.lineCap = 'round'; g.lineJoin = 'round'; g.lineWidth = 5;
    g.beginPath(); g.moveTo(79, 561); g.lineTo(86, 568); g.lineTo(98, 553); g.stroke();
    txt('Pix enviado com sucesso', 122, 569, 28, '#FFFFFF', false, 650, 'left');
    linhaFina(620);
    let y = 690;
    const secao = (titulo, linhas) => {
      txt(titulo, 70, y, 38, '#FFFFFF', true, 760, 'left');
      y += 40;
      for (const [r, v] of linhas) {
        txt(r, 70, y + 20, 24, '#9A9A9A', false, 400, 'left');
        txt(v, 70, y + 62, 30, '#FFFFFF', true, 760, 'left');
        y += 92;
      }
      y += 10; linhaFina(y); y += 60;
    };
    secao('Destino', [
      ['Nome', c.nome || '—'], ['CPF/CNPJ', c.documento || '—'],
      ['Instituição', c.instituicao || '—'], ['Chave Pix', apMascarar(s.chave)]
    ]);
    const origem = [['Nome', 'TURBOFY TECNOLOGIAS E PAGAMENTOS LTDA']];
    if (process.env.PAGADOR_DOC) origem.push(['CPF/CNPJ', process.env.PAGADOR_DOC]);
    if (process.env.PAGADOR_INSTITUICAO) origem.push(['Instituição', process.env.PAGADOR_INSTITUICAO]);
    secao('Origem', origem);
    txt('ID da transação', 70, y, 24, '#9A9A9A', false, 400, 'left');
    txt(c.e2e || s.id, 70, y + 42, 26, '#FFFFFF', true, 760, 'left');
    txt(`${NOME_MARCA} · Pix`, W / 2, H - 40, 22, '#6E6E6E', false, 780, 'center');
    return cv.toBuffer('image/png');
  } catch (e) { aviso(`Comprovante: ${e.message}`); return null; }
}
async function apEnviarComprovante(res, enviar) {
  try {
    if (!res || res.codigo !== 'ok' || !res.saque) return;
    const buf = await apGerarComprovanteV4(res.saque);
    if (buf) await enviar({ files: [{ attachment: buf, name: 'comprovante.png' }] });
  } catch (e) { aviso(`Comprovante: ${e.message}`); }
}

let apCache = null;
function apCarregar() {
  if (apCache) return apCache;
  let dados = null;
  if (fs.existsSync(AUTOPAY_PATH)) {
    try {
      dados = JSON.parse(fs.readFileSync(AUTOPAY_PATH, 'utf8'));
    } catch (e) {
      try { fs.copyFileSync(AUTOPAY_PATH, `${AUTOPAY_PATH}.corrompido-${Date.now()}`); } catch {}
      throw new Error('autopay.json ilegível (cópia salva como .corrompido). AutoPay bloqueado para proteger os saldos.');
    }
  }
  if (!dados || typeof dados !== 'object') dados = {};
  if (!dados.usuarios || typeof dados.usuarios !== 'object') dados.usuarios = {};
  apCache = dados;
  return apCache;
}
function apSalvar() {
  const tmp = `${AUTOPAY_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(apCarregar(), null, 2), { mode: 0o600 });
  fs.renameSync(tmp, AUTOPAY_PATH);
}
function apGerarCarteiraId(db) {
  const usadas = new Set(Object.values(db.usuarios).map(u => u.carteira));
  for (;;) {
    const id = crypto.randomBytes(12).toString('hex');
    if (!usadas.has(id)) return id;
  }
}
function apUsuario(userId) {
  userId = String(userId || '');
  if (!/^\d{5,25}$/.test(userId)) throw new Error('AutoPay: usuário inválido.');
  const db = apCarregar();
  let u = db.usuarios[userId];
  if (!u) {
    u = {
      carteira: apGerarCarteiraId(db), saldoCents: 0, contagem: 0, transacoes: [],
      depositos: {}, saques: {}, erros: 0, ultimoErroEm: 0, bloqueioAte: 0, criadoEm: Date.now()
    };
    db.usuarios[userId] = u;
    apSalvar();
  }
  return u;
}

function apMoeda(cents) { return `R$ ${(Number(cents || 0) / 100).toFixed(2)}`; }
// Taxa REAL da Turbofy no depósito: 2,5% do valor, com mínimo de R$ 0,10 por transação.
const TF_DEP_TAXA_PERCENT = (() => { const n = Number(String(process.env.TURBOFY_DEP_TAXA_PERCENT || '').replace(',', '.')); return Number.isFinite(n) && n >= 0 ? n : 2.5; })();
const TF_DEP_TAXA_MINIMA_CENTS = Math.max(0, Math.round((Number(String(process.env.TURBOFY_DEP_TAXA_MINIMA_REAIS || '').replace(',', '.')) || 0.10) * 100));
function apTaxaTurbofyDeposito(valorCents) {
  const v = Number(valorCents) || 0;
  return Math.max(TF_DEP_TAXA_MINIMA_CENTS, Math.round(v * TF_DEP_TAXA_PERCENT / 100));
}
function apCreditoDeposito(valorCents) {
  const v = Number(valorCents) || 0;
  const retidoMinimo = Math.round(v * (100 - AP_CREDITO_DEPOSITO_PERCENT) / 100);   // o que você já retinha (3%)
  const descontar = Math.max(retidoMinimo, apTaxaTurbofyDeposito(v));                // nunca menos que a taxa real da Turbofy
  return Math.max(1, Math.min(v, v - descontar));
}
function apPercentualTexto() {
  return `${AP_CREDITO_DEPOSITO_PERCENT.toString().replace('.', ',')}%`;
}
function apConfigurado() { return !!(TURBOFY_CLIENT_ID && TURBOFY_CLIENT_SECRET); }
let apGlobalBloqueioAte = 0;
const apErrosGlobais = [];
function apAtivo() { return apConfigurado() && Date.now() >= apGlobalBloqueioAte; }
function apDuracao(ms) {
  const s = Math.max(1, Math.ceil(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60), r = s % 60;
  if (m < 60) return r ? `${m}min ${r}s` : `${m}min`;
  return `${Math.floor(m / 60)}h ${m % 60}min`;
}
function apParseValor(txt) {
  let s = String(txt || '').replace(/R\$/gi, '').replace(/\s/g, '');
  if (!/^\d[\d.,]*$/.test(s)) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, '');
  else if (/^[1-9]\d{0,2}\.\d{3}$/.test(s)) s = s.replace('.', '');
  const m = s.match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!m) return null;
  const cents = parseInt(m[1], 10) * 100 + parseInt((m[2] || '').padEnd(2, '0') || '0', 10);
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}
function apCpfValido(d) {
  if (!/^\d{11}$/.test(d) || /^(\d)\1+$/.test(d)) return false;
  for (const t of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < t; i++) soma += Number(d[i]) * (t + 1 - i);
    const dv = ((soma * 10) % 11) % 10;
    if (dv !== Number(d[t])) return false;
  }
  return true;
}
function apCnpjValido(d) {
  if (!/^\d{14}$/.test(d) || /^(\d)\1+$/.test(d)) return false;
  for (const t of [12, 13]) {
    const pesos = t === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let soma = 0;
    for (let i = 0; i < t; i++) soma += Number(d[i]) * pesos[i];
    const r = soma % 11;
    const dv = r < 2 ? 0 : 11 - r;
    if (dv !== Number(d[t])) return false;
  }
  return true;
}
function apClassificarChave(bruta, forcado) {
  if (forcado) {
    const kf = String(bruta || '').replace(/[\u200B-\u200D\uFEFF`*_~|<>]/g, '').trim();
    const df = kf.replace(/\D/g, '');
    if (forcado === 'PHONE') {
      const tel = df.length === 13 && df.startsWith('55') ? df.slice(2) : df;
      if (/^\d{10,11}$/.test(tel)) return { ok: true, tipo: 'PHONE', chave: `+55${tel}` };
      return { ok: false, motivo: 'formato' };
    }
    if (forcado === 'CPF') return df.length === 11 ? { ok: true, tipo: 'CPF', chave: df } : { ok: false, motivo: 'formato' };
    if (forcado === 'CNPJ') return df.length === 14 ? { ok: true, tipo: 'CNPJ', chave: df } : { ok: false, motivo: 'formato' };
    const normal = apClassificarChave(bruta);
    return normal.ok && normal.tipo === forcado ? normal : { ok: false, motivo: 'formato' };
  }
  let k = String(bruta || '').replace(/[\u200B-\u200D\uFEFF`*_~|<>]/g, '').trim();
  if (!k) return { ok: false, motivo: 'vazia' };
  if (k.includes('@')) {
    k = k.toLowerCase().replace(/\s+/g, '');
    if (k.length <= 77 && /^[a-z0-9._%+\-]+@[a-z0-9\-]+(\.[a-z0-9\-]+)*\.[a-z]{2,}$/.test(k)) return { ok: true, tipo: 'EMAIL', chave: k };
    return { ok: false, motivo: 'email' };
  }
  const semEsp = k.replace(/\s+/g, '');
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(semEsp)) return { ok: true, tipo: 'EVP', chave: semEsp.toLowerCase() };
  if (/^[0-9a-f]{32}$/i.test(semEsp) && /[a-f]/i.test(semEsp)) {
    const h = semEsp.toLowerCase();
    return { ok: true, tipo: 'EVP', chave: `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}` };
  }
  if (!/^[\d\s.\-\/()+]+$/.test(k)) return { ok: false, motivo: 'formato' };
  const d = k.replace(/\D/g, '');
  const comMais = k.trim().startsWith('+');
  if (!comMais && d.length === 14 && apCnpjValido(d)) return { ok: true, tipo: 'CNPJ', chave: d };
  if (!comMais && d.length === 11 && apCpfValido(d)) return { ok: true, tipo: 'CPF', chave: d };
  let tel = null;
  if (d.length === 11 && /^[1-9]{2}9\d{8}$/.test(d)) tel = d;
  else if (d.length === 13 && d.startsWith('55') && /^[1-9]{2}9\d{8}$/.test(d.slice(2))) tel = d.slice(2);
  if (tel) return { ok: true, tipo: 'PHONE', chave: `+55${tel}` };
  return { ok: false, motivo: 'formato' };
}
function apMascarar(chave) {
  const s = String(chave || '');
  if (s.includes('@')) { const [a, b] = s.split('@'); return `${a.slice(0, 2)}***@${b}`; }
  if (s.length <= 6) return '***';
  return `${s.slice(0, 3)}***${s.slice(-3)}`;
}
function apExtrairChaveDoTexto(texto) {
  const t = String(texto || '').replace(/[`*_~|]/g, ' ');
  const regs = [
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/ig,
    /[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)*\.[A-Za-z]{2,}/g,
    /\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/g,
    /\d{3}\.?\d{3}\.?\d{3}-?\d{2}/g,
    /(?:\+?55\s?)?\(?\d{2}\)?\s?9\d{4}[-\s]?\d{4}/g
  ];
  for (const re of regs) {
    for (const m of (t.match(re) || [])) {
      const c = apClassificarChave(m);
      if (c.ok) return c;
    }
  }
  return null;
}

// ---------- HTTP Turbofy ----------
const apUrlBase = (() => { try { return new URL(TURBOFY_API); } catch { return new URL('https://api.turbofypay.com'); } })();
const apLib = apUrlBase.protocol === 'http:' ? http : https;
const apAgent = new apLib.Agent({ keepAlive: true, keepAliveMsecs: 10000, maxSockets: 20, maxFreeSockets: 8 });
function apRequest(metodo, caminho, headers, body, timeoutMs, novaConexao = false) {
  return new Promise(resolve => {
    let fim = false;
    const terminar = v => { if (!fim) { fim = true; resolve(v); } };
    const req = apLib.request({
      protocol: apUrlBase.protocol, hostname: apUrlBase.hostname, port: apUrlBase.port || undefined,
      method: metodo, path: `${apUrlBase.pathname.replace(/\/+$/, '')}${caminho}`,
      headers, agent: novaConexao ? false : apAgent
    }, res => {
      const partes = [];
      res.on('data', d => partes.push(d));
      res.on('end', () => terminar({ status: res.statusCode, texto: Buffer.concat(partes).toString('utf8') }));
      res.on('error', e => terminar({ status: 0, erro: e.message }));
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
    req.on('error', e => terminar({ status: 0, erro: e && e.message ? e.message : String(e) }));
    if (body) req.write(body);
    req.end();
  });
}
function apAquecer() {
  apRequest('GET', '/', { Accept: 'application/json' }, '', 8000).catch(logErro);
}
async function apHttp(metodo, caminho, corpo, { assinar = false, idem = null, timeoutMs = 20000, novaConexao = false, prioridade = 'critico' } = {}) {
  const body = corpo === undefined || corpo === null ? '' : JSON.stringify(corpo);
  const headers = { 'x-client-id': TURBOFY_CLIENT_ID, 'x-client-secret': TURBOFY_CLIENT_SECRET, Accept: 'application/json' };
  if (body) headers['Content-Type'] = 'application/json';
  if (idem) headers['x-idempotency-key'] = idem;
  if (assinar) {
    const ts = String(Date.now());
    headers['x-turbofy-timestamp'] = ts;
    headers['x-turbofy-signature'] = crypto.createHmac('sha256', TURBOFY_CLIENT_SECRET)
      .update(`${ts}.${metodo}.${caminho}.${body}`).digest('hex');
  }
  headers['Content-Length'] = Buffer.byteLength(body);
  const res = await filaTurbofy.executar(prioridade, () => apRequest(metodo, caminho, headers, body, timeoutMs, novaConexao));
  if (res && res.status === 429) filaTurbofy.pausar(5000);
  let json = null;
  try { json = res.texto ? JSON.parse(res.texto) : null; } catch {}
  return { status: res.status, json, texto: res.texto, erro: res.erro };
}
function apAcharString(obj, rxChave, rxPai, prof = 0, pai = '') {
  if (!obj || typeof obj !== 'object' || prof > 4) return '';
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string' && v.trim() && rxChave.test(k) && (!rxPai || rxPai.test(pai))) return v.trim();
  }
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === 'object') { const r = apAcharString(v, rxChave, rxPai, prof + 1, `${pai}.${k}`); if (r) return r; }
  }
  return '';
}
function apErroApi(r) {
  const e = (r && r.json && r.json.error) || {};
  return { codigo: String(e.code || ''), mensagem: String(e.message || (r && r.erro) || ''), traceId: e.traceId || '' };
}
let apUltimoPost = 0;
let apPaceFila = Promise.resolve();
function apPace() {
  const p = apPaceFila.then(async () => {
    const espera = apUltimoPost + AP_INTERVALO_POST_SAQUE_MS - Date.now();
    if (espera > 0) await esperar(espera);
    apUltimoPost = Date.now();
  });
  apPaceFila = p.catch(logErro);
  return p;
}
const apFilas = new Map();
function apSerial(userId, fn) {
  const ant = apFilas.get(userId) || Promise.resolve();
  // limite de 90s: se uma operação travar, a fila do usuário é liberada (antes ficava "na fila" para sempre)
  const p = ant.catch(logErro).then(() => Promise.race([fn(), new Promise(r => setTimeout(() => { aviso(`[AutoPay] operação de [${userId}] passou de 90s — liberando a fila.`); r({ ok: false, codigo: 'indisponivel' }); }, 90000))]));
  const fim = p.catch(logErro);
  apFilas.set(userId, fim);
  fim.then(() => { if (apFilas.get(userId) === fim) apFilas.delete(userId); });
  return p;
}

function apRegistrarErroChave(userId, daApi) {
  const u = apUsuario(userId);
  const agora = Date.now();
  if (agora - (u.ultimoErroEm || 0) > AP_ERROS_RESET_MS) u.erros = 0;
  u.erros = (u.erros || 0) + 1;
  u.ultimoErroEm = agora;
  const espera = Math.min(AP_BLOQUEIO_BASE_MS * Math.pow(2, u.erros - 1), AP_BLOQUEIO_MAX_MS);
  u.bloqueioAte = agora + espera;
  apSalvar();
  if (daApi) {
    apErrosGlobais.push(agora);
    while (apErrosGlobais.length && agora - apErrosGlobais[0] > AP_GLOBAL_JANELA_MS) apErrosGlobais.shift();
    if (apErrosGlobais.length >= AP_GLOBAL_MAX_ERROS) {
      apGlobalBloqueioAte = agora + AP_GLOBAL_BLOQUEIO_MS;
      apErrosGlobais.length = 0;
      aviso(`[AutoPay] Muitas chaves recusadas pela Turbofy: saques pausados por ${apDuracao(AP_GLOBAL_BLOQUEIO_MS)} para evitar bloqueio da API.`);
    }
  }
  return espera;
}

function apRegistrarTransacao(u, t) {
  u.transacoes.push(t);
  if (u.transacoes.length > 1000) u.transacoes.splice(0, u.transacoes.length - 1000);
}
// CERTEZA ABSOLUTA: a resposta da Turbofy só vale como pagamento se TUDO bater com a cobrança que o bot criou.
// Qualquer dúvida => retorna ok:false e o depósito continua PENDENTE (nunca confirma no "talvez").
function apConferirPagamento(userId, dep, j) {
  if (!j || typeof j !== 'object') return { ok: false, motivo: 'resposta vazia da Turbofy' };
  const st = String(j.status || '').toUpperCase();
  if (st !== 'PAID') return { ok: false, motivo: `status "${st || '?'}" (não é PAID)` };
  if (j.id !== undefined && j.id !== null && String(j.id) !== String(dep.chargeId)) return { ok: false, motivo: `id da cobrança diferente (${j.id})` };
  const refApi = j.externalRef !== undefined ? j.externalRef : (j.external_ref !== undefined ? j.external_ref : j.externalReference);
  if (refApi !== undefined && refApi !== null && String(refApi) && !String(refApi).includes(String(dep.id))) return { ok: false, motivo: `referência externa diferente (${String(refApi).slice(0, 60)})` };
  if (Number.isInteger(j.amountCents) && j.amountCents !== dep.valorCents) return { ok: false, motivo: `valor da Turbofy ${j.amountCents} ≠ esperado ${dep.valorCents}`, divergente: true };
  return { ok: true };
}
const apAvisoConfTs = new Map();
function apRecusarConfirmacao(userId, dep, c, j) {
  const agora = Date.now();
  if (agora - (apAvisoConfTs.get(dep.id) || 0) > 60000) {
    apAvisoConfTs.set(dep.id, agora);
    aviso(`[AutoPay] ${dep.id}: pagamento NÃO confirmado — ${c.motivo}. Continua pendente.`);
  }
  if (c.divergente) apConfirmarDeposito(userId, dep.id, j.amountCents);   // marca 'divergente' para revisão manual
}
function apConfirmarDeposito(userId, depId, valorApiCents) {
  const u = apUsuario(userId);
  const d = u.depositos[depId];
  if (!d || (d.status !== 'pendente' && d.status !== 'aguardando_confirmacao')) return false;
  if (Number.isInteger(valorApiCents) && valorApiCents !== d.valorCents) {
    d.status = 'divergente';
    apSalvar();
    aviso(`[AutoPay] Depósito ${depId} com valor divergente (esperado ${d.valorCents}, API ${valorApiCents}). Não creditado — conferir manualmente.`);
    return false;
  }
  // TRAVA FINAL: com a conferência de saldo ligada, ninguém é creditado sem o saldo da Turbofy ter subido (d.saldoOk).
  if (TF_SALDO_MODO !== 'off' && !d.saldoOk) {
    aviso(`[AutoPay] Depósito ${depId}: crédito RECUSADO — o saldo da Turbofy ainda não comprovou a entrada. Continua pendente.`);
    return false;
  }
  const credito = Number.isInteger(d.creditoCents) && d.creditoCents > 0 ? d.creditoCents : apCreditoDeposito(d.valorCents);
  d.creditoCents = credito;
  d.status = 'pago';
  d.pagoEm = Date.now();
  u.saldoCents += credito;
  u.contagem = (u.contagem || 0) + 1;
  apRegistrarTransacao(u, { id: depId, tipo: 'deposito', valorCents: credito, brutoCents: d.valorCents, status: 'concluido', em: d.pagoEm });
  apSalvar();
  return true;
}
function apReservarSaque(userId, { chave, tipo, valorCents, payload }) {
  const u = apUsuario(userId);
  // Taxa FIXA por saque: o saldo precisa cobrir VALOR + TAXA (ex.: saldo 2,00 e saque 2,00 => negado; 2,05 => ok, sobra 0,00).
  // Verificação e débito acontecem no mesmo trecho síncrono (e dentro do apSerial da carteira): nunca fica saldo negativo.
  const taxa = AP_TAXA_SAQUE_CENTS;
  const total = valorCents + taxa;
  if (!Number.isSafeInteger(valorCents) || valorCents <= 0 || !Number.isSafeInteger(u.saldoCents) || u.saldoCents < total) return null;
  const id = `sq_${crypto.randomBytes(8).toString('hex')}`;
  payload.items[0].referenceId = id;
  payload.metadata = { carteira: u.carteira, saqueId: id };
  payload.idempotencyKey = `autopay-${u.carteira}-${id}`;
  const s = {
    id, valorCents, taxaCents: taxa, chave, tipo, status: 'enviando',
    payload, batchId: null, tentativas: 0, ultimaTentativa: 0, criadoEm: Date.now()
  };
  u.saldoCents -= total;
  u.contagem = (u.contagem || 0) + 1;
  u.saques[id] = s;
  apRegistrarTransacao(u, { id, tipo: 'saque', valorCents, status: 'processando', em: s.criadoEm });
  apSalvar();
  return s;
}
function apFalharSaque(userId, saqueId, { motivo = '', codigo = '', origem = 'sistema' } = {}) {
  const u = apUsuario(userId);
  const s = u.saques[saqueId];
  if (!s || s.status === 'concluido' || s.status === 'falhou') return s;
  s.status = 'falhou';
  s.motivo = String(motivo || '').slice(0, 200);
  s.codigoErro = codigo;
  s.origemErro = origem;
  s.concluidoEm = Date.now();
  u.saldoCents += s.valorCents + (s.taxaCents || 0);
  u.contagem = Math.max(0, (u.contagem || 0) - 1);
  const t = u.transacoes.find(x => x.id === saqueId);
  if (t) t.status = 'falhou';
  if (origem === 'chave') s.bloqueioMs = apRegistrarErroChave(userId, true);
  else apSalvar();
  return s;
}
function apConcluirSaque(userId, saqueId) {
  const u = apUsuario(userId);
  const s = u.saques[saqueId];
  if (!s || s.status === 'concluido' || s.status === 'falhou') return s;
  s.status = 'concluido';
  s.concluidoEm = Date.now();
  const t = u.transacoes.find(x => x.id === saqueId);
  if (t) t.status = 'concluido';
  u.erros = 0;
  apSalvar();
  return s;
}
const apEnviandoAgora = new Set();
const apNotifSaque = new Map();
const ERROS_SISTEMA_TURBOFY = ['INSUFFICIENT_AVAILABLE_BALANCE', 'PAYOUTS_NOT_ENABLED', 'WITHDRAWAL_FROZEN', 'INVALID_SIGNATURE',
  'INVALID_CREDENTIALS', 'CREDENTIALS_REQUIRED', 'MERCHANT_ID_REQUIRED', 'DUPLICATE_IDEMPOTENCY_KEY'];

let apUltimoAvisoSaldo = 0;
function apAvisarDonoSaldo() {
  const agora = Date.now();
  if (agora - apUltimoAvisoSaldo < 10 * 60 * 1000) return;
  apUltimoAvisoSaldo = agora;
  erro('[AutoPay] ATENÇÃO: a conta Turbofy está sem saldo DISPONÍVEL para pagar os saques. Os saques ficam na fila e saem sozinhos quando houver saldo.');
  // Sem DM: avisa só no canal de logs (dos servidores onde o dono está).
  logEvento('erros', '⚠️ **AutoPay:** a conta Turbofy está sem saldo disponível para pagar saques. Os saques dos usuários ficam na fila e saem sozinhos assim que houver saldo.', DONO_ID).catch(logErro);
}
async function apEnviarSaque(userId, s) {
  if (apEnviandoAgora.has(s.id) || s.status !== 'enviando') return;
  apEnviandoAgora.add(s.id);
  try {
    s.tentativas = (s.tentativas || 0) + 1;
    s.ultimaTentativa = Date.now();
    apSalvar();
    let r, busy = false;
    // registra no livro qualquer entrada que já tenha chegado ANTES do saque debitar o saldo (nada de entrada "escondida" pelo débito)
    if (TF_SALDO_MODO !== 'off') await tfLivroLer(0).catch(() => {});
    for (let t = 1; t <= AP_RETRY_BUSY; t++) {
      await apPace();
      r = await apHttp('POST', '/v1/payouts/batches', s.payload, { assinar: true });
      apUltimoPost = Date.now();
      busy = /BATCH.?BUSY|PAYOUT.?BUSY/i.test(`${r.texto || ''} ${r.erro || ''}`);
      if (!busy) break;
      aviso(`[AutoPay] Saque ${s.id}: Turbofy ocupada (BUSY) — tentativa ${t}/${AP_RETRY_BUSY}.`);
      if (t < AP_RETRY_BUSY) await esperar(1500 + Math.round(Math.random() * 1000));
    }
    if (busy) {
      if (s.tentativas >= AP_MAX_TENTATIVAS_ENVIO) {
        apFalharSaque(userId, s.id, { motivo: 'Sistema de pagamentos ocupado', codigo: 'PAYOUT_BATCH_BUSY', origem: 'sistema' });
      }
      return;
    }
    if ((r.status === 200 || r.status === 201) && r.json && r.json.batchId) {
      s.batchId = r.json.batchId;
      s.status = 'enviado';
      s.aguardandoSaldoDesde = null;
      s.taxaApiCents = Number.isInteger(r.json.totalFeeCents) ? r.json.totalFeeCents : null;
      apSalvar();
      return;
    }
    const { codigo, mensagem, traceId } = apErroApi(r);
    const textoErroBruto = `${codigo} ${mensagem} ${String(r.texto || '')}`;
    if (codigo === 'INSUFFICIENT_AVAILABLE_BALANCE' || /insufficient|saldo|balance/i.test(textoErroBruto)) {
      erro(`[AutoPay] Saque ${s.id}: sem saldo disponível na Turbofy — tentou 1 vez, NÃO vai reenviar. Saldo devolvido ao usuário.`);
      apFalharSaque(userId, s.id, { motivo: 'Sem saldo disponível na conta de pagamentos', codigo: 'INSUFFICIENT_AVAILABLE_BALANCE', origem: 'sistema' });
      return;
    }
    if (r.status === 429) {
      apGlobalBloqueioAte = Date.now() + 60000;
      aviso('[AutoPay] Turbofy respondeu 429 (limite de requisições): pausa de 1 min.');
      return;
    }
    if (r.status >= 400 && r.status < 500) {
      if (codigo === 'INSUFFICIENT_AVAILABLE_BALANCE') {
        erro(`[AutoPay] Saque ${s.id}: Turbofy sem saldo disponível — NÃO reenviado, saldo devolvido ao usuário.`);
        apFalharSaque(userId, s.id, { motivo: 'Sem saldo disponível na conta de pagamentos', codigo, origem: 'sistema' });
        return;
      }
      const textoErro = `${codigo} ${mensagem}`;
      const ehChave = !ERROS_SISTEMA_TURBOFY.includes(codigo) && r.status !== 401 && r.status !== 403 &&
        /(pix.?key|chave).*(inv|not|n[aã]o|incorre|recus|found|exist)|(inv|not).*(pix.?key|chave)|key_not_found|\bdict\b/i.test(textoErro);
      erro(`[AutoPay] Turbofy recusou o saque HTTP ${r.status} • código: ${codigo || '-'} • msg: ${mensagem || '-'}${traceId ? ` • trace ${traceId}` : ''}`);
      erro(`[AutoPay] Corpo da resposta: ${String(r.texto || '').slice(0, 600)}`);
      erro(`[AutoPay] Payload enviado: ${JSON.stringify(s.payload).slice(0, 600)}`);
      apFalharSaque(userId, s.id, { motivo: mensagem || codigo || `HTTP ${r.status}`, codigo: codigo || `HTTP_${r.status}`, origem: 'sistema' });
      return;
    }
    aviso(`[AutoPay] Saque ${s.id}: resposta incerta (${r.status || r.erro}) — tentativa ${s.tentativas}/${AP_MAX_TENTATIVAS_ENVIO}.`);
    if (s.tentativas >= AP_MAX_TENTATIVAS_ENVIO) {
      s.status = 'revisao';
      apSalvar();
      erro(`[AutoPay] Saque ${s.id} (user ${userId}) em REVISÃO MANUAL: idempotencyKey ${s.payload.idempotencyKey}`);
    }
  } finally {
    apEnviandoAgora.delete(s.id);
  }
}
const APS_OK = ['PAID', 'COMPLETED', 'SETTLED', 'SUCCESS', 'SUCCEEDED', 'DONE'];
const APS_FALHA = ['FAILED', 'REJECTED', 'CANCELLED', 'CANCELED', 'ERROR', 'REFUNDED', 'RETURNED'];
async function apVerificarSaque(userId, s) {
  if (s.status !== 'enviado' || !s.batchId) return;
  const r = await apHttp('GET', `/v1/payouts/batches/${encodeURIComponent(s.batchId)}`, null, { assinar: true });
  if (r.status !== 200 || !r.json) return;
  const j = r.json;
  const item = Array.isArray(j.items) && j.items[0] ? j.items[0] : null;
  const stItem = String(item && item.status || '').toUpperCase();
  const stLote = String(j.status || '').toUpperCase();
  const pago = (j.paidItems || 0) >= 1 || APS_OK.includes(stItem);
  const falhou = !pago && ((j.failedItems || 0) >= 1 || APS_FALHA.includes(stItem) || APS_FALHA.includes(stLote));
  if (pago) {
    if (item && item.id) s.itemId = item.id;
    apConcluirSaque(userId, s.id);
    await apBuscarComprovante(s).catch(logErro);
    apSalvar();
    apLogSaque(userId, s).catch(logErro);
    await apNotificarSaque(userId, s);
  } else if (falhou) {
    const cod = String(item && item.lastErrorCode || '');
    const msg = String(item && item.lastError || 'recusado pelo banco/PSP');
    apFalharSaque(userId, s.id, { motivo: msg, codigo: cod, origem: 'sistema' });
    await apNotificarSaque(userId, s);
  }
}
async function apBuscarComprovante(s) {
  const ids = [s.itemId, s.batchId].filter(Boolean);
  for (const id of ids) {
    const r = await apHttp('GET', `/sellers/saques/${encodeURIComponent(id)}`);
    if (r.status === 200 && r.json && r.json.beneficiary) {
      const b = r.json.beneficiary;
      s.comprovante = {
        nome: b.name || null,
        documento: b.documentMasked || null,
        instituicao: (b.account && b.account.institution) || null,
        e2e: (r.json.tracking && r.json.tracking.endToEndId) || r.json.providerEndToEndId || null,
        saqueId: r.json.id || id
      };
      return;
    }
  }
}
function apResultadoDeSaque(s) {
  if (!s) return { ok: false, codigo: 'indisponivel' };
  if (s.status === 'concluido') return { ok: true, codigo: 'ok', saque: s };
  if (s.status === 'falhou') return { ok: false, codigo: 'falhou', saque: s };
  if (s.status === 'revisao') return { ok: false, codigo: 'revisao', saque: s };
  return { ok: true, codigo: 'pendente', saque: s };
}
async function apNotificarSaque(userId, s) {
  const cb = apNotifSaque.get(s.id);
  if (!cb) return;
  apNotifSaque.delete(s.id);
  try { await cb(apResultadoDeSaque(s)); } catch (eN) { aviso(`[AutoPay] aviso do saque ${s.id} não foi entregue: ${eN.message}`); }
}
async function apAguardarSaque(userId, saqueId, ms) {
  const fim = Date.now() + ms;
  const terminal = s => !s || ['concluido', 'falhou', 'revisao'].includes(s.status);
  for (;;) {
    const s = apUsuario(userId).saques[saqueId];
    if (terminal(s)) return s;
    if (s.status === 'enviado') await apVerificarSaque(userId, s);
    else if (s.status === 'enviando' && Date.now() - s.ultimaTentativa > 4000 && Date.now() >= (s.proximaTentativa || 0)) await apEnviarSaque(userId, s);
    const s2 = apUsuario(userId).saques[saqueId];
    if (terminal(s2) || Date.now() >= fim) return s2;
    await esperar(2500);
  }
}
// Fila GLOBAL de saques: um por vez em todo o sistema.
let apFilaSaqueCadeia = Promise.resolve();
function apExecutarSaque(userId, chaveBruta, valorCents, notificar, tipoForcado) {
  const exec = apFilaSaqueCadeia.then(() => Promise.race([apExecutarSaqueInterno(userId, chaveBruta, valorCents, notificar, tipoForcado), new Promise(r => setTimeout(() => r({ ok: false, codigo: 'indisponivel' }), 80000))]));
  apFilaSaqueCadeia = exec.catch(() => {});
  return exec;
}
async function apExecutarSaqueInterno(userId, chaveBruta, valorCents, notificar, tipoForcado) {
  try {
    if (!apConfigurado()) return { ok: false, codigo: 'indisponivel' };
    const u = apUsuario(userId);
    const agora = Date.now();
    if (agora < (u.bloqueioAte || 0)) return { ok: false, codigo: 'bloqueado', restanteMs: u.bloqueioAte - agora };
    if (agora < apGlobalBloqueioAte) return { ok: false, codigo: 'indisponivel' };
    if (!valorCents || valorCents < AP_MIN_SAQUE_CENTS || valorCents > AP_MAX_CENTS) return { ok: false, codigo: 'valor_invalido' };
    const c = apClassificarChave(chaveBruta, tipoForcado);
    if (!c.ok) {
      return { ok: false, codigo: 'chave_invalida', restanteMs: 0 };
    }
    const payload = {
      idempotencyKey: '', description: 'AutoPay saque', metadata: {},
      items: [{
        pixKey: c.chave, pixKeyType: c.tipo, amountCents: valorCents, recipientName: 'Beneficiario AutoPay', referenceId: ''
      }]
    };
    if (c.tipo === 'CPF' || c.tipo === 'CNPJ') payload.items[0].recipientDocument = c.chave;
    const s = apReservarSaque(userId, { chave: c.chave, tipo: c.tipo, valorCents, payload });
    if (!s) return { ok: false, codigo: 'saldo' };
    await apEnviarSaque(userId, s);
    let fim = await apAguardarSaque(userId, s.id, 20000);
    if (fim && (fim.status === 'enviando' || fim.status === 'enviado')) {
      if (typeof notificar === 'function') {
        apNotifSaque.set(s.id, notificar);
        const de_novo = apUsuario(userId).saques[s.id];
        if (de_novo && ['concluido', 'falhou'].includes(de_novo.status)) await apNotificarSaque(userId, de_novo);
      }
      fim = apUsuario(userId).saques[s.id];
    }
    return apResultadoDeSaque(fim);
  } catch (e) {
    erro(`[AutoPay] Saque [${userId}]: ${e.message}`);
    return { ok: false, codigo: 'indisponivel' };
  }
}
function apTextoSaque(r) {
  const s = r.saque;
  const topo = '# Operação não concluída\n';
  switch (r.codigo) {
    case 'ok': {
      const c = s.comprovante || {};
      const nomeBenef = c.nome || apMascarar(s.chave);
      return `## \`🟢\` Transferência enviada para ${nomeBenef} no valor de ${formatarValor((Number(s.valorCents) || 0) / 100)}`;
    }
    case 'pendente':
      if (s && s.aguardandoSaldoDesde && s.status === 'enviando') {
        return ['# Transferência na fila', '', `**Valor**\n${apMoeda(s.valorCents)}`, '', '**Chave PIX**', `\`${apMascarar(s.chave)}\``, '',
          'Sua transferência está na fila e será enviada automaticamente assim que o saldo for liberado. Você será avisado quando concluir.'].join('\n');
      }
      return ['# Transferência em processamento', '', `**Valor**\n${apMoeda(s.valorCents)}`, '', '**Chave PIX**', `\`${apMascarar(s.chave)}\``, '',
        'O banco ainda está processando. Você será avisado assim que concluir.'].join('\n');
    case 'revisao': return `${topo}Não consegui confirmar se a transferência saiu (ficou em análise manual). **Confira o extrato antes de enviar de novo.**`;
    case 'saldo': return `${topo}Saldo insuficiente na carteira AutoPay. O saque exige o valor + taxa fixa de ${apMoeda(AP_TAXA_SAQUE_CENTS)}.`;
    case 'valor_invalido': return `${topo}Valor inválido. Para saque informe de ${apMoeda(AP_MIN_SAQUE_CENTS)} até ${apMoeda(AP_MAX_CENTS)}.`;
    case 'chave_invalida':
      return `${topo}Chave PIX em formato inválido. Confira e envie de novo.`;
    case 'bloqueado':
      return `${topo}Saques bloqueados temporariamente por chave PIX incorreta. Tente novamente em **${apDuracao(r.restanteMs)}**.`;
    case 'falhou':
      if (s && s.origemErro === 'chave') {
        return `${topo}A chave PIX foi recusada. O valor voltou para sua carteira AutoPay.\nNovos saques liberados em **${apDuracao(s.bloqueioMs || AP_BLOQUEIO_BASE_MS)}**.`;
      }
      if (s && s.codigoErro === 'INSUFFICIENT_AVAILABLE_BALANCE') {
        return `${topo}O sistema de pagamentos está sem saldo disponível no momento e não conseguiu enviar seu saque a tempo. O valor voltou para sua carteira AutoPay — tente de novo mais tarde.`;
      }
      if (s && s.codigoErro === 'INVALID_AMOUNT') {
        return `${topo}A Turbofy recusou o valor do saque${s.motivo ? `: ${s.motivo}` : ''}. O valor voltou para sua carteira AutoPay. Tente um valor maior.`;
      }
      return `${topo}O saque não pôde ser processado${s && s.motivo ? `: ${s.motivo}` : ''}${s && s.codigoErro ? ` (\`${s.codigoErro}\`)` : ''}. O valor voltou para sua carteira AutoPay e você pode tentar de novo.`;
    default:
      return `${topo}AutoPay indisponível no momento. Tente novamente em instantes.`;
  }
}

// ---------- LOGS (canais criados por /criar-logs) ----------
const LOGS_PATH = path.join(__dirname, 'logs.json');
let logsCache = null;
function carregarLogs() {
  if (logsCache) return logsCache;
  try {
    if (fs.existsSync(LOGS_PATH)) {
      const d = JSON.parse(fs.readFileSync(LOGS_PATH, 'utf8'));
      logsCache = d && typeof d === 'object' ? d : {};
      return logsCache;
    }
  } catch (e) { aviso(`logs.json corrompido: ${e.message}`); }
  logsCache = {};
  return logsCache;
}
function salvarLogs(l) {
  logsCache = l;
  fs.writeFileSync(LOGS_PATH, JSON.stringify(l, null, 2), { mode: 0o600 });
}

function canalOuCategoriaEhDeLogs(canal) {
  if (!canal) return false;

  const idsLogs = new Set();

  for (const cfg of Object.values(carregarLogs())) {
    if (!cfg || typeof cfg !== 'object') continue;

    for (const campo of ['geral', 'autopay', 'seguranca', 'erros', 'categoria']) {
      if (cfg[campo]) idsLogs.add(String(cfg[campo]));
    }
  }

  let atual = canal;

  for (let i = 0; i < 4 && atual; i++) {
    if (idsLogs.has(String(atual.id))) return true;

    const parentId = atual.parentId || atual.parent?.id;
    if (parentId && idsLogs.has(String(parentId))) return true;

    atual = atual.parent || null;
  }

  return false;
}
// Envia a mensagem no canal de logs do AutoPay de cada servidor configurado em que o usuário está.
const LOG_MEMBRO_TTL_MS = 2 * 3600 * 1000;
const logMembroCache = new Map();
async function logAutopay(userId, texto) {
  // Só registra em arquivo (nenhuma mensagem no Discord por ação).
  logArquivo('[AUTOPAY] ' + String(texto).replace(/\n/g, ' | '));
}
async function logMembro(guild, userId) {
  const k = guild.id + '|' + userId;
  const c = logMembroCache.get(k);
  if (c && Date.now() - c.t < LOG_MEMBRO_TTL_MS) return c.m;
  const m = (guild.members && guild.members.cache.get(String(userId))) || await guild.members.fetch(userId).catch(() => null);
  logMembroCache.set(k, { t: Date.now(), m: m || null });
  if (logMembroCache.size > 500) logMembroCache.delete(logMembroCache.keys().next().value);
  return m || null;
}
// Sistema de logs completo: envia eventos para os canais configurados (geral/autopay/seguranca/erros)
// em todos os servidores que rodaram /criar-logs. Sempre grava também no arquivo registro.log.
const TIPOS_CANAL_LOG = ['geral', 'autopay', 'seguranca', 'erros'];
async function logEvento(categoria, texto, userId = null) {
  logArquivo(`[DISCORD/${categoria}] ${texto}`);
  try {
    if (!botClient || (categoria !== 'seguranca' && categoria !== 'erros')) return;
    const tipo = TIPOS_CANAL_LOG.includes(categoria) ? categoria : 'geral';
    for (const [guildId, cfg] of Object.entries(carregarLogs())) {
      try {
        const canalId = cfg && (cfg[tipo] || cfg.geral);
        if (!canalId) continue;
        if (userId) {
          const g = botClient.guilds.cache.get(guildId);
          if (!g) continue;
          const membro = await logMembro(g, userId);
          if (!membro) continue;
        }
        const canal = await botClient.channels.fetch(canalId).catch(() => null);
        if (canal && typeof canal.send === 'function') await canal.send({ content: `\`[${categoria}]\` ${emojiTexto(String(texto).slice(0, 1500)).slice(0, 1900)}`, allowedMentions: { parse: [] } });
      } catch {}
    }
  } catch {}
}
// ---- Log decorado (embed) ----
const CORES_LOG = { geral: '#5865F2', autopay: '#57F287', seguranca: '#ED4245', erros: '#ED4245' };
const NOMES_LOG = { geral: '📋 Geral', autopay: '💰 AutoPay', seguranca: '🛡️ Segurança', erros: '🚨 Erros' };
async function logEmbed(categoria, titulo, campos = [], userId = null) {
  const tipo = TIPOS_CANAL_LOG.includes(categoria) ? categoria : 'geral';
  try { logArquivo(`[DISCORD/${tipo}] ${titulo} ${campos.map(c => `${c[0]}: ${c[1]}`).join(' | ')}`); } catch {}
  try {
    if (!botClient || (tipo !== 'seguranca' && tipo !== 'erros')) return;
    const embed = new EmbedBuilder()
      .setColor(CORES_LOG[tipo] || '#5865F2')
      .setTitle(`${NOMES_LOG[tipo]} • ${String(titulo).slice(0, 180)}`)
      .setTimestamp(new Date());
    const camposOk = (campos || []).filter(c => c && c[0] != null && c[1] != null).slice(0, 25);
    if (userId) {
      camposOk.unshift([`${emojiUI('👤')} Usuário`, `<@${userId}>`, false]);
      embed.setFooter({ text: `ID: ${userId}` });
    }
    if (camposOk.length) embed.addFields(camposOk.map(c => ({ name: emojiTexto(String(c[0])).slice(0, 256), value: String(c[1]).slice(0, 1024), inline: !!c[2] })));
    for (const [guildId, cfg] of Object.entries(carregarLogs())) {
      try {
        const canalId = cfg && (cfg[tipo] || cfg.geral);
        if (!canalId) continue;
        if (userId) {
          const g = botClient.guilds.cache.get(guildId);
          if (!g) continue;
          const membro = await logMembro(g, userId);
          if (!membro) continue;
        }
        const canal = await botClient.channels.fetch(canalId).catch(() => null);
        if (canal && typeof canal.send === 'function') await canal.send({ embeds: [embed], allowedMentions: { parse: [] } });
      } catch {}
    }
  } catch {}
}
async function apLogSaque(userId, s) {
  const u = apUsuario(userId);
  const c = s.comprovante || {};
  const dest = c.nome ? `${c.nome}${c.documento ? ` (${c.documento})` : ''}` : apMascarar(s.chave);
  await logAutopay(userId, [
    `Pix enviado por <@${userId}>`,
    `Valor: \`${formatarValor(s.valorCents / 100)}\``,
    `enviado para \`${dest}\``,
    `valor da carteira autopay do <@${userId}>: \`${formatarValor(u.saldoCents / 100)}\``
  ].join('\n'));
}
async function apLogDeposito(userId, dep) {
  const u = apUsuario(userId);
  const credito = Number.isInteger(dep.creditoCents) ? dep.creditoCents : apCreditoDeposito(dep.valorCents);
  await logAutopay(userId, [
    `Depósito recebido de <@${userId}>`,
    `Valor pago: \`${formatarValor(dep.valorCents / 100)}\``,
    `Valor creditado: \`${formatarValor(credito / 100)}\``,
    `valor da carteira autopay do <@${userId}>: \`${formatarValor(u.saldoCents / 100)}\``
  ].join('\n'));
}

// ---------- depósito (cobrança PIX) ----------
const apNotifDep = new Map();
const apCbDep = new Map();
const gpixCanais = new Map();   // dep.id -> canalId onde o /gerarpix enviou a cobrança (para confirmar lá)
// BCS-003: a Turbofy recusa criar cobranças quando a CHAVE PIX cadastrada no painel
// Turbofy não pertence à conta recebedora. Pausa as tentativas (sem spam/rate-limit) e avisa.
let apErroChaveRecebedor = null;
const AP_ERRO_CHAVE_REAVALIA_MS = 20 * 60 * 1000;
function apProblemaChaveRecebedor() {
  if (apErroChaveRecebedor && Date.now() - apErroChaveRecebedor.desde < AP_ERRO_CHAVE_REAVALIA_MS) return apErroChaveRecebedor;
  if (apErroChaveRecebedor) apErroChaveRecebedor = null; // tempo esgotado: tenta de novo (dono pode ter corrigido)
  return null;
}
// ===== Conferência de saldo da Turbofy (só credita se o saldo realmente subiu) =====
// REGRA: um depósito só é creditado quando (1) a Turbofy diz PAID em duas leituras seguidas, com id/ref/valor
// batendo, E (2) o saldo disponível da Turbofy SUBIU de verdade depois que a cobrança foi criada.
// Nunca confirma no "talvez": sem saldo legível, ou saldo que não subiu => continua pendente (e, passados 15 min, 'divergente').
// TURBOFY_SALDO_MODO: estrito (PADRÃO) | aviso | off.   TURBOFY_SALDO_UNIDADE: cents | reais.
// TURBOFY_SALDO_OBRIGATORIO: ligado por padrão (0/false/nao desliga).   TURBOFY_BALANCE_PATH: caminho do saldo (padrão /v1/balance).
const TF_SALDO_MODO = String(process.env.TURBOFY_SALDO_MODO || 'estrito').toLowerCase();
const TF_SALDO_UNIDADE = String(process.env.TURBOFY_SALDO_UNIDADE || '').toLowerCase();
const TF_SALDO_OBRIGATORIO = !/^(0|false|nao|não|off)$/i.test(String(process.env.TURBOFY_SALDO_OBRIGATORIO || '1'));
const TF_TAXA_MAX_PCT = Number(process.env.TURBOFY_TAXA_MAX_PCT || 10);
const TF_SALDO_TIMEOUT_MS = 15 * 60000;
const TF_ENTRADA_VALIDADE_MS = 30 * 60000;
let apSaldoCaminho = process.env.TURBOFY_BALANCE_PATH || '';
let apSaldoIndisponivel = false;
let apSaldoIndisponivelAte = 0;   // falha ao descobrir o endpoint: tenta de novo depois (antes ficava desligado até reiniciar)
async function apSaldoTurbofyCents() {
  if (TF_SALDO_MODO === 'off' || (apSaldoIndisponivel && Date.now() < apSaldoIndisponivelAte)) return null;
  apSaldoIndisponivel = false;
  const caminhos = apSaldoCaminho ? [apSaldoCaminho] : ['/v1/balance', '/sellers/balance', '/sellers/wallet', '/sellers/me/balance', '/balance', '/sellers/saldo'];
  for (const c of caminhos) {
    const r = await apHttp('GET', c, undefined, { timeoutMs: 8000, prioridade: 'urgente' });
    if (r.status === 200 && r.json) {
      const v = extrairSaldoCents(r.json, TF_SALDO_UNIDADE);
      if (Number.isFinite(v)) { if (!apSaldoCaminho) { apSaldoCaminho = c; aviso(`[AutoPay] Endpoint de saldo Turbofy detectado: ${c}`); } return v; }
    }
  }
  if (!apSaldoCaminho) { apSaldoIndisponivel = true; apSaldoIndisponivelAte = Date.now() + 20000; aviso('[AutoPay] Não achei o endpoint de saldo da Turbofy agora — tento de novo em 20s. Se persistir, defina TURBOFY_BALANCE_PATH.'); }
  return null;
}
// ---------- LIVRO DE ENTRADAS (saldo real da Turbofy) ----------
// Cada leitura do saldo disponível é comparada com a anterior: o que SUBIU vira uma "entrada" (com horário).
// Um depósito só pode "gastar" entradas observadas DEPOIS da leitura-base dele (feita após a cobrança ser criada),
// e cada entrada só paga um depósito — dois Pix simultâneos não se confirmam com o mesmo aumento de saldo.
// Queda de saldo (saques, taxas) nunca cria entrada: o erro possível é sempre para o lado seguro (esperar), nunca creditar.
function tfLivro() {
  const db = apCarregar();
  if (!db.livro || typeof db.livro !== 'object') db.livro = { ultimo: null, ultimoEm: 0, entradas: [] };
  if (!Array.isArray(db.livro.entradas)) db.livro.entradas = [];
  return db.livro;
}
let tfLivroCadeia = Promise.resolve();
function tfLivroSerial(fn) {
  const p = tfLivroCadeia.then(() => fn());
  tfLivroCadeia = p.catch(() => {});
  return p;
}
let tfLivroSalvoEm = 0;
// Lê o saldo e registra as entradas. maxIdadeMs: se já houve leitura mais nova que isso, reaproveita.
function tfLivroLer(maxIdadeMs = 0) {
  if (TF_SALDO_MODO === 'off') return Promise.resolve(null);
  return tfLivroSerial(async () => {
    const L = tfLivro();
    if (maxIdadeMs > 0 && typeof L.ultimo === 'number' && Date.now() - L.ultimoEm < maxIdadeMs) return L.ultimo;
    const inicio = Date.now();
    const atual = await apSaldoTurbofyCents();
    if (typeof atual !== 'number') return null;
    const agora = Date.now();
    let mudou = false;
    if (typeof L.ultimo === 'number' && atual > L.ultimo) { L.entradas.push({ cents: atual - L.ultimo, em: agora }); mudou = true; }
    if (typeof L.ultimo === 'number' && atual !== L.ultimo) { try { if (apRegistrarMovimento(L, atual - L.ultimo, L.ultimoEm, agora)) mudou = true; } catch (e) { aviso(`[AutoPay] auditoria de movimento: ${e.message}`); } }
    L.ultimo = atual; L.ultimoEm = agora;
    const antes = L.entradas.length;
    L.entradas = L.entradas.filter(e => e.cents > 0 && agora - e.em < TF_ENTRADA_VALIDADE_MS).slice(-200);
    if (L.entradas.length !== antes) mudou = true;
    // leitura-base: depósitos criados ANTES desta leitura começar só podem usar entradas vistas DEPOIS dela
    try {
      const db = apCarregar();
      for (const u of Object.values(db.usuarios || {})) for (const d of Object.values(u.depositos || {})) {
        if (d.status === 'pendente' && typeof d.livroBaseEm !== 'number' && typeof d.saldoAntesCents !== 'number' && (d.criadoEm || 0) <= inicio) { d.livroBaseEm = agora; mudou = true; }
      }
    } catch {}
    if (mudou || agora - tfLivroSalvoEm > 30000) { tfLivroSalvoEm = agora; try { apSalvar(); } catch (e) { aviso(`[AutoPay] livro de saldo: ${e.message}`); } }
    return atual;
  });
}
// Retorna 'ok' | 'aguardar' | 'divergente' | 'sem_saldo'  ('sem_saldo' só quando a conferência está desligada)
async function apConferirSaldoDeposito(userId, dep) {
  if (TF_SALDO_MODO === 'off') return 'sem_saldo';
  if (dep.saldoOk) return 'ok';
  // A Turbofy cobra 2,5% com MÍNIMO de R$ 0,10: num Pix de R$ 0,57 o saldo sobe só 47 centavos (82%).
  // Por isso o mínimo esperado usa a maior entre a taxa real e a taxa máxima %, com 2 centavos de folga de arredondamento.
  const taxaMaxCents = Math.max(apTaxaTurbofyDeposito(dep.valorCents), Math.floor(dep.valorCents * TF_TAXA_MAX_PCT / 100));
  const minimo = Math.max(1, dep.valorCents - taxaMaxCents - 2);
  const vencido = Date.now() - (dep.criadoEm || 0) > TF_SALDO_TIMEOUT_MS;
  const semLeitura = () => (TF_SALDO_OBRIGATORIO ? (vencido ? 'divergente' : 'aguardar') : 'sem_saldo');
  // Depósito antigo (criado antes do livro): usa a comparação de saldo guardada na criação.
  if (typeof dep.livroBaseEm !== 'number' && typeof dep.saldoAntesCents === 'number') {
    const atual = await apSaldoTurbofyCents();
    if (atual === null) return semLeitura();
    const saquesDesde = Object.values(apUsuario(userId).saques || {}).filter(x => (x.criadoEm || 0) >= (dep.criadoEm || 0) && ['enviando', 'enviado', 'concluido'].includes(x.status)).reduce((a, x) => a + (x.valorCents || 0), 0);
    if (atual - dep.saldoAntesCents + saquesDesde >= minimo) { dep.saldoOk = true; dep.saldoOkEm = Date.now(); apSalvar(); return 'ok'; }
    return vencido ? 'divergente' : 'aguardar';
  }
  const lido = await tfLivroLer(1200);
  if (lido === null) return semLeitura();
  return tfLivroSerial(async () => {
    if (dep.saldoOk) return 'ok';
    if (typeof dep.livroBaseEm !== 'number') return vencido ? 'divergente' : 'aguardar';   // ainda sem leitura-base
    const L = tfLivro();
    const validas = L.entradas.filter(e => e.cents > 0 && e.em > dep.livroBaseEm);
    const soma = validas.reduce((a, e) => a + e.cents, 0);
    if (soma < minimo) return vencido ? 'divergente' : 'aguardar';
    // gasta `minimo` centavos das entradas (as mais antigas primeiro)
    let resta = minimo;
    for (const e of validas) { const t = Math.min(e.cents, resta); e.cents -= t; resta -= t; if (resta <= 0) break; }
    L.entradas = L.entradas.filter(e => e.cents > 0);
    // sem nenhum outro depósito esperando, sobras (diferença de taxa etc.) não ficam disponíveis para ninguém
    try {
      const db = apCarregar();
      const outros = Object.values(db.usuarios || {}).some(u => Object.values(u.depositos || {}).some(d => d !== dep && d.id !== dep.id && d.status === 'pendente'));
      if (!outros) L.entradas = [];
    } catch {}
    dep.saldoOk = true; dep.saldoOkEm = Date.now();
    apSalvar();
    return 'ok';
  });
}
// Mantém o livro atualizado enquanto houver Pix esperando (e uma vez no boot).
let tfLivroTickAtivo = false;
async function tfLivroTick(forcar = false) {
  if (TF_SALDO_MODO === 'off' || tfLivroTickAtivo || !apConfigurado()) return;
  tfLivroTickAtivo = true;
  try {
    let espera = forcar;
    if (!espera) {
      const db = apCarregar();
      espera = Object.values(db.usuarios || {}).some(u => Object.values(u.depositos || {}).some(d => d.status === 'pendente' && d.chargeId));
    }
    if (espera) await tfLivroLer(2000);
  } catch (e) { aviso(`[AutoPay] livro de saldo: ${e.message}`); }
  finally { tfLivroTickAtivo = false; }
}
// ---------- AUDITORIA DO SALDO (por que as carteiras não batem com a Turbofy) ----------
// Cada variação do saldo da Turbofy é comparada com o que o próprio bot fez naquele intervalo (saques, reembolsos, Pix pagos).
// O que sobra sem explicação vira "movimento fora do bot" (retirada manual no painel Turbofy, taxa não informada, entrada direta na chave...).
const tfMovAtribuidos = new Set();
function apRegistrarMovimento(L, delta, de, ate) {
  if (!Array.isArray(L.mov)) L.mov = [];
  const db = apCarregar();
  const ini = (de || ate) - 120000, fim = ate + 2000;
  const dentro = (t) => typeof t === 'number' && t >= ini && t <= fim;
  let registrou = false;
  if (delta < 0) {
    let esperado = 0; const partes = [];
    for (const [uid, u] of Object.entries(db.usuarios || {})) {
      for (const sq of Object.values(u.saques || {})) {
        if (!['enviado', 'concluido'].includes(sq.status) || tfMovAtribuidos.has(sq.id)) continue;
        if (dentro(sq.ultimaTentativa) || dentro(sq.concluidoEm)) {
          tfMovAtribuidos.add(sq.id);
          const fee = Number.isInteger(sq.taxaApiCents) ? sq.taxaApiCents : (sq.taxaCents || 0);
          esperado += (sq.valorCents || 0) + fee; partes.push(`saque ${apMoeda(sq.valorCents)} (+taxa Turbofy ${apMoeda(fee)})`);
        }
      }
      for (const d of Object.values(u.depositos || {})) {
        if (d.status === 'reembolsado' && dentro(d.reembolsadoEm) && !tfMovAtribuidos.has(d.id)) {
          tfMovAtribuidos.add(d.id); esperado += d.valorCents || 0; partes.push(`reembolso ${apMoeda(d.valorCents)}`);
        }
      }
    }
    const resto = -delta - esperado;
    if (resto >= 1) {
      L.mov.push({ tipo: 'saida_fora_do_bot', cents: resto, total: -delta, explicado: esperado, partes, em: ate });
      registrou = true;
    }
  } else if (delta > 0) {
    let temDeposito = false, temSaqueFalho = false;
    for (const u of Object.values(db.usuarios || {})) {
      for (const d of Object.values(u.depositos || {})) {
        if ((d.status === 'pendente' && d.chargeId) || (dentro(d.pagoEm)) || dentro(d.criadoEm)) { temDeposito = true; break; }
      }
      for (const sq of Object.values(u.saques || {})) if (sq.status === 'falhou' && dentro(sq.concluidoEm)) temSaqueFalho = true;
      if (temDeposito) break;
    }
    if (!temDeposito && !temSaqueFalho) {
      L.mov.push({ tipo: 'entrada_fora_do_bot', cents: delta, total: delta, explicado: 0, partes: [], em: ate });
      registrou = true;
    }
  }
  if (L.mov.length) { const corte = ate - 7 * 86400000; L.mov = L.mov.filter(m => m.em >= corte).slice(-100); }
  return registrou;
}
const apFmt = (c) => `${c < 0 ? '-' : ''}${apMoeda(Math.abs(c))}`;
// Monta o diagnóstico completo. dif = Turbofy − carteiras (negativo => carteiras ACIMA do saldo real).
function apAuditarSaldo(dispCents) {
  const db = apCarregar();
  const total = Object.values(db.usuarios || {}).reduce((a, u) => a + (Number(u.saldoCents) || 0), 0);
  const dif = dispCents - total;
  const ef = [];   // efeitos em (Turbofy − carteiras), calculados pelos registros do bot
  const add = (chave, cents, texto) => { if (cents) ef.push({ chave, cents, texto }); };
  let spread = 0, nSpread = 0, taxaDep = 0, nTaxaDep = 0, semTaxaDep = 0;
  let taxaSaque = 0, nTaxaSaque = 0, reemb = 0, nReemb = 0, adds = 0, nAdds = 0, rems = 0, nRems = 0;
  let naoCred = 0, nNaoCred = 0, voo = 0, nVoo = 0, semProva = 0, nSemProva = 0;
  for (const u of Object.values(db.usuarios || {})) {
    for (const d of Object.values(u.depositos || {})) {
      if (d.status === 'pago' || d.status === 'reembolsado' || d.status === 'reembolsando') {
        const cred = Number.isInteger(d.creditoCents) ? d.creditoCents : apCreditoDeposito(d.valorCents);
        spread += (d.valorCents || 0) - cred; nSpread++;
        if (Number.isInteger(d.taxaApiCents)) { taxaDep += d.taxaApiCents; nTaxaDep++; } else semTaxaDep++;
        if (d.status === 'pago' && !d.saldoOk) { semProva += cred; nSemProva++; }
        if (d.status === 'reembolsado') { reemb += (d.valorCents || 0) - (Number(d.reembolsoCredito) || cred); nReemb++; }
      } else if (d.dupDeId && ['divergente', 'aguardando_confirmacao', 'cancelado'].includes(d.status) && d.pagoEm !== undefined) {
        naoCred += d.valorCents || 0; nNaoCred++;
      } else if (d.status === 'divergente') { naoCred += d.valorCents || 0; nNaoCred++; }
    }
    for (const sq of Object.values(u.saques || {})) {
      if (['concluido', 'enviado'].includes(sq.status) && Number.isInteger(sq.taxaApiCents)) {
        const dTaxa = (sq.taxaCents || 0) - sq.taxaApiCents;
        if (dTaxa !== 0) { taxaSaque += dTaxa; nTaxaSaque++; }
      }
      if (sq.status === 'enviando') { voo += (sq.valorCents || 0) + (sq.taxaCents || 0); nVoo++; }
    }
    for (const t of u.transacoes || []) {
      const id = String(t.id || '');
      if (id.startsWith('add_')) { adds += t.valorCents || 0; nAdds++; }
      else if (id.startsWith('rem_') || id.startsWith('remall_')) { rems += t.valorCents || 0; nRems++; }
    }
  }
  add('spread', spread - taxaDep, `Você retém ${apPercentualTexto() === '100%' ? '0%' : `${(100 - AP_CREDITO_DEPOSITO_PERCENT).toString().replace('.', ',')}%`} de cada depósito (${nSpread} depósito(s): +${apMoeda(spread)})${nTaxaDep ? ` menos a taxa que a Turbofy cobrou em ${nTaxaDep} deles (−${apMoeda(taxaDep)})` : ''}. Isso deixa a Turbofy ACIMA das carteiras.`);
  add('taxa_saque', taxaSaque, taxaSaque < 0
    ? `Em ${nTaxaSaque} saque(s) a Turbofy cobrou MAIS do que a taxa que o bot descontou do usuário (diferença de ${apMoeda(-taxaSaque)}) — isso deixa as carteiras ACIMA do saldo real.`
    : `Em ${nTaxaSaque} saque(s) o bot descontou mais taxa do usuário do que a Turbofy cobrou (+${apMoeda(taxaSaque)}).`);
  add('reembolso', -reemb, `${nReemb} reembolso(s): a Turbofy devolveu o valor INTEIRO, mas a carteira só perdeu o crédito (${apPercentualTexto()}). Diferença de ${apMoeda(reemb)} a mais nas carteiras.`);
  add('addsaldo', -adds, `${nAdds} uso(s) de .addsaldo: ${apMoeda(adds)} entraram nas carteiras SEM dinheiro real entrando na Turbofy.`);
  add('remsaldo', rems, `${nRems} uso(s) de .remsaldo/.remsaldoall: ${apMoeda(rems)} saíram das carteiras mas o dinheiro continuou na Turbofy.`);
  add('nao_creditado', naoCred, `${nNaoCred} Pix pago(s) NÃO creditado(s) (divergente/duplicado cancelado): ${apMoeda(naoCred)} estão na Turbofy sem dono nas carteiras.`);
  add('em_voo', voo, `${nVoo} saque(s) ainda na fila (carteira já debitada, Turbofy ainda não pagou): ${apMoeda(voo)}. Some sozinho quando o saque sair.`);
  const explicado = ef.reduce((a, x) => a + x.cents, 0);
  const resto = dif - explicado;
  const L = tfLivro();
  const mov = (L.mov || []).slice(-8);
  const movSaida = (L.mov || []).filter(m => m.tipo === 'saida_fora_do_bot').reduce((a, m) => a + m.cents, 0);
  const movEntrada = (L.mov || []).filter(m => m.tipo === 'entrada_fora_do_bot').reduce((a, m) => a + m.cents, 0);
  return { total, dispCents, dif, ef, explicado, resto, mov, movSaida, movEntrada, semProva, nSemProva, semTaxaDep };
}
function apTextoAuditoria(a, { curto = false } = {}) {
  const L = [];
  const sit = a.dif === 0 ? '✅ O saldo está batendo 100%.'
    : a.dif < 0 ? `⚠️ As carteiras estão **${apFmt(-a.dif)} ACIMA** do saldo real da Turbofy (o bot deve mais do que tem).`
      : `ℹ️ As carteiras estão **${apFmt(a.dif)} ABAIXO** do saldo real da Turbofy (sobra dinheiro na Turbofy).`;
  L.push(`**Turbofy disponível:** ${apMoeda(a.dispCents)}\n**Soma das carteiras:** ${apMoeda(a.total)}\n**Diferença (Turbofy − carteiras):** ${apFmt(a.dif)}\n${sit}`);
  if (a.dif === 0) return L.join('\n');
  const ordem = [...a.ef].sort((x, y) => Math.abs(y.cents) - Math.abs(x.cents));
  if (ordem.length) {
    L.push('**Por que (pelos registros do bot):**\n' + ordem.map(x => `• ${x.cents > 0 ? '🟢 +' : '🔴 −'}${apMoeda(Math.abs(x.cents))} — ${x.texto}`).join('\n'));
  }
  L.push(`**Explicado pelos registros:** ${apFmt(a.explicado)} • **Sem explicação nos registros:** ${apFmt(a.resto)}`);
  if (a.resto !== 0) {
    L.push(a.resto < 0
      ? `**Leitura:** a Turbofy tem **${apFmt(-a.resto)} A MENOS** do que os registros do bot indicam. Normalmente é dinheiro que saiu da conta Turbofy fora do bot (retirada manual do lucro) ou taxa de depósito/saque maior que a registrada.`
      : `**Leitura:** a Turbofy tem **${apFmt(a.resto)} A MAIS** do que os registros indicam. Normalmente é Pix recebido direto na chave, estorno/ajuste da Turbofy ou registro apagado.`);
    const causas = [];
    if (a.movSaida) causas.push(`saídas de dinheiro da Turbofy SEM saque do bot (retirada manual no painel Turbofy, taxa não informada): **${apMoeda(a.movSaida)}** detectadas nos últimos 7 dias`);
    if (a.movEntrada) causas.push(`entradas SEM Pix do bot (Pix direto na chave, estorno, ajuste da Turbofy): **${apMoeda(a.movEntrada)}** nos últimos 7 dias`);
    if (a.semTaxaDep) causas.push(`${a.semTaxaDep} depósito(s) em que a Turbofy não informou a taxa cobrada`);
    if (a.nSemProva) causas.push(`${a.nSemProva} depósito(s) creditados ANTES da trava de saldo (${apMoeda(a.semProva)}) — não dá para provar que o dinheiro entrou`);
    causas.push('registros com mais de 60 dias são apagados, então o histórico antigo não entra na conta');
    L.push('**Possíveis causas do restante:**\n' + causas.map(c => `• ${c}`).join('\n'));
  }
  if (!curto && a.mov.length) {
    L.push('**Últimos movimentos fora do bot:**\n' + a.mov.map(m => `• <t:${Math.floor(m.em / 1000)}:f> — ${m.tipo === 'saida_fora_do_bot' ? '🔴 saída' : '🟢 entrada'} de ${apMoeda(m.cents)}${m.partes && m.partes.length ? ` (além de ${m.partes.join(', ')})` : ''}`).join('\n'));
  }
  return L.join('\n\n');
}
const AP_AVISO_DM_IDS = String(process.env.AUTOPAY_AVISO_DM_IDS || `${DONO_ID},1561570716820967496`).split(/[\s,;]+/).filter(x => /^\d{15,25}$/.test(x));
async function apAvisarDonoDM(texto) {
  if (!botClient) return false;
  let ok = false;
  const partes = []; let atual = '';
  for (const linha of String(texto).split('\n')) { if ((atual + '\n' + linha).length > 1900) { partes.push(atual); atual = linha; } else atual = atual ? `${atual}\n${linha}` : linha; }
  if (atual) partes.push(atual);
  for (const id of [...new Set(AP_AVISO_DM_IDS)]) {
    try {
      const user = await botClient.users.fetch(id);
      for (const parte of partes) await user.send({ content: parte, allowedMentions: { parse: [] } });
      ok = true;
    } catch (e) { aviso(`[AutoPay] não consegui avisar ${id} por DM: ${String(e.message).slice(0, 100)}`); }
  }
  return ok;
}
let apAuditoriaUlt = { dif: null, em: 0 };
async function apAuditoriaPeriodica(disp) {
  try {
    const a = apAuditarSaldo(disp);
    const agora = Date.now();
    if (a.dif >= 0) { apAuditoriaUlt = { dif: a.dif, em: agora }; return; }   // sobra vai sozinha para a carteira do dono: sem aviso
    const mudouMuito = apAuditoriaUlt.dif === null || Math.abs(a.dif - apAuditoriaUlt.dif) >= 5;
    if (a.dif === 0) {
      if (apAuditoriaUlt.dif !== null && apAuditoriaUlt.dif !== 0) { apAuditoriaUlt = { dif: 0, em: agora }; await apAvisarDonoDM('# ✅ Saldo voltou a bater\nAs carteiras e a Turbofy estão iguais de novo.'); }
      return;
    }
    if (!(mudouMuito && agora - apAuditoriaUlt.em >= 10 * 60000) && agora - apAuditoriaUlt.em < 6 * 3600000) return;
    apAuditoriaUlt = { dif: a.dif, em: agora };
    await apAvisarDonoDM(`# 🔎 Auditoria de saldo AutoPay\n${apTextoAuditoria(a)}`);
  } catch (e) { aviso(`[AutoPay] auditoria periódica: ${e.message}`); }
}
async function apCriarDeposito(userId, valorCents, livre = false, rapido = false, rotulo = '') {
  if (!apConfigurado()) return { ok: false, motivo: 'offline' };
  if (Date.now() < apGlobalBloqueioAte) return { ok: false, motivo: 'offline' };
  const problemaChave = apProblemaChaveRecebedor();
  if (problemaChave) {
    if (!problemaChave.avisado) {
      problemaChave.avisado = true;
      erro('[AutoPay] COBRANÇAS PAUSADAS: Turbofy recusando criar Pix (BCS-003). A CHAVE PIX cadastrada no painel Turbofy NÃO pertence à conta recebedora. Corrija no painel Turbofy a chave que pertença à conta que recebe o dinheiro. Reavaliarei em 20 min.');
      logEvento('erros', '🚨 **COBRANÇAS PAUSADAS (BCS-003)**: a chave PIX cadastrada no painel Turbofy NÃO pertence à conta recebedora. Corrija no painel Turbofy. Reavaliação automática em 20 min.').catch(logErro);
    }
    return { ok: false, motivo: 'chave_recebedor' };
  }
  if (!Number.isSafeInteger(valorCents) || valorCents < (livre ? AP_MIN_SAQUE_CENTS : AP_MIN_CENTS)) return { ok: false, motivo: 'minimo' };
  const u = apUsuario(userId);
  const agora = Date.now();
  const pend = Object.values(u.depositos).filter(d => d.status === 'pendente' && (d.expiraEm || 0) + 600000 > agora);
  if (!livre && pend.length >= AP_MAX_DEP_PENDENTES) {
    // Só cancela Pix ABANDONADOS (sem sala esperando, sem PAID provado e com mais de 5 min).
    // Antes cancelava TODOS — inclusive Pix já pagos ainda não verificados, que nunca eram creditados.
    for (const d of pend) {
      if (apCbDep.has(d.id) || apPagoDuasLeituras.has(d.id) || agora - (d.criadoEm || 0) < 5 * 60000) continue;
      d.status = 'cancelado';
    }
    apSalvar();
  }
  if (!livre && agora - (u.ultimoDepositoEm || 0) < 3000) return { ok: false, motivo: 'rapido' };
  u.ultimoDepositoEm = agora;
  const depId = `dp_${crypto.randomBytes(8).toString('hex')}`;
  const externalRef = `autopay-${u.carteira}-${depId}`;
  const expIso = new Date(agora + AP_DEP_EXPIRA_MIN * 60000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const r = await apHttp('POST', '/sellers/pix', {
    amountCents: valorCents,
    description: `AutoPay ${u.carteira.slice(0, 8)} ${rotulo || depId.slice(3, 9)}`,
    externalRef,
    metadata: { carteira: u.carteira, depositoId: depId }
  }, { idem: externalRef, timeoutMs: rapido ? 4000 : 20000, novaConexao: rapido });
  const j = r.json;
  if ((r.status === 201 || r.status === 200) && j && j.id && j.pix && j.pix.copyPaste) {
    const dep = {
      id: depId, chargeId: j.id, valorCents, creditoCents: apCreditoDeposito(valorCents),
      status: 'pendente', copiaCola: j.pix.copyPaste,
      criadoEm: agora, expiraEm: agora + AP_DEP_EXPIRA_MIN * 60000
    };
    u.depositos[depId] = dep;
    apSalvar();
    tfLivroLer(0).catch(logErro);   // leitura-base do saldo: só entradas vistas DEPOIS dela contam para este depósito
    return { ok: true, dep, qrApi: j.pix.qrCode };
  }
  const e = apErroApi(r);
  erro(`[AutoPay] Falha ao criar cobrança de ${apMoeda(valorCents)} (${r.status || r.erro}) ${e.codigo}: ${e.mensagem} | enviado: expiresAt=${expIso} (agora ${new Date().toISOString()}) | ${String(r.texto || '').slice(0, 300)}`);
  const textoErro = `${e.codigo} ${e.mensagem} ${String(r.texto || '')}`;
  if (/BCS-003|n[aã]o pertence|nao pertence|chave.{0,40}(recebedor|conta)|PROVIDER_ERROR/i.test(textoErro)) {
    if (!apErroChaveRecebedor) apErroChaveRecebedor = { desde: Date.now(), avisado: false };
  }
  return { ok: false, motivo: 'api' };
}
// Link do QR para mandar como texto: o Discord baixa e mostra a imagem sozinho (nada é baixado/enviado pelo bot).
// Devolve o link DIRETO da imagem (hospedada pelo próprio bot, igual ao .extrato): /img/<token>.png.
// Nunca devolve link de gerador de QR e nunca anexa arquivo.
async function apLinkQr(qrApi, copiaCola) {
  const buf = await apObterQrBuffer(qrApi, copiaCola);
  const url = buf ? hospedarImagem(buf, 60 * 60 * 1000) : null;
  if (url) return url;
  aviso('[AutoPay] QR sem link direto: o bot ainda não aprendeu o próprio endereço (aguarde o Python conectar). Enviando só o copia e cola.');
  return '';
}
async function apObterQrBuffer(qrApi, copiaCola) {
  try { if (QRCodeLib && copiaCola) return await QRCodeLib.toBuffer(copiaCola, { errorCorrectionLevel: 'M', margin: 2, width: 512 }); }
  catch (e) { aviso(`[AutoPay] QR local falhou: ${e.message}`); }
  try {
    const q = String(qrApi || '').trim();
    if (/^data:image\/\w+;base64,/i.test(q)) return Buffer.from(q.split(',')[1], 'base64');
    if (/^iVBOR[A-Za-z0-9+/=]+$/.test(q)) return Buffer.from(q, 'base64');
    if (/^https?:\/\//i.test(q)) return await baixarImagem(q);
  } catch {}
  return null;
}
function apEmbedMsg(texto, cor, extra = {}) {
  const textoE = emojiTexto(texto);
  const e = new EmbedBuilder().setColor(cor).setDescription((textoE.length <= 4000 ? textoE : String(texto)).slice(0, 4000));
  return { embeds: [e], components: [], ...extra };
}
function apMensagemDeposito(dep, qrBuf) {
  const credito = Number.isInteger(dep.creditoCents) ? dep.creditoCents : apCreditoDeposito(dep.valorCents);
  const texto = [
    '# Depósito criado',
    'Escaneie o QR Code para realizar o pagamento. O saldo será atualizado após a confirmação financeira.',
    '',
    '**Valor a pagar:**',
    apMoeda(dep.valorCents),
    '',
    `**Saldo a receber (${apPercentualTexto()}):**`,
    apMoeda(credito),
    '',
    '**Status:**',
    'Pendente de confirmação',
    '',
    '**Copia e cola:**',
    `\`\`\`${dep.copiaCola}\`\`\``,
    `-# Expira <t:${Math.floor(dep.expiraEm / 1000)}:R>`
  ].join('\n');
  const e = new EmbedBuilder().setColor(COR.pagamentos).setDescription(texto.slice(0, 4000));
  const msg = { embeds: [e], components: [linhaBotoes(btn(`ap_copy:${dep.id}`, 'Copiar pix', ButtonStyle.Secondary, '📋'), btn(`ap_qr:${dep.id}`, 'QR Code', ButtonStyle.Secondary, '📷'))] };
  if (qrBuf) { e.setImage('attachment://qrcode.png'); msg.files = [{ attachment: qrBuf, name: 'qrcode.png' }]; }
  return msg;
}
// Bancos proibidos (pagam extra). ISPB = 8 primeiros dígitos depois do "E" no código E2E do Pix (banco de quem pagou).
const BANCOS_PROIBIDOS = [
  { nome: 'INTER', rx: /\binter\b/i, ispb: '00416968' },
  { nome: 'PICPAY', rx: /pic\s*pay/i, ispb: '22896431' },
  { nome: 'MERCADO PAGO', rx: /mercado\s*pago|mercadopago|mercado\s*livre/i, ispb: '10573521' }
];
const ISPB_NOMES = {
  '00416968': 'INTER', '22896431': 'PICPAY', '10573521': 'MERCADO PAGO', '18236120': 'NUBANK', '60701190': 'ITAÚ',
  '60746948': 'BRADESCO', '00000000': 'BANCO DO BRASIL', '00360305': 'CAIXA', '90400888': 'SANTANDER', '31872495': 'C6 BANK',
  '08561701': 'PAGBANK', '92894922': 'ORIGINAL', '30306294': 'BTG PACTUAL', '01181521': 'SICREDI', '02038232': 'SICOOB',
  '58160789': 'SAFRA', '92702067': 'BANRISUL', '20855875': 'NEON'
};
function apDetectarBanco(pj, e2e) {
  let nome = '';
  let ispb = '';
  const mE2e = String(e2e || '').match(/^E(\d{8})/i);
  if (mE2e) ispb = mE2e[1];
  const rxK = /^(bank_?name|bank|banco|nome_?banco|institution_?name|institution|institui[cç][aã]o|psp_?name|psp|participant_?name|participant|ispb)$/i;
  // Só procura dentro de objetos do PAGADOR (nunca do recebedor), para não confundir com o banco de quem recebe.
  const bruto = apAcharString(pj, rxK, /payer|pagador|debtor|sender|remetente|customer|paid_?by|origin/i);
  if (bruto) {
    if (/^\d{8}$/.test(bruto)) { if (!ispb) ispb = bruto; }
    else nome = bruto.toUpperCase().slice(0, 40);
  }
  const mapeado = ISPB_NOMES[ispb] || '';
  const proibido = BANCOS_PROIBIDOS.some(b => (nome && b.rx.test(nome)) || (mapeado && b.rx.test(mapeado)) || (ispb && b.ispb === ispb));
  return { nome: nome || mapeado, ispb, proibido };
}
const apVerificando = new Set();
// ============================================================
// ANTI-DUPLICIDADE DE DEPÓSITO: mesmo valor + mesma pessoa em <5 min
// exige confirmação de quem está pagando antes de creditar.
// ============================================================
const AP_JANELA_DEP_DUP_MS = 5 * 60 * 1000;
const depConfPendentes = new Map();
function apDepMesmaPessoa(a, b) {
  if (a && b && a.jogadorId && b.jogadorId) return String(a.jogadorId) === String(b.jogadorId);
  const n1 = String((a && a.pagador) || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  const n2 = String((b && b.pagador) || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  if (n1 && n2) return n1 === n2;
  return false; // sem identificação confiável da pessoa: não bloqueia
}
function apDepDuplicado(userId, dep) {
  try {
    const u = apUsuario(userId);
    const agora = Date.now();
    for (const d of Object.values(u.depositos || {})) {
      if (!d || d.id === dep.id) continue;
      if (Number(d.valorCents) !== Number(dep.valorCents)) continue;
      if (!['pago', 'aguardando_confirmacao'].includes(d.status)) continue;
      const refTs = d.pagoEm || d.criadoEm || 0;
      if (agora - refTs > AP_JANELA_DEP_DUP_MS) continue;
      if (apDepMesmaPessoa(d, dep)) return d;
    }
  } catch {}
  return null;
}
async function apPedirConfirmacaoDeposito(userId, dep, dup) {
  try {
    // O canal do depósito (mediação) pertence ao selfbot; tenta o client certo.
    const sb = selfbots.get(String(userId));
    let alvo = null;
    if (dep.canalId) {
      const cli = (sb && sb.client) || botClient;
      if (cli && cli.channels && cli.channels.cache) alvo = cli.channels.cache.get(dep.canalId) || null;
      if (!alvo && botClient && botClient.channels && botClient.channels.cache) alvo = botClient.channels.cache.get(dep.canalId) || null;
    }
    const jog = dep.jogadorId ? `<@${dep.jogadorId}>` : 'essa pessoa';
    const texto = [
      '## `🟡` Confirmação de depósito:',
      '',
      `Já existe **outro pagamento de ${apMoeda(dep.valorCents)}** para a mesma pessoa há menos de 5 minutos.`,
      '',
      `### VALOR: \`${(dep.valorCents / 100).toFixed(2).replace('.', ',')}\``,
      '',
      `### PAGADOR: \`${String(dep.pagador || 'não informado').slice(0, 60)}\``,
      '',
      `### RESPONDA ESSA MENSAGEM COM \`sim\` ou \`não\` para creditar ou cancelar${jog === 'essa pessoa' ? '' : ` (${jog})`}`
    ].join('\n');
    const msg = alvo ? await enviarCanal(alvo, texto) : null;
    if (msg && msg.id) {
      depConfPendentes.set(String(msg.id), { userId: String(userId), depId: dep.id, msg, canal: alvo });
      setTimeout(() => {
        const p = depConfPendentes.get(String(msg.id));
        if (!p) return;
        depConfPendentes.delete(String(msg.id));
        editarMsgSegura(p.msg, '`🔴` Confirmação expirada — **nada foi creditado**. Gere/responda o pagamento de novo para tentar novamente.').catch(logErro);
      }, 5 * 60 * 1000);
      aviso(`[AutoPay] ${dep.id}: depósito duplicado (mesmo valor + mesma pessoa em <5 min) — aguardando confirmação do pagador.`);
      return;
    }
    // Sem canal acessível: não credita e avisa no log (revisão manual).
    aviso(`[AutoPay] ${dep.id}: depósito duplicado e SEM canal para confirmar — NÃO creditado. Revisão manual necessária.`);
    logEvento('erros', `🚨 **Depósito duplicado** \`${dep.id}\` de <@${userId}>: mesmo valor (${apMoeda(dep.valorCents)}) + mesma pessoa em <5 min e **sem canal para confirmar** — NÃO creditado.`).catch(logErro);
  } catch (e) { aviso(`[AutoPay] pedir confirmação de depósito: ${e.message}`); }
}
async function apResponderConfirmacaoDeposito(mensagem, userId) {
  const ref = mensagem.reference && (mensagem.reference.messageId || mensagem.reference.message_id);
  if (!ref) return false;
  const pend = depConfPendentes.get(String(ref));
  if (!pend || pend.userId !== String(userId)) return false;
  if (!apAutorEhContaDoUsuario(mensagem, userId)) return false;
  const t = String(mensagem.content || '').trim();
  const sim = /^(?:sim|s|yes|y)[\s.!?]*$/i.test(t);
  const nao = /^(?:n[aã]o|nao|n|no)[\s.!?]*$/i.test(t);
  if (!sim && !nao) return false;
  depConfPendentes.delete(String(ref));
  try {
    const db = apCarregar();
    const u = db.usuarios[pend.userId];
    const d = u && u.depositos[pend.depId];
    if (!d || d.status !== 'aguardando_confirmacao') { try { await editarMsgSegura(pend.msg, '❌ Esse depósito já foi resolvido.'); } catch {} return true; }
    if (sim) {
      const ok = apConfirmarDeposito(pend.userId, pend.depId, Number.isInteger(d.valorCents) ? d.valorCents : null);
      if (ok) {
        sucesso(`[AutoPay] ${pend.depId}: depósito duplicado CONFIRMADO pelo pagador — creditado ${apMoeda(d.creditoCents)} (user ${pend.userId})`);
        const cb = apCbDep.get(d.id);
        if (cb) { apCbDep.delete(d.id); Promise.resolve().then(() => cb.pago(d.pagador || null)).catch(e => aviso(`[AutoPay] confirmação ${d.id}: ${e.message}`)); }
        else await apNotificarDeposito(pend.userId, d);
        try { await editarMsgSegura(pend.msg, '✅ **Confirmado — depósito creditado.**'); } catch {}
      } else {
        try { await editarMsgSegura(pend.msg, '❌ Não consegui creditar (valor divergente?). Confira manualmente.'); } catch {}
      }
    } else {
      d.status = 'cancelado';
      d.notificadoExpirou = true;
      apSalvar();
      const cb = apCbDep.get(d.id);
      if (cb) { apCbDep.delete(d.id); Promise.resolve().then(() => cb.expirou()).catch(logErro); }
      aviso(`[AutoPay] ${pend.depId}: depósito duplicado NÃO confirmado pelo pagador — cancelado, nada creditado.`);
      try { await editarMsgSegura(pend.msg, '❌ **Cancelado — nada foi creditado.**'); } catch {}
    }
    return true;
  } catch (e) { aviso(`[AutoPay] resposta de confirmação de depósito: ${e.message}`); return true; }
}
const apPagoDuasLeituras = new Map();   // dep.id -> { json, em }: PAID já provado em 2 leituras (falta só o saldo)
const apAvisoSaldoTs = new Map();
async function apVerificarDeposito(userId, dep) {
  if (dep.status !== 'pendente' || apVerificando.has(dep.id)) return;
  apVerificando.add(dep.id);
  try { await apVerificarDepositoInterno(userId, dep); }
  finally { apVerificando.delete(dep.id); }
}
async function apVerificarDepositoInterno(userId, dep) {
  if (dep.status !== 'pendente') return;
  const jaProvado = apPagoDuasLeituras.get(dep.id);   // PAID já provado em 2 leituras: só falta o saldo
  let r = jaProvado ? { status: 200, json: jaProvado.json } : await apHttp('GET', `/sellers/pix/${encodeURIComponent(dep.chargeId)}`, undefined, { timeoutMs: 6000 });
  if (r.status === 429) { apFastPausaAte = Date.now() + 4000; return; }
  if (r.status !== 200 || !r.json) return;
  const st = String(r.json.status || '').toUpperCase();
  if (st === 'PAID') {
    // CERTEZA ABSOLUTA, em 3 camadas — qualquer falha => NÃO credita e continua pendente:
    //  1) Turbofy diz PAID em DUAS leituras independentes (1ª e 2ª com conexão nova), com id, referência e valor batendo;
    //  2) o saldo disponível da Turbofy SUBIU de verdade (livro de entradas, uma entrada paga um único depósito);
    //  3) trava final em apConfirmarDeposito (só credita se dep.saldoOk).
    const ja = apPagoDuasLeituras.get(dep.id);
    if (ja) { r = { status: 200, json: ja.json }; }   // já provado como PAID: só falta o saldo (não repete as leituras)
    else {
      const c1 = apConferirPagamento(userId, dep, r.json);
      if (!c1.ok) { apRecusarConfirmacao(userId, dep, c1, r.json); return; }
      const r2 = await apHttp('GET', `/sellers/pix/${encodeURIComponent(dep.chargeId)}`, undefined, { timeoutMs: 6000, novaConexao: true, prioridade: 'urgente' });
      if (r2.status === 429) { apFastPausaAte = Date.now() + 4000; return; }
      if (r2.status !== 200 || !r2.json) { aviso(`[AutoPay] ${dep.id}: Turbofy disse PAID, mas a 2ª leitura falhou (${r2.status || r2.erro || '?'}) — NÃO confirmei; tento de novo.`); return; }
      const c2 = apConferirPagamento(userId, dep, r2.json);
      if (!c2.ok) { apRecusarConfirmacao(userId, dep, c2, r2.json); return; }
      r = r2;
      apPagoDuasLeituras.set(dep.id, { json: r2.json, em: Date.now() });
    }
    if (TF_SALDO_MODO !== 'off') {
      const cs = await apConferirSaldoDeposito(userId, dep);
      if (cs === 'aguardar') {
        if (Date.now() - (apAvisoSaldoTs.get(dep.id) || 0) > 30000) { apAvisoSaldoTs.set(dep.id, Date.now()); info(`[AutoPay] ${dep.id}: Turbofy confirmou PAID — aguardando o saldo subir para creditar.`); }
        return;
      }
      if (cs === 'divergente') {
        if (TF_SALDO_MODO === 'estrito') {
          dep.status = 'divergente'; apSalvar();
          apPagoDuasLeituras.delete(dep.id);
          erro(`[AutoPay] ${dep.id}: Turbofy diz PAID mas o saldo NÃO subiu em 15 min — NÃO creditado (user ${userId}).`);
          logEvento('erros', `🚨 **Depósito divergente** \`${dep.id}\` de <@${userId}>: Turbofy diz PAID, mas o saldo não subiu. NÃO creditado — confira manualmente.`).catch(logErro);
          return;
        }
        aviso(`[AutoPay] ${dep.id}: saldo da Turbofy não subiu (modo aviso) — creditando mesmo assim.`);
        dep.saldoOk = true; dep.saldoOkEm = Date.now(); apSalvar();
      } else if (cs === 'sem_saldo' && !dep.saldoOk) {
        // só acontece com TURBOFY_SALDO_OBRIGATORIO=0 e saldo ilegível: libera conscientemente
        aviso(`[AutoPay] ${dep.id}: saldo da Turbofy ilegível e conferência NÃO obrigatória — creditando só com o PAID duplo.`);
        dep.saldoOk = true; dep.saldoOkEm = Date.now(); apSalvar();
      }
    }
    const dup = apDepDuplicado(userId, dep);
    if (dup) {
      dep.status = 'aguardando_confirmacao';
      dep.dupDeId = dup.id;
      dep.dupDeEm = Date.now();
      apSalvar();
      apPagoDuasLeituras.delete(dep.id);
      await apPedirConfirmacaoDeposito(userId, dep, dup);
      return;
    }
    if (apConfirmarDeposito(userId, dep.id, Number.isInteger(r.json.amountCents) ? r.json.amountCents : null)) {
      apPagoDuasLeituras.delete(dep.id);
      sucesso(`[AutoPay] Depósito confirmado — pago ${apMoeda(dep.valorCents)} • creditado ${apMoeda(dep.creditoCents)} (user ${userId})`);
      let nomePag = '';
      try {
        const pj = r.json || {};
        const cand = [
          pj.payer && pj.payer.name, pj.payerName, pj.payer_name, pj.payer && pj.payer.fullName,
          pj.customer && pj.customer.name, pj.pix && pj.pix.payerName, pj.pix && pj.pix.payer && pj.pix.payer.name,
          pj.paidBy && pj.paidBy.name, pj.debtor && pj.debtor.name, pj.sender && pj.sender.name
        ];
        nomePag = String(cand.find(x => typeof x === 'string' && x.trim()) || '').trim().slice(0, 80);
        if (!nomePag) {
          // Busca recursiva: qualquer "name/nome" dentro de um objeto de pagador/remetente/cliente.
          const achado = apAcharString(pj, /^(name|nome|full_?name|fullname|payer_?name)$/i, /payer|pagador|debtor|sender|remetente|customer|paid_?by|origin/i);
          if (achado && nomeEhPessoa(achado)) nomePag = achado.slice(0, 80);
        }
        try {   // taxa que a Turbofy cobrou neste depósito (se informar) — usada na auditoria de saldo
          const num = (o, rx, prof = 0) => { if (!o || typeof o !== 'object' || prof > 3) return null; for (const [k, v] of Object.entries(o)) { if (typeof v === 'number' && rx.test(k)) return v; } for (const v of Object.values(o)) { const r = num(v, rx, prof + 1); if (r !== null) return r; } return null; };
          const taxa = num(pj, /^(fee|fees|feeCents|totalFeeCents|taxCents|taxaCents)$/i);
          const liq = num(pj, /^(netAmountCents|netCents|liquidCents|netAmount)$/i);
          if (Number.isInteger(taxa) && taxa >= 0 && taxa <= dep.valorCents) dep.taxaApiCents = taxa;
          else if (Number.isInteger(liq) && liq > 0 && liq <= dep.valorCents) dep.taxaApiCents = dep.valorCents - liq;
        } catch {}
        const e2e = apAcharString(pj, /end_?to_?end|^e2e/i);
        if (e2e) dep.e2e = e2e;
        const tr = apUsuario(userId).transacoes.find(x => x.id === dep.id);
        if (tr && nomePag) tr.nome = nomePag;
        if (nomePag) dep.pagador = nomePag;   // usado pelo .reembolsar
        try {
          const bk = apDetectarBanco(pj, dep.e2e || e2e);
          if (bk.nome) dep.banco = bk.nome;
          if (bk.proibido) dep.bancoProibido = true;
          if (!bk.nome && dep.grupoId) info(`[AutoPay] Banco do pagador não identificado (E2E ${dep.e2e || e2e || '—'}). Campos: ${JSON.stringify(pj).slice(0, 700)}`);
        } catch {}
        apSalvar();
        if (!nomePag) info(`[AutoPay] Depósito sem nome do pagador na resposta da Turbofy. Campos: ${JSON.stringify(pj).slice(0, 700)}`);
      } catch {}
      apLogDeposito(userId, dep).catch(logErro);
            const cb = apCbDep.get(dep.id);
      // NÃO espera o callback: confirmar/entregar a sala leva tempo e travava a verificação dos outros Pix.
      if (cb) { apCbDep.delete(dep.id); Promise.resolve().then(() => cb.pago(nomePag)).catch(e => aviso(`[AutoPay] confirmação ${dep.id}: ${e.message}`)); }
      else await apNotificarDeposito(userId, dep);
    }
  } else if (['EXPIRED', 'CANCELLED', 'CANCELED'].includes(st)) {
    dep.status = st === 'EXPIRED' ? 'expirado' : 'cancelado';
    apSalvar();
    const cbE = apCbDep.get(dep.id);
    if (cbE) { apCbDep.delete(dep.id); Promise.resolve().then(() => cbE.expirou()).catch(logErro); }
    const i = apNotifDep.get(dep.id);
    apNotifDep.delete(dep.id);
    if (i) { try { await i.editReply({ ...apEmbedMsg('# Depósito expirado\nEste QR Code não está mais válido. Gere um novo depósito pelo painel.', COR.erro), files: [], attachments: [] }); } catch {} }
  }
}
async function apNotificarDeposito(userId, dep) {
  const u = apUsuario(userId);
  const credito = Number.isInteger(dep.creditoCents) ? dep.creditoCents : apCreditoDeposito(dep.valorCents);
  const texto = `# Depósito confirmado\nO pagamento foi confirmado e o saldo foi creditado na sua carteira AutoPay.\n\n**Valor pago:**\n${apMoeda(dep.valorCents)}\n\n**Valor creditado (${apPercentualTexto()}):**\n${apMoeda(credito)}\n\n**Saldo disponivel:**\n${apMoeda(u.saldoCents)}`;
  const i = apNotifDep.get(dep.id);
  apNotifDep.delete(dep.id);
  let enviado = false;
  if (i) { try { await i.editReply({ ...apEmbedMsg(texto, COR.pagamentos), files: [], attachments: [] }); enviado = true; } catch {} }
  if (!enviado) {
    // Sem DM: registra no canal de logs.
    logEmbed('autopay', '💰 Depósito confirmado', [['Usuário', `<@${userId}>`, true], ['Valor pago', apMoeda(dep.valorCents), true], ['Creditado', apMoeda(credito), true]], userId).catch(logErro);
  }
}
async function apVerificarPendentesUsuario(userId) {
  if (!apConfigurado()) return;
  const u = apUsuario(userId);
  for (const d of Object.values(u.depositos)) if (d.status === 'pendente') await apVerificarDeposito(userId, d);
  for (const s of Object.values(u.saques)) if (s.status === 'enviado') await apVerificarSaque(userId, s);
}
// Verificação RÁPIDA dos Pix que estão num canal esperando pagamento (a cada ~1,2s, em paralelo).
let apFastPausaAte = 0;
let apFastAtivo = false;
async function apTickRapido() {
  // Sem trava de lote: um Pix lento (timeout/fila) NÃO segura mais a verificação dos outros.
  // Cada depósito é verificado de forma independente (apVerificando impede duplicar) e o total em andamento é limitado.
  if (!apConfigurado() || Date.now() < apFastPausaAte) return;
  const LIMITE_EM_ANDAMENTO = 16;
  if (apVerificando.size >= LIMITE_EM_ANDAMENTO) return;
  const db = apCarregar();
  const agoraR = Date.now();
  const lote = [];
  for (const [userId, u] of Object.entries(db.usuarios || {})) {
    for (const d of Object.values(u.depositos || {})) {
      // Todo Pix pendente com callback (sala, taxa, carrinho/compra) entra aqui — não depende de canalId.
      if (d.status === 'pendente' && d.chargeId && apCbDep.has(d.id) && !apVerificando.has(d.id)) lote.push([userId, d]);
    }
  }
  // Pix novos: a cada ciclo. 5–20 min: a cada 5s. Mais velhos: a cada 15s (não entopem a fila da Turbofy).
  const intervaloIdeal = d => { const idade = agoraR - (d.criadoEm || 0); return idade < 5 * 60000 ? 0 : idade < 20 * 60000 ? 5000 : 15000; };
  const atraso = d => (agoraR - (d._ultChk || 0)) - intervaloIdeal(d);
  const devidos = lote.filter(([, d]) => atraso(d) >= 0);
  devidos.sort((a, b) => atraso(b[1]) - atraso(a[1]) || (b[1].criadoEm || 0) - (a[1].criadoEm || 0));
  for (const [userId, d] of devidos.slice(0, LIMITE_EM_ANDAMENTO - apVerificando.size)) {
    Object.defineProperty(d, '_ultChk', { value: Date.now(), enumerable: false, writable: true, configurable: true });
    apVerificarDeposito(userId, d).catch(logErro);   // sem await de propósito
  }
}
let apTickAtivo = false;
async function apTick() {
  if (apTickAtivo || !apConfigurado() || Date.now() < apFastPausaAte) return;
  apTickAtivo = true;
  try {
    const db = apCarregar();
    const agora = Date.now();
    for (const userId of Object.keys(db.usuarios)) {
      const u = db.usuarios[userId];
      for (const d of Object.values(u.depositos || {})) {
        if (d.status === 'aguardando_confirmacao' && agora - (d.dupDeEm || d.pagoEm || d.criadoEm || 0) > AP_JANELA_DEP_DUP_MS) {
          d.status = 'cancelado'; d.notificadoExpirou = true; apSalvar();
          const cb = apCbDep.get(d.id);
          if (cb) { apCbDep.delete(d.id); Promise.resolve().then(() => cb.expirou()).catch(logErro); }
          aviso(`[AutoPay] ${d.id}: confirmação de depósito duplicado expirou — cancelado, nada creditado.`);
          continue;
        }
        if (d.status !== 'pendente') continue;
        if (agora - d.criadoEm > 3600 * 1000) {
          // Última conferência ANTES de expirar: Pix pago tarde (ou PAID já provado aguardando o saldo) não pode ser perdido.
          if (apPagoDuasLeituras.has(d.id)) { apVerificarDeposito(userId, d).catch(logErro); continue; }
          if (d.chargeId && !apVerificando.has(d.id)) await apVerificarDeposito(userId, d).catch(e => aviso(`[AutoPay] depósito ${d.id}: ${e.message}`));
          if (d.status !== 'pendente') continue;
          d.status = 'expirado'; apSalvar();
          const cbX = apCbDep.get(d.id);
          if (cbX) { apCbDep.delete(d.id); Promise.resolve().then(() => cbX.expirou()).catch(logErro); }
          continue;
        }
        if (apCbDep.has(d.id) && d.chargeId) continue;   // já monitorado pelo apTickRapido
        // Depósito sem callback (ex.: pelo painel AutoPay): verificação independente, sem esperar o anterior terminar.
        if (apVerificando.has(d.id) || apVerificando.size >= 16) continue;
        { const idadeD = agora - (d.criadoEm || 0); const ivD = idadeD < 5 * 60000 ? 0 : idadeD < 20 * 60000 ? 5000 : 15000;
          if (agora - (d._ultChk || 0) < ivD) continue;
          Object.defineProperty(d, '_ultChk', { value: agora, enumerable: false, writable: true, configurable: true }); }
        apVerificarDeposito(userId, d).catch(e => aviso(`[AutoPay] depósito ${d.id}: ${e.message}`));
      }
      for (const s of Object.values(u.saques || {})) {
        if (s.status === 'enviado') await apVerificarSaque(userId, s).catch(e => aviso(`[AutoPay] saque ${s.id}: ${e.message}`));
        else if (s.status === 'enviando' && agora - (s.ultimaTentativa || 0) > 20000 && agora >= (s.proximaTentativa || 0) && agora >= apGlobalBloqueioAte) {
          await apEnviarSaque(userId, s).catch(e => aviso(`[AutoPay] reenvio ${s.id}: ${e.message}`));
          if (s.status === 'falhou') await apNotificarSaque(userId, s);
        }
      }
    }
  } catch (e) {
    erro(`[AutoPay] ${e.message}`);
  } finally {
    apTickAtivo = false;
  }
}
function apLimparAntigos() {
  try {
    const db = apCarregar();
    const corte = Date.now() - 60 * 24 * 3600 * 1000;
    let mudou = false;
    for (const u of Object.values(db.usuarios)) {
      for (const [id, d] of Object.entries(u.depositos || {})) if (d.status !== 'pendente' && (d.criadoEm || 0) < corte) { delete u.depositos[id]; mudou = true; }
      for (const [id, s] of Object.entries(u.saques || {})) if (['concluido', 'falhou'].includes(s.status) && (s.criadoEm || 0) < corte) { delete u.saques[id]; mudou = true; }
    }
    if (mudou) apSalvar();
  } catch {}
}
function iniciarAutoPay() {
  if (!apConfigurado()) {
    aviso('[AutoPay] TURBOFY_CLIENT_ID / TURBOFY_CLIENT_SECRET não definidos no .env — AutoPay ficará OFFLINE.');
    return;
  }
  if (!QRCodeLib) aviso('[AutoPay] Pacote "qrcode" não instalado (npm i qrcode): o QR Code só aparecerá se a Turbofy devolver a imagem pronta.');
  try {
    const db = apCarregar();
    apLimparAntigos();
    for (const u of Object.values(db.usuarios)) { u.bloqueioAte = 0; u.erros = 0; }
    apSalvar();
  } catch (e) { erro(`[AutoPay] ${e.message}`); return; }
  apRecuperarReembolsos().catch(logErro);
  apRestaurarGruposPix();   // antes do 1º apTick: callbacks de canal religados, sem avisos duplicados
  apAquecer();
  setInterval(() => { apTick().catch(logErro); }, AP_POLL_MS);
  setInterval(() => { apTickRapido().catch(e => aviso(`[AutoPay] tick rápido: ${e.message}`)); }, 1500);
  setInterval(() => { tfLivroTick().catch(logErro); }, 2500);   // mantém o livro de entradas do saldo Turbofy
  setTimeout(() => { tfLivroTick(true).catch(logErro); }, 1500);
  setTimeout(() => { apTick().catch(logErro); }, 3000);
  let _solvAlertaEm = 0, _solvUltimo = '';
  let _sobraDif = 0, _sobraVezes = 0;   // sobra Turbofy → carteira do dono
  setInterval(async () => {
    try {
      const disp = TF_SALDO_MODO !== 'off' ? await tfLivroLer(0) : await apSaldoTurbofyCents();
      if (typeof disp !== 'number') return;
      apAuditoriaPeriodica(disp).catch(logErro);   // explica por DM ao dono por que o saldo não bate
      const db = apCarregar();
      const total = Object.values(db.usuarios || {}).reduce((a, u) => a + (Number(u.saldoCents) || 0), 0);
      const dif = disp - total;
      const fmt = (c) => `${c < 0 ? '-' : ''}${apMoeda(Math.abs(c))}`;
      const linha = `${total}|${disp}`;
      if (linha !== _solvUltimo) { _solvUltimo = linha; info(`[AutoPay] Conferência: carteiras ${fmt(total)} • Turbofy disponível ${fmt(disp)} • diferença ${fmt(dif)}`); }
      // SOBRA: se a soma das carteiras é MENOR que o disponível na Turbofy, o resto vai para a carteira do dono.
      // Só credita quando NÃO há depósito/saque em andamento (senão confundiria dinheiro em trânsito com sobra)
      // e a mesma sobra aparece em 3 conferências seguidas (~60s).
      try {
        const emAndamento = Object.values(db.usuarios || {}).some(x =>
          Object.values(x.depositos || {}).some(d => ['pendente', 'aguardando_confirmacao', 'reembolsando'].includes(d.status)) ||
          Object.values(x.saques || {}).some(sq => !['concluido', 'falhou'].includes(sq.status)));
        if (dif > 0 && !emAndamento) {
          if (_sobraDif === dif) _sobraVezes++; else { _sobraDif = dif; _sobraVezes = 1; }
          if (_sobraVezes >= 3) {
            const dono = apUsuario(DONO_ID_2);
            dono.saldoCents += dif;
            dono.contagem = (dono.contagem || 0) + 1;
            apRegistrarTransacao(dono, {
              id: `sobra_${crypto.randomBytes(6).toString('hex')}`, tipo: 'deposito',
              valorCents: dif, status: 'concluido', em: Date.now(), origem: 'sobra_turbofy'
            });
            apSalvar();
            sucesso(`[AutoPay] Sobra da Turbofy: +${apMoeda(dif)} para a carteira de ${DONO_ID_2} (saldo ${apMoeda(dono.saldoCents)})`);
            logAutopay(DONO_ID_2, `Sobra da Turbofy creditada: **+${apMoeda(dif)}** — carteiras ${fmt(total)} • Turbofy ${fmt(disp)} — novo saldo ${apMoeda(dono.saldoCents)}`).catch(logErro);
            _sobraDif = 0; _sobraVezes = 0;
          }
        } else { _sobraDif = 0; _sobraVezes = 0; }
      } catch (eSobra) { aviso(`[AutoPay] sobra Turbofy: ${eSobra.message}`); }
      if (dif < 0 && Date.now() - _solvAlertaEm > 5 * 60000) {
        _solvAlertaEm = Date.now();
        erro(`[AutoPay] 🚨 Carteiras (${fmt(total)}) acima do saldo disponível na Turbofy (${fmt(disp)}). Faltam ${fmt(-dif)}.`);
        logEvento('erros', `🚨 **Saldo não bate**: soma das carteiras (\`.saldoall\`) = **${fmt(total)}**, disponível na Turbofy = **${fmt(disp)}**. Faltam **${fmt(-dif)}**. Confira depósitos recentes.`).catch(logErro);
      }
    } catch (e) { aviso(`[AutoPay] conferência de saldo: ${e.message}`); }
  }, 30000);
  sucesso(`[AutoPay] Online (TurbofyPay) • crédito de depósito: ${apPercentualTexto()}`);
}

function telaAutoPay(userId, aviso_) {
  const u = apUsuario(userId);
  return painel({
    cor: COR.pagamentos,
    texto: [
      '# AutoPay',
      RODAPE,
      apAtivo() ? '🟢 **AutoPay ativo**' : '🔴 **AutoPay offline**',
      '',
      '**Saldo disponivel**',
      apMoeda(u.saldoCents),
      '',
      '**Carteira**',
      `\`${u.carteira}\``,
      '',
      '**Transacoes**',
      `${u.contagem || 0} registradas`,
      '',
      `-# Depósitos: você recebe ${apPercentualTexto()} do valor pago (o restante é a taxa). Depósito mínimo ${apMoeda(AP_MIN_CENTS)} · envio mínimo ${apMoeda(AP_MIN_SAQUE_CENTS)}.`
    ].join('\n') + linhaAviso(aviso_),
    linhas: [
      menu('ap_menu', 'Selecione uma opção...', [
        { label: 'Depositar', value: 'ap_dep', description: 'Gerar QR Code PIX para adicionar saldo', emoji: '<:1002683209:1557150697424687105>' },
        { label: 'Sacar', value: 'ap_saq', description: 'Enviar PIX a partir do seu saldo AutoPay', emoji: '<:1002683210:1557150593703739472>' }
      ]),
      linhaBotoes(btn('ap_refresh', 'Atualizar', ButtonStyle.Secondary, '<a:1002683760:1558313037188833300>'), botaoVoltar('p_voltar'))
    ]
  });
}

// SEGURANÇA: a mensagem precisa ter sido escrita pela conta do selfbot desta carteira.
// Compara com o ID real da conta do token (sb.user.id), e não com o ID de quem cadastrou no bot,
// porque os dois podem ser diferentes (ex.: token de uma conta alternativa).
function apAutorEhContaDoUsuario(mensagem, userId) {
  const sb = selfbots.get(String(userId));
  if (!sb || !sb.user || !mensagem || !mensagem.author) return false;
  return String(mensagem.author.id) === String(sb.user.id);
}
async function apEnviarCanal(canal, texto) {
  const m = await enviarCanal(canal, texto);
  if (AP_APAGAR_SEG > 0 && m && typeof m.delete === 'function') setTimeout(() => { try { m.delete().catch(logErro); } catch {} }, AP_APAGAR_SEG * 1000);
  return m;
}
function relatorioLucro(userId) {
  const SP = 3 * 3600000; // UTC-3
  const agora = Date.now();
  const d = new Date(agora - SP);
  const inicioDia = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) + SP;
  const dow = (d.getUTCDay() + 6) % 7; // segunda = 0
  const iniSemana = inicioDia - dow * 86400000;
  const iniSemPass = iniSemana - 7 * 86400000;
  const iniOntem = inicioDia - 86400000;
  const ganhoCfg = Number(obterConfigUsuario(userId).ganhoFila) || 0;
  const salas = salasLogListar(userId);   // log permanente de salas (nunca é cortado)
  const fat = e => (e.valor !== null && Number.isFinite(Number(e.valor))) ? Number(e.valor) : ganhoCfg;
  const faixa = (a, b) => {
    const l = salas.filter(e => e.ts >= a && e.ts < b);
    const horas = new Set(l.map(e => Math.floor((e.ts - SP) / 3600000)));
    return { n: l.length, v: l.reduce((s, e) => s + fat(e), 0), h: horas.size, l };
  };
  const hoje = faixa(inicioDia, agora + 1);
  const ontem = faixa(iniOntem, inicioDia);
  const sem = faixa(iniSemana, agora + 1);
  const semP = faixa(iniSemPass, iniSemana);
  const linha = (nome, x) => `${nome}: \`${x.n}\` salas ( R$ \`${x.v.toFixed(2)}\` )`;
  const porHora = new Array(24).fill(0);
  for (const e of hoje.l) porHora[new Date(e.ts - SP).getUTCHours()]++;
  const max = Math.max(1, ...porHora);
  const grafico = porHora
    .map((n, h) => n ? `\`${String(h).padStart(2, '0')}:00\` ${'█'.repeat(Math.max(1, Math.round(n / max * 12)))} \`${n}\`` : null)
    .filter(Boolean).join('\n') || '`sem salas hoje`';
  return [
    '📊 **RELATÓRIO DE LUCRO**',
    '━━━━━━━━━━━━━━━━━━━━━━━━',
    '💰 **Faturamento & Salas**',
    `├ ${linha('Hoje', hoje)}`,
    `├ ${linha('Ontem', ontem)}`,
    `├ ${linha('Esta Semana', sem)}`,
    `└ ${linha('Semana Passada', semP)}`,
    '',
    '⏱️ **Carga Horária**',
    `├ Hoje: \`${hoje.h} Hrs\``,
    `├ Ontem: \`${ontem.h} Hrs\``,
    `├ Esta Semana: \`${sem.h} Hrs\``,
    `└ Semana Passada: \`${semP.h} Hrs\``,
    '',
    '📈 **Gráfico de Hoje:**',
    grafico
  ].join('\n').slice(0, 1990);
}
async function apComandoSaldo(mensagem, userId) {
  try {
    // SEGURANÇA: só mostra a carteira da própria conta emissora.
    if (!apAutorEhContaDoUsuario(mensagem, userId)) return;
    const u = apUsuario(userId);
    await apEnviarCanal(mensagem.channel, `💳 **Saldo AutoPay:** ${apMoeda(u.saldoCents)}\n-# Carteira \`${u.carteira}\``);
  } catch (e) { aviso(`.saldo [${userId}]: ${e.message}`); }
}
async function apComandoSaldoAll(mensagem, userId) {
  try {
    // SEGURANÇA: apenas o dono pode ver o saldo de todas as carteiras.
    if (!ehMeuId(userId)) {
      logEvento('seguranca', `🚨 BLOQUEADO: ${userId} tentou .saldoall (só o dono pode).`).catch(logErro);
      aviso(`[AutoPay] BLOQUEADO: ${userId} tentou .saldoall (só o dono pode).`);
      return;
    }
    const db = apCarregar();
    const linhas = Object.entries(db.usuarios || {})
      .map(([uid, u]) => ({ uid, saldo: Number(u.saldoCents) || 0 }))
      .filter(x => x.saldo >= 1)
      .sort((a, b) => b.saldo - a.saldo)
      .map((x, i) => `${i + 1}. <@${x.uid}> — ${apMoeda(x.saldo)}`)
      .join('\n') || 'Nenhuma carteira cadastrada.';
    const totalCents = Object.values(db.usuarios || {}).reduce((a, u) => a + (Number(u.saldoCents) || 0), 0);
    // Bloco com os saldos de cada pessoa ANTES do último .remsaldoall.
    const snap = db.ultimoRemSaldoAll;
    let blocoAntes = '';
    if (snap && snap.saldos) {
      const quando = new Date(snap.em).toLocaleString('pt-BR');
      const itens = Object.entries(snap.saldos)
        .filter(([, c]) => Number(c) >= 1)
        .sort((a, b) => Number(b[1]) - Number(a[1]))
        .map(([uid, c]) => `- <@${uid}> — ${apMoeda(c)}`)
        .join('\n') || '_nenhum com saldo_';
      blocoAntes = `\n\n**🧹 Saldos antes do último .remsaldoall** (${quando}):\n${itens}`;
    }
    // SEMPRE consulta o saldo REAL da Turbofy na hora — o .saldoall nunca mostra só a soma interna.
    const disp = TF_SALDO_MODO !== 'off' ? await tfLivroLer(0) : await apSaldoTurbofyCents();
    let rodape;
    if (typeof disp === 'number') {
      const dif = disp - totalCents;
      const fmt = (c) => `${c < 0 ? '-' : ''}${apMoeda(Math.abs(c))}`;
      rodape =
        `\n\n**Saldo real na Turbofy:** ${apMoeda(disp)}\n` +
        `**Soma das carteiras:** ${apMoeda(totalCents)}\n` +
        `**Diferença:** ${fmt(dif)}` +
        (dif === 0 ? '\n✅ **Saldo 100% batendo com a Turbofy.**' : `\n⚠️ ${dif < 0 ? '**Carteiras ACIMA** do saldo real' : '**Carteiras ABAIXO** do saldo real'} — confira depósitos/saques recentes.`);
    } else {
      rodape = '\n\n-# ⚠️ Não consegui consultar o saldo real da Turbofy agora (endpoint de saldo indisponível). O total acima é a **soma das carteiras** e pode não bater com o disponível real.';
    }
    await apEnviarCanal(mensagem.channel, `# 📊 Saldo de todos (maior → menor)\n\n${linhas}${blocoAntes}${rodape}`);
    if (typeof disp === 'number' && disp !== totalCents) {
      try { await apEnviarCanal(mensagem.channel, `# 🔎 Por que não bate\n${apTextoAuditoria(apAuditarSaldo(disp))}`); } catch (e) { aviso(`.saldoall auditoria: ${e.message}`); }
    }
  } catch (e) { aviso(`.saldoall [${userId}]: ${e.message}`); }
}
// ============================================================
// .comandos e .extrato
// ============================================================
async function apComandoComandos(mensagem, userId) {
  try {
    if (!apAutorEhContaDoUsuario(mensagem, userId)) return;
    const L = [
      '# 📜 Comandos',
      '',
      '**💳 AutoPay**',
      '`.saldo` — mostra seu saldo',
      '`.extrato` — suas últimas 30 transferências (imagem)',
      '`.pg [chave] [valor]` — saque via PIX',
      '`.reembolsar nome sobrenome` ou `.reembolsar @jogador` — devolve o último Pix pago',
      '',
      '**🎮 Salas e valores**',
      '`+cs`, `+cs2` … `+cs5` (ou `+cs 2`) — cria sala manual (a foto da sala é enviada no chat)',
      '`.go` — inicia a sala (no chat do jogo)',
      '`.v [valor]` — define o valor manualmente',
      '`.rv [valor]` — valor do canal',
      '`.recriar [valor]` — recria o canal',
      '',
      '**🧰 Geral**',
      '`.lucro [zerar]` — lucro acumulado',
      '`.perfil` — abre seu perfil na DM',
      '`.ia [texto]` — pergunta para a IA (ou responda uma foto do placar com `.ia`)',
      '`.comandos` — esta lista',
      '',
      '**👑 Somente dono**',
      '`.saldoall` — saldo de todos',
      '`.addsaldo` / `.remsaldo` — adiciona / remove saldo',
      '`.remsaldoall` — remove saldo de todos',
      '`.semanal` / `.semanaladd` / `.semanalrem`'
    ];
    await apEnviarCanal(mensagem.channel, L.join('\n'));
  } catch (e) { aviso(`.comandos [${userId}]: ${e.message}`); }
}
async function apGerarExtrato(userId) {
  if (!CanvasLib) return null;
  const { createCanvas } = CanvasLib;
  const u = apUsuario(userId);
  const lista = (u.transacoes || []).slice(-30).reverse();
  const W = 720, TOPO = 178, LH = 48, RODAPE = 70;
  const H = TOPO + Math.max(lista.length, 1) * LH + RODAPE;
  const cv = createCanvas(W, H);
  const g = cv.getContext('2d');
  const txt = (t, x, y, size, cor, neg, maxW, al) => {
    let sz = size;
    g.fillStyle = cor; g.textAlign = al || 'left';
    do { g.font = `${neg ? 'bold ' : ''}${sz}px sans-serif`; sz -= 1; }
    while (maxW && g.measureText(String(t)).width > maxW && sz > 10);
    g.fillText(String(t), x, y);
  };
  const rr = (x, y, w, h, r) => {
    g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  };
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#12081F'); grad.addColorStop(1, '#050507');
  g.fillStyle = grad; g.fillRect(0, 0, W, H);
  g.fillStyle = '#9B2FE8'; g.fillRect(0, 0, W, 6);
  txt('EXTRATO AUTOPAY', 36, 62, 34, '#FFFFFF', true, 460, 'left');
  txt(`Últimas ${lista.length} transferências`, 36, 92, 17, '#A99BC7', false, 460, 'left');
  txt('Saldo atual', W - 36, 52, 15, '#A99BC7', false, 200, 'right');
  txt(apMoeda(u.saldoCents), W - 36, 88, 30, '#57F287', true, 230, 'right');
  g.fillStyle = '#2A1B40'; g.fillRect(36, 120, W - 72, 2);
  txt('TIPO / DATA', 36, 154, 13, '#7E6FA0', true, 200, 'left');
  txt('VALOR', W - 36, 154, 13, '#7E6FA0', true, 200, 'right');
  let entrou = 0, saiu = 0, mudouNome = false;
  if (!lista.length) txt('Nenhuma transferência ainda.', W / 2, TOPO + 30, 20, '#A99BC7', false, 600, 'center');
  lista.forEach((t, i) => {
    const y = TOPO + i * LH;
    const dep = t.tipo === 'deposito';
    const ok = t.status === 'concluido';
    const falhou = t.status === 'falhou';
    const cor = falhou ? '#6B6B78' : (dep ? '#57F287' : '#ED4245');
    if (ok) { if (dep) entrou += Number(t.valorCents) || 0; else saiu += Number(t.valorCents) || 0; }
    g.fillStyle = i % 2 ? 'rgba(255,255,255,0.025)' : 'rgba(255,255,255,0.06)';
    rr(24, y, W - 48, LH - 6, 10); g.fill();
    g.fillStyle = cor; rr(24, y, 5, LH - 6, 2); g.fill();
    g.beginPath(); g.arc(58, y + (LH - 6) / 2, 14, 0, Math.PI * 2); g.fillStyle = 'rgba(255,255,255,0.08)'; g.fill();
    txt(dep ? '+' : '−', 58, y + (LH - 6) / 2 + 7, 20, cor, true, 0, 'center');
    const s = (u.saques && u.saques[t.id]) || null;
    const nomeSaque = s && s.comprovante && s.comprovante.nome;
    if (nomeSaque && !t.nome) { t.nome = String(nomeSaque).slice(0, 80); mudouNome = true; }
    const nome = String(t.nome || '').trim();
    const chaveTxt = s && s.chave ? apMascarar(s.chave) : '';
    const titulo = dep
      ? (nome ? `De: ${nome}` : 'Depósito PIX')
      : (nome ? `Para: ${nome}` : `Saque PIX${chaveTxt ? ` · ${chaveTxt}` : ''}`);
    const data = new Date(t.em || Date.now()).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const status = falhou ? 'Falhou (estornado)' : (ok ? 'Concluído' : 'Processando');
    txt(titulo, 84, y + 18, 17, '#FFFFFF', true, 380, 'left');
    txt(`${data} · ${status}${!dep && nome && chaveTxt ? ` · ${chaveTxt}` : ''}`, 84, y + 35, 13, '#A99BC7', false, 380, 'left');
    const valor = `${dep ? '+' : '-'}${apMoeda(t.valorCents)}`;
    txt(valor, W - 40, y + 27, 20, cor, true, 190, 'right');
    if (falhou) {
      const w = g.measureText(valor).width;
      g.fillStyle = cor; g.fillRect(W - 40 - w, y + 21, w, 2);
    }
  });
  if (mudouNome) { try { apSalvar(); } catch {} }
  const yf = TOPO + Math.max(lista.length, 1) * LH + 10;
  g.fillStyle = '#2A1B40'; g.fillRect(36, yf, W - 72, 2);
  txt(`Entradas: +${apMoeda(entrou)}`, 36, yf + 34, 17, '#57F287', true, 320, 'left');
  txt(`Saídas: -${apMoeda(saiu)}`, W - 36, yf + 34, 17, '#ED4245', true, 320, 'right');
  return cv.toBuffer('image/png');
}
async function apComandoExtrato(mensagem, userId) {
  try {
    // SEGURANÇA: só mostra o extrato da própria conta emissora.
    if (!apAutorEhContaDoUsuario(mensagem, userId)) return;
    const donoId = String(mensagem.author.id);
    if (!apCarregar().usuarios[donoId]) { await apEnviarCanal(mensagem.channel, '# 🧾 Extrato AutoPay\nVocê ainda não tem transferências.'); return; }
    const buf = await apGerarExtrato(donoId).catch(e => { aviso(`Extrato (imagem): ${e.message}`); return null; });
    if (buf) {
      await enviarCanal(mensagem.channel, { files: [{ attachment: buf, name: 'extrato.png' }] });
      return;
    }
    const u = apUsuario(donoId);
    const lista = (u.transacoes || []).slice(-30).reverse();
    const linhas = lista.map(t => {
      const dep = t.tipo === 'deposito';
      const data = new Date(t.em || Date.now()).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      return `${dep ? '🟢' : '🔴'} \`${data}\` ${dep ? '+' : '-'}${apMoeda(t.valorCents)} — ${dep ? 'Depósito' : 'Saque'} (${t.status})`;
    }).join('\n') || 'Nenhuma transferência ainda.';
    await apEnviarCanal(mensagem.channel, `# 🧾 Extrato AutoPay\n**Saldo:** ${apMoeda(u.saldoCents)}\n\n${linhas}`);
  } catch (e) { aviso(`.extrato [${userId}]: ${e.message}`); }
}
async function apEnviarComArquivo(canal, texto, buf) {
  const o = { content: texto };
  if (buf) o.files = [{ attachment: buf, name: 'qrcode.png' }];
  return enviarCanal(canal, o);
}
async function apComandoDeposito(mensagem, userId, args) {
  // SEGURANÇA: só a própria conta emissora pode depositar na própria carteira.
  if (!apAutorEhContaDoUsuario(mensagem, userId)) return;
  const canal = mensagem.channel;
  const guildId = guildIdDaMensagem(mensagem);
  try {
    const cents = apParseValor(args);
    if (!apAtivo()) { await apEnviarCanal(canal, '# Operação não concluída\nAutoPay offline no momento.'); return; }
    if (!cents || cents < AP_MIN_SAQUE_CENTS || cents > AP_MAX_CENTS) { await apEnviarCanal(canal, 'Uso: `.d [valor]` — ex.: `.d 1`'); return; }
    await apagarComando(mensagem);
    const gerarRapido = async () => {
      let r = null;
      for (let t = 1; t <= 2; t++) {
        r = await apCriarDeposito(userId, cents, true, true).catch(() => ({ ok: false, motivo: 'erro' }));
        if (r.ok) break;
        await esperar(300);
      }
      return r;
    };
    const rs = await Promise.all([1, 2].map(() => gerarRapido()));
    if (rs.some(r => !r.ok)) {
      for (const r of rs) if (r.ok) { r.dep.status = 'cancelado'; apSalvar(); }
      await apEnviarCanal(canal, '# Operação não concluída\nNão consegui gerar as 2 cobranças agora. Tente novamente.');
      return;
    }
    const grupo = { pagos: 0, fim: false };
    rs.forEach((r, i) => { r.dep.jogadorN = i + 1; r.dep.canalId = canal.id; r.dep.guildId = guildId || null; });
    apSalvar();
    const aoPagar = async (n, nomePag) => {
      grupo.pagos++;
      const quem = nomePag ? ` — pago por **${nomePag}**` : '';
      try { await enviarCanal(canal, `✅ **JOGADOR ${n}/2 — pagamento confirmado (${grupo.pagos}/2).**${quem}`, { delayMs: apDelayMsg() }); } catch {}
      if (grupo.pagos >= 2 && !grupo.fim) {
        grupo.fim = true;
        try {
          const ganho = Number(obterConfigUsuario(userId).ganhoFila) || 0;
          if (ganho > 0) {
            const total = Number(((Number(obterConfigUsuario(userId).lucro) || 0) + ganho).toFixed(2));
            salvarConfigUsuario(userId, { lucro: total });
          }
        } catch {}
        try { await entregarSala(canal, userId, guildId); } catch (e) { aviso(`.d sala: ${e.message}`); }
      }
    };
    const aoExpirar = async n => { try { if (valorEsperadoPorCanal.has(canal.id)) await enviarCanal(canal, `⏰ A cobrança do **JOGADOR ${n}/2** expirou.`, { delayMs: apDelayMsg() }); } catch {} };
    rs.forEach((r, i) => apCbDep.set(r.dep.id, { pago: nomePag => aoPagar(i + 1, nomePag), expirou: () => aoExpirar(i + 1) }));
    for (let i = 0; i < 2; i++) {
      const { dep } = rs[i];
      const textoD = `💳 **JOGADOR ${i + 1}/2** — pague ${apMoeda(dep.valorCents)}\n\`\`\`${dep.copiaCola}\`\`\`\n-# ⚠️ Pague só o código do seu número. Expira <t:${Math.floor(dep.expiraEm / 1000)}:R>`;
      await apEnviarComArquivo(canal, textoD, null);
    }
    sucesso(`[${userId}] .d ${apMoeda(cents)} — 2 cobranças geradas em #${canal.name}`);
  } catch (e) {
    erro(`.d [${userId}]: ${e.message}`);
    tratarErroConta(e, userId);
  }
}
// ============================================================
// .reembolsar nome sobrenome — devolve o ÚLTIMO Pix pago por essa pessoa nesta autopay
// ============================================================
// Caminho da API de estorno da Turbofy ({id} = id da cobrança). A documentação pública da Turbofy não é
// aberta, então o bot tenta os caminhos mais comuns (404/405 = caminho não existe, tenta o próximo) e
// lembra o que funcionou. Para fixar o seu: TURBOFY_REFUND_PATH=/rota/correta/{id}
const REFUND_CAMINHOS = (process.env.TURBOFY_REFUND_PATH
  ? [String(process.env.TURBOFY_REFUND_PATH).trim()]
  : ['/sellers/pix/{id}/refund', '/sellers/pix/{id}/refunds', '/sellers/pix/{id}/reembolso', '/sellers/pix/{id}/estorno']);
let apRefundCaminhoOk = null;
function apNomeDoDeposito(u, d) {
  if (d.pagador) return String(d.pagador);
  const t = (u.transacoes || []).find(x => x.id === d.id);
  return t && t.nome ? String(t.nome) : '';
}
async function apReembolsarPix(dep) {
  const lista = apRefundCaminhoOk ? [apRefundCaminhoOk] : REFUND_CAMINHOS;
  let ultimo = null;
  for (const tpl of lista) {
    const caminho = tpl.replace('{id}', encodeURIComponent(dep.chargeId));
    const r = await apHttp('POST', caminho, { amountCents: dep.valorCents }, { idem: `reembolso-${dep.id}` });
    r.caminho = caminho;
    ultimo = r;
    if ([200, 201, 202].includes(r.status)) { apRefundCaminhoOk = tpl; return r; }
    if (r.status === 404 || r.status === 405) continue;   // caminho inexistente: tenta o próximo
    return r;                                              // existe mas recusou (ou rede): devolve o motivo real
  }
  return ultimo || { status: 0, erro: 'sem caminho de reembolso' };
}
async function apComandoReembolsar(mensagem, userId, args) {
  // SEGURANÇA: só a própria conta emissora mexe na própria autopay.
  if (!apAutorEhContaDoUsuario(mensagem, userId)) return;
  const canal = mensagem.channel;
  try {
    const mMencao = String(args || '').match(/<@!?(\d{5,25})>/);
    const palavras = palavrasDoNome(String(args || '').replace(/<@!?\d+>/g, ' '));
    if (!mMencao && palavras.length < 2) {
      await apEnviarCanal(canal, 'Uso: `.reembolsar nome sobrenome` ou `.reembolsar @jogador`\nex.: `.reembolsar joao silva`');
      return;
    }
    if (!apAtivo()) { await apEnviarCanal(canal, '# Operação não concluída\nAutoPay offline no momento.'); return; }
    const u = apUsuario(userId);
    const pagos = Object.values(u.depositos || {}).filter(d => d.status === 'pago' && d.chargeId)
      .map(d => ({ d, nome: apNomeDoDeposito(u, d) }));
    // @jogador: reembolsa o Pix do código DAQUELE jogador (funciona mesmo se a Turbofy não informar o nome do pagador).
    const achados = mMencao
      ? pagos.filter(x => String(x.d.jogadorId || '') === mMencao[1])
      : pagos.filter(x => { const pw = palavrasDoNome(x.nome); return pw.length && palavras.every(w => pw.includes(w)); });
    if (!achados.length) {
      const recentes = pagos.sort((a, b) => (b.d.pagoEm || 0) - (a.d.pagoEm || 0)).slice(0, 5)
        .map(x => `• ${x.nome || '(sem nome)'}${x.d.jogadorId ? ` · <@${x.d.jogadorId}>` : ''} — ${apMoeda(x.d.valorCents)} — <t:${Math.floor((x.d.pagoEm || Date.now()) / 1000)}:R>`).join('\n');
      const semNome = pagos.length > 0 && pagos.every(x => !x.nome);
      await apEnviarCanal(canal, [
        `❌ Não encontrei nenhum Pix pago por **${String(args).replace(/<@!?\d+>/g, '').trim().slice(0, 60) || 'esse jogador'}** nesta autopay.`,
        semNome ? '⚠️ A Turbofy **não informou o nome dos pagadores** — use `.reembolsar @jogador` (reembolsa o Pix do código dele).' : '',
        recentes ? `**Últimos Pix pagos:**\n${recentes}` : 'Não há Pix pagos registrados nesta autopay.'
      ].filter(Boolean).join('\n'));
      return;
    }
    const distintos = [...new Set(achados.map(x => palavrasDoNome(x.nome).sort().join(' ')))];
    if (!mMencao && distintos.length > 1) {
      const nomes = [...new Set(achados.map(x => x.nome))].slice(0, 6).map(n => `• ${n}`).join('\n');
      await apEnviarCanal(canal, `⚠️ Mais de uma pessoa bate com esse nome. Digite o nome completo:\n${nomes}`);
      return;
    }
    achados.sort((a, b) => (b.d.pagoEm || 0) - (a.d.pagoEm || 0));
    const { d } = achados[0];
    const nome = achados[0].nome || (d.jogadorId ? `jogador ${d.jogadorN || ''}`.trim() : 'pagador');
    const credito = Number.isInteger(d.creditoCents) ? d.creditoCents : apCreditoDeposito(d.valorCents);
    if (u.saldoCents < credito) {
      await apEnviarCanal(canal, `❌ Saldo insuficiente na autopay para reembolsar **${apMoeda(d.valorCents)}** de **${nome}** (saldo: ${apMoeda(u.saldoCents)}).`);
      return;
    }
    // Reserva o valor antes de chamar a API (evita reembolso duplo se o comando for repetido).
    u.saldoCents -= credito;
    d.status = 'reembolsando';
    d.reembolsoCredito = credito;
    apSalvar();
    const r = await apReembolsarPix(d).catch(e => ({ status: 0, erro: e.message }));
    if (!r || !r.status) {
      // Sem resposta (rede/timeout): NÃO sabemos se a Turbofy recebeu. Mantém reservado e repete sozinho
      // com a mesma chave de idempotência (não duplica).
      aviso(`[AutoPay] Reembolso ${d.id}: sem resposta da Turbofy — repetindo em 60s.`);
      setTimeout(() => { apRecuperarReembolsos().catch(logErro); }, 60000);
      await apEnviarCanal(canal, `⏳ A Turbofy não respondeu. O reembolso de **${nome}** ficou reservado e vou tentar de novo sozinho em 1 minuto.`);
      return;
    }
    if (apFinalizarReembolso(u, d, nome, credito, r)) {
      sucesso(`[AutoPay] Reembolso de ${apMoeda(d.valorCents)} para ${nome} (user ${userId})`);
      logAutopay(userId, `↩️ Reembolso de **${apMoeda(d.valorCents)}** para **${nome}** — novo saldo ${apMoeda(u.saldoCents)}`).catch(logErro);
      await apEnviarCanal(canal, `✅ **Reembolso enviado!**\n👤 ${nome}\n💰 ${apMoeda(d.valorCents)}\n🕒 Pix pago <t:${Math.floor((d.pagoEm || Date.now()) / 1000)}:R>\n💳 Saldo atual: ${apMoeda(u.saldoCents)}`);
      return;
    }
    const e = apErroApi(r || {});
    erro(`[AutoPay] Reembolso ${d.id} falhou (HTTP ${r && r.status}) ${e.codigo}: ${e.mensagem} | ${String((r && r.texto) || '').slice(0, 300)}`);
    const motivo = [r && r.status ? `HTTP ${r.status}` : '', e.codigo, e.mensagem].filter(Boolean).join(' • ').slice(0, 300);
    const dica = r && (r.status === 404 || r.status === 405)
      ? '\n-# Nenhum caminho de estorno conhecido respondeu. Defina `TURBOFY_REFUND_PATH` no .env com a rota de estorno da sua conta Turbofy.' : '';
    await apEnviarCanal(canal, `❌ Não consegui reembolsar **${nome}** agora.\n\`${motivo || 'sem detalhe da API'}\`\nO saldo da autopay não foi alterado.${dica}`);
  } catch (e) {
    aviso(`.reembolsar [${userId}]: ${e.message}`);
    tratarErroConta(e, userId);
  }
}
// Fecha um reembolso: sucesso -> marca como reembolsado; falha -> devolve o valor reservado.
function apFinalizarReembolso(u, d, nome, credito, r) {
  if (d.status !== 'reembolsando') return false;   // já resolvido: nunca aplica duas vezes
  if (r && [200, 201, 202].includes(r.status)) {
    d.status = 'reembolsado';
    d.reembolsadoEm = Date.now();
    apRegistrarTransacao(u, { id: `rb_${d.id}`, tipo: 'reembolso', valorCents: credito, status: 'concluido', em: d.reembolsadoEm, nome: String(nome || '').slice(0, 80) });
    apSalvar();
    return true;
  }
  u.saldoCents += credito;
  d.status = 'pago';
  apSalvar();
  return false;
}
// RECUPERAÇÃO: reembolso que ficou "reembolsando" porque o bot caiu no meio. Repete com a MESMA
// chave de idempotência (a Turbofy não duplica) e fecha o reembolso.
async function apRecuperarReembolsos() {
  try {
    const db = apCarregar();
    for (const [userId, u] of Object.entries(db.usuarios || {})) {
      for (const d of Object.values(u.depositos || {})) {
        if (d.status !== 'reembolsando') continue;
        const credito = Number.isInteger(d.reembolsoCredito) ? d.reembolsoCredito : (Number.isInteger(d.creditoCents) ? d.creditoCents : apCreditoDeposito(d.valorCents));
        const nome = apNomeDoDeposito(u, d);
        const r = await apReembolsarPix(d).catch(e => ({ status: 0, erro: e.message }));
        if (!r || !r.status) {
          d.reembolsoTentativas = (d.reembolsoTentativas || 0) + 1; apSalvar();
          if (d.reembolsoTentativas < 6) setTimeout(() => { apRecuperarReembolsos().catch(logErro); }, 120000);
          aviso(`[Recuperação] Reembolso ${d.id}: Turbofy sem resposta (tentativa ${d.reembolsoTentativas}/6) — mantido reservado.`);
          continue;
        }
        const ok = apFinalizarReembolso(u, d, nome, credito, r);
        sucesso(`[Recuperação] Reembolso ${d.id} (${nome || '?'}) ${ok ? 'concluído' : 'não confirmado — valor devolvido à carteira'}.`);
        logAutopay(userId, `🔁 Recuperação: reembolso de **${apMoeda(d.valorCents)}** (${nome || '?'}) ${ok ? 'concluído' : 'não confirmado, saldo devolvido'}.`).catch(logErro);
      }
    }
  } catch (e) { aviso(`[AutoPay] Recuperação de reembolsos: ${e.message}`); }
}
async function apComandoAddSaldo(mensagem, userId, args) {
  try {
    // SEGURANÇA: só o DONO pode adicionar saldo em qualquer carteira.
    if (!ehMeuId(userId)) {
      aviso(`[AutoPay] BLOQUEADO: ${userId} tentou .addsaldo (só o dono pode).`);
      return;
    }
    if (String(mensagem.author.id) !== String(userId)) {
      aviso(`[AutoPay] BLOQUEADO: .addsaldo de ${userId} com autor divergente.`);
      return;
    }
    const texto = String(args || '').trim();
    const mAlvo = texto.match(/<@!?(\d{5,25})>/) || texto.match(/\b(\d{15,25})\b/);
    if (!mAlvo) {
      await apEnviarCanal(mensagem.channel, 'Uso: `.addsaldo @usuario valor` — ex.: `.addsaldo @fulano 10`');
      return;
    }
    const alvoId = mAlvo[1];
    const cents = apParseValor(texto.replace(mAlvo[0], ' ').trim());
    if (!cents) {
      await apEnviarCanal(mensagem.channel, 'Valor inválido. Uso: `.addsaldo @usuario valor` — ex.: `.addsaldo @fulano 10`');
      return;
    }
    const u = apUsuario(alvoId);
    u.saldoCents += cents;
    u.contagem = (u.contagem || 0) + 1;
    apRegistrarTransacao(u, {
      id: `add_${crypto.randomBytes(6).toString('hex')}`, tipo: 'deposito',
      valorCents: cents, status: 'concluido', em: Date.now(), origem: 'addsaldo'
    });
    apSalvar();
    sucesso(`[AutoPay] .addsaldo: +${apMoeda(cents)} para ${alvoId} (saldo ${apMoeda(u.saldoCents)})`);
    logAutopay(alvoId, `Saldo ADICIONADO por <@${userId}>: **+${apMoeda(cents)}** para <@${alvoId}> — novo saldo ${apMoeda(u.saldoCents)}`).catch(logErro);
    await apEnviarCanal(mensagem.channel, `✅ **Saldo adicionado!**\n👤 <@${alvoId}>\n💰 +${apMoeda(cents)}\n💳 Saldo atual: ${apMoeda(u.saldoCents)}`);
  } catch (e) {
    erro(`.addsaldo [${userId}]: ${e.message}`);
  }
}
async function apComandoRemSaldo(mensagem, userId, args) {
  try {
    // SEGURANÇA: só o DONO pode remover saldo de qualquer carteira.
    if (!ehMeuId(userId)) {
      aviso(`[AutoPay] BLOQUEADO: ${userId} tentou .remsaldo (só o dono pode).`);
      return;
    }
    if (String(mensagem.author.id) !== String(userId)) {
      aviso(`[AutoPay] BLOQUEADO: .remsaldo de ${userId} com autor divergente.`);
      return;
    }
    const texto = String(args || '').trim();
    const mAlvo = texto.match(/<@!?(\d{5,25})>/) || texto.match(/\b(\d{15,25})\b/);
    if (!mAlvo) {
      await apEnviarCanal(mensagem.channel, 'Uso: `.remsaldo @usuario valor` — ex.: `.remsaldo @fulano 10`');
      return;
    }
    const alvoId = mAlvo[1];
    const cents = apParseValor(texto.replace(mAlvo[0], ' ').trim());
    if (!cents) {
      await apEnviarCanal(mensagem.channel, 'Valor inválido. Uso: `.remsaldo @usuario valor` — ex.: `.remsaldo @fulano 10`');
      return;
    }
    const u = apUsuario(alvoId);
    if (u.saldoCents < cents) {
      await apEnviarCanal(mensagem.channel, `❌ <@${alvoId}> só tem **${apMoeda(u.saldoCents).replace('R$ ', '').replace('.', ',')}$**, não foi possível remover.`);
      return;
    }
    u.saldoCents -= cents;
    u.contagem = (u.contagem || 0) + 1;
    apRegistrarTransacao(u, {
      id: `rem_${crypto.randomBytes(6).toString('hex')}`, tipo: 'saque',
      valorCents: cents, status: 'concluido', em: Date.now(), origem: 'remsaldo'
    });
    apSalvar();
    sucesso(`[AutoPay] .remsaldo: -${apMoeda(cents)} de ${alvoId} (saldo ${apMoeda(u.saldoCents)})`);
    logEvento('autopay', `💸 **Saldo REMOVIDO** por <@${userId}>: **-${apMoeda(cents)}** de <@${alvoId}> — novo saldo ${apMoeda(u.saldoCents)}`).catch(logErro);
    await apEnviarCanal(mensagem.channel, `✅ **Saldo removido!**\n👤 <@${alvoId}>\n💰 -${apMoeda(cents)}\n💳 Saldo atual: ${apMoeda(u.saldoCents)}`);
  } catch (e) {
    erro(`.remsaldo [${userId}]: ${e.message}`);
  }
}
async function apComandoRemSaldoAll(mensagem, userId, args) {
  try {
    // SEGURANÇA: só o DONO pode remover/zerar o saldo de todas as carteiras.
    if (!ehMeuId(userId)) {
      aviso(`[AutoPay] BLOQUEADO: ${userId} tentou .remsaldoall (só o dono pode).`);
      return;
    }
    if (String(mensagem.author.id) !== String(userId)) {
      aviso(`[AutoPay] BLOQUEADO: .remsaldoall de ${userId} com autor divergente.`);
      return;
    }
    const texto = String(args || '').trim();
    let porCarteira = null;
    if (texto) {
      porCarteira = apParseValor(texto);
      if (!porCarteira) {
        await apEnviarCanal(mensagem.channel, 'Valor inválido. Uso: `.remsaldoall` (zera tudo) ou `.remsaldoall valor` — ex.: `.remsaldoall 10`');
        return;
      }
    }
    const db = apCarregar();
    const agora = Date.now();
    // Guarda como estavam os saldos de TODOS antes de remover (o .saldoall mostra depois).
    const saldosAntes = {};
    for (const [uid, u] of Object.entries(db.usuarios || {})) saldosAntes[uid] = Number(u.saldoCents) || 0;
    db.ultimoRemSaldoAll = { em: agora, porCarteira, saldos: saldosAntes };
    let afetadas = 0;
    let totalRemovido = 0;
    for (const [uid, u] of Object.entries(db.usuarios || {})) {
      const saldoAtual = Number(u.saldoCents) || 0;
      if (saldoAtual <= 0) continue;
      const remover = porCarteira === null ? saldoAtual : Math.min(porCarteira, saldoAtual);
      if (remover <= 0) continue;
      u.saldoCents = saldoAtual - remover;
      u.contagem = (u.contagem || 0) + 1;
      apRegistrarTransacao(u, {
        id: `remall_${crypto.randomBytes(6).toString('hex')}`, tipo: 'saque',
        valorCents: remover, status: 'concluido', em: agora, origem: 'remsaldoall'
      });
      afetadas++;
      totalRemovido += remover;
    }
    if (afetadas === 0) {
      apSalvar(); // mesmo sem remover nada, persiste o snapshot guardado
      await apEnviarCanal(mensagem.channel, '✅ Nenhuma carteira com saldo para remover — tudo já está zerado.');
      return;
    }
    apSalvar();
    sucesso(`[AutoPay] .remsaldoall: -${apMoeda(totalRemovido)} de ${afetadas} carteira(s)`);
    logEvento('autopay', `🧹 **Saldo REMOVIDO de TODOS** por <@${userId}>: **-${apMoeda(totalRemovido)}** em **${afetadas} carteira(s)**${porCarteira === null ? ' (zerado)' : ` (${apMoeda(porCarteira)} de cada)`}`).catch(logErro);
    await apEnviarCanal(mensagem.channel, `✅ **Saldo removido de todos!**\n💳 ${afetadas} carteira(s) afetada(s)\n💰 Total removido: **-${apMoeda(totalRemovido)}**`);
  } catch (e) {
    erro(`.remsaldoall [${userId}]: ${e.message}`);
  }
}
async function apComandoSemanalAdd(mensagem, userId, args) {
  try {
    if (!ehMeuId(userId)) { aviso(`[Keys] BLOQUEADO: ${userId} tentou .semanaladd (só o dono pode).`); return; }
    if (String(mensagem.author.id) !== String(userId)) { aviso(`[Keys] BLOQUEADO: .semanaladd de ${userId} com autor divergente.`); return; }
    const texto = String(args || '').trim();
    const mAlvo = texto.match(/<@!?(\d{5,25})>/) || texto.match(/\b(\d{15,25})\b/);
    if (!mAlvo) { await apEnviarCanal(mensagem.channel, 'Uso: `.semanaladd @usuario dias` — ex.: `.semanaladd @fulano 5`'); return; }
    const alvoId = mAlvo[1];
    const dias = parseInt(String(texto.replace(mAlvo[0], ' ').trim()).replace(/\D/g, ''), 10);
    if (!Number.isFinite(dias) || dias < 1 || dias > 3650) { await apEnviarCanal(mensagem.channel, 'Dias inválidos. Uso: `.semanaladd @usuario dias` — ex.: `.semanaladd @fulano 5`'); return; }
    let rec = keyAtivaDoUsuario(alvoId);
    if (!rec) {
      // Sem key ativa: o bot dá o cargo e ATIVA uma key para a pessoa, vinculada ao servidor onde o comando foi usado
      // (no servidor central 1541560769148362903 a key vale em qualquer servidor).
      const guildCmd = mensagem.guild ? String(mensagem.guild.id) : null;
      const nova = gerarKey(dias, userId);
      const keysN = carregarKeys();
      const recN = keysN[nova.chave];
      recN.usadaPor = String(alvoId);
      recN.usadaEm = Date.now();
      recN.expiraEm = Date.now() + dias * 86400000;
      recN.congeladaEm = null;
      recN.expiradaTratada = false;
      recN.origem = 'semanaladd';
      recN.compraGuildId = guildCmd;
      recN.cargosGuilds = guildCmd ? [guildCmd] : [];
      salvarKeys(keysN);
      sucesso(`[Keys] .semanaladd: key ${recN.chave} ATIVADA para ${alvoId} (${dias} dia(s)) — servidor ${guildCmd || 'DM'}`);
      logKey('Key ATIVADA (.semanaladd)', recN);
      if (guildCmd) await cargosAplicarCompra(guildCmd, alvoId, false);
      const vincN = keyServidorVinculado(recN);
      await apEnviarCanal(mensagem.channel, `✅ **Key ativada!**\n👤 <@${alvoId}>\n🔑 \`${recN.chave}\`\n➕ ${dias} dia(s)\n⏳ Expira: <t:${Math.floor(recN.expiraEm / 1000)}:R>\n${vincN ? `🔒 Vale somente neste servidor (\`${vincN}\`).` : '🌐 Vale em qualquer servidor.'}`);
      return;
    }
    const keys = carregarKeys();
    rec.expiraEm = (rec.expiraEm || Date.now()) + dias * 86400000;
    if (mensagem.guild) rec.cargosGuilds = Array.from(new Set([...(rec.cargosGuilds || []), String(mensagem.guild.id)]));
    salvarKeys(keys);
    sucesso(`[Keys] .semanaladd: +${dias} dia(s) para ${alvoId} — ${rec.chave} expira <t:${Math.floor(rec.expiraEm / 1000)}:R>`);
    logKey('Key ESTENDIDA (.semanaladd)', rec);
    await cargosAplicarCompra(mensagem.guild && mensagem.guild.id, alvoId, false);
    await apEnviarCanal(mensagem.channel, `✅ **Key estendida!**\n👤 <@${alvoId}>\n🔑 \`${rec.chave}\`\n➕ +${dias} dia(s)\n⏳ Expira: <t:${Math.floor(rec.expiraEm / 1000)}:R>`);
  } catch (e) { erro(`.semanaladd [${userId}]: ${e.message}`); }
}
async function apComandoSemanalRem(mensagem, userId, args) {
  try {
    if (!ehMeuId(userId)) { aviso(`[Keys] BLOQUEADO: ${userId} tentou .semanalrem (só o dono pode).`); return; }
    if (String(mensagem.author.id) !== String(userId)) { aviso(`[Keys] BLOQUEADO: .semanalrem de ${userId} com autor divergente.`); return; }
    const texto = String(args || '').trim();
    const mAlvo = texto.match(/<@!?(\d{5,25})>/) || texto.match(/\b(\d{15,25})\b/);
    if (!mAlvo) { await apEnviarCanal(mensagem.channel, 'Uso: `.semanalrem @usuario dias` — ex.: `.semanalrem @fulano 5`'); return; }
    const alvoId = mAlvo[1];
    const dias = parseInt(String(texto.replace(mAlvo[0], ' ').trim()).replace(/\D/g, ''), 10);
    if (!Number.isFinite(dias) || dias < 1 || dias > 3650) { await apEnviarCanal(mensagem.channel, 'Dias inválidos. Uso: `.semanalrem @usuario dias` — ex.: `.semanalrem @fulano 5`'); return; }
    const rec = keyAtivaDoUsuario(alvoId);
    if (!rec) { await apEnviarCanal(mensagem.channel, `❌ <@${alvoId}> não está com nenhuma key ativa.`); return; }
    const keys = carregarKeys();
    rec.expiraEm = Math.max(0, (rec.expiraEm || Date.now()) - dias * 86400000);
    if (rec.expiraEm <= Date.now()) {
      aviso(`?? Key ${rec.chave} expirou (.semanalrem) — excluída e acesso removido de ${alvoId}`);
      logKey('Key EXPIRADA (.semanalrem)', rec);
      desligarUsuario(alvoId);
      cargosRemoverAtivo(rec).catch(logErro);
      delete keys[rec.chave];
      salvarKeys(keys);
      await apEnviarCanal(mensagem.channel, `✅ **Key removida!**\n👤 <@${alvoId}>\n🔑 \`${rec.chave}\`\n➖ -${dias} dia(s)\n⏳ A key expirou e o acesso foi removido.`);
      return;
    }
    salvarKeys(keys);
    sucesso(`[Keys] .semanalrem: -${dias} dia(s) de ${alvoId} — ${rec.chave} expira <t:${Math.floor(rec.expiraEm / 1000)}:R>`);
    logKey('Key REDUZIDA (.semanalrem)', rec);
    await apEnviarCanal(mensagem.channel, `✅ **Key reduzida!**\n👤 <@${alvoId}>\n🔑 \`${rec.chave}\`\n➖ -${dias} dia(s)\n⏳ Expira: <t:${Math.floor(rec.expiraEm / 1000)}:R>`);
  } catch (e) { erro(`.semanalrem [${userId}]: ${e.message}`); }
}
async function apComandoSemanal(mensagem, userId, args) {
  try {
    if (!ehMeuId(userId)) { aviso(`[Keys] BLOQUEADO: ${userId} tentou .semanal (só o dono pode).`); return; }
    if (String(mensagem.author.id) !== String(userId)) { aviso(`[Keys] BLOQUEADO: .semanal de ${userId} com autor divergente.`); return; }
    const texto = String(args || '').trim();
    const mAlvo = texto.match(/<@!?(\d{5,25})>/) || texto.match(/\b(\d{15,25})\b/);
    if (!mAlvo) { await apEnviarCanal(mensagem.channel, 'Uso: `.semanal @usuario` — ex.: `.semanal @fulano`'); return; }
    const alvoId = mAlvo[1];
    const rec = keyAtivaDoUsuario(alvoId);
    if (!rec) { await apEnviarCanal(mensagem.channel, `❌ <@${alvoId}> não está com nenhuma key ativa.`); return; }
    const restante = rec.congeladaEm
      ? `${formatarDuracao(rec.expiraEm - rec.congeladaEm)} (congelada)`
      : formatarDuracao(rec.expiraEm - Date.now());
    await apEnviarCanal(mensagem.channel, `## SEMANAL DE <@${alvoId}>\n**Key:** \`${rec.chave}\` — **${restante}** restantes`);
    sucesso(`[Keys] .semanal consultado para ${alvoId} — restante ${restante}`);
  } catch (e) { erro(`.semanal [${userId}]: ${e.message}`); }
}
async function apComandoValorCanal(mensagem, userId, args, recriar) {
  try {
    const canal = mensagem.channel;
    const nomeCmd = recriar ? '.recriar' : '.rv';
    const cents = apParseValor(String(args || '').trim());
    if (!cents) {
      await enviarCanal(canal, `Uso: \`${nomeCmd} [valor]\` — ex.: \`${nomeCmd} 5\``);
      return;
    }
    const valor = cents / 100;
    valorEsperadoPorCanal.set(canal.id, valor, Date.now());
    registrarAtividadeValor(userId);
    contadorPagamentosPorCanal.set(canal.id, 0);
    limparVerificadosCanal(userId, canal.id);
    pagamentosPendentesPorCanal.delete(canal.id);
    if (recriar) canaisRecriar.add(canal.id); else canaisRecriar.delete(canal.id);
    sucesso(`[${userId}] ${nomeCmd} ${formatarValor(valor)} em #${canal.name}`);
    ultimaInstrucaoPorCanal.delete(`${userId}|${canal.id}`);
    try {
      const depsTodos = Object.values(apUsuario(userId).depositos || {}).filter(d => (d.grupoId || d.taxaDe) && d.canalId === canal.id);
      const depsCanal = depsTodos.filter(d => d.grupoId);
      // Quem já tinha pago no grupo anterior (o .recriar cobra só o outro jogador).
      const maisNovo = depsCanal.reduce((m, d) => (!m || (d.criadoEm || 0) > (m.criadoEm || 0)) ? d : m, null);
      const pagosAnt = new Set();
      if (maisNovo) for (const d of depsCanal) if (d.grupoId === maisNovo.grupoId && d.status === 'pago' && d.notificadoPago && d.jogadorId) pagosAnt.add(String(d.jogadorId));
      jogadoresPagosPorCanal.set(canal.id, pagosAnt);
      for (const d of depsTodos) {
        if (d.status === 'pendente') { d.status = 'cancelado'; d.notificadoExpirou = true; }
        if (d.grupoId) d.substituido = true;   // grupo antigo (qualquer status) não bloqueia o novo
      }
      apSalvar();
    } catch {}
    // Apaga o comando em segundo plano (antes segurava 1s antes de gerar o Pix).
    apagarComando(mensagem).catch(logErro);
    // .rv = 2 Pix • .recriar = 1 Pix
    await enviarInstrucoes(mensagem, userId, valor, '', true, recriar ? 1 : 2);
  } catch (e) {
    erro(`.rv/.recriar [${userId}]: ${e.message}`);
  }
}
// ============================================================
// REGRA: no máximo 1 saque por PESSOA (chave PIX) a cada 5 minutos.
// ============================================================
const PG_JANELA_MESMA_PESSOA_MS = 5 * 60 * 1000;
const PG_PROCESSANDO_MAX_MS = 10 * 60 * 1000;   // saque "em processamento" só bloqueia por até 10 min (um travado não bloqueia para sempre)
const PG_TEXTO_MESMA_PESSOA = '`🔴` VOCE ENVIOU UM PIX PARA ESSA MESMA PESSOA A MENOS DE 5 MINUTOS, DESEJA ENVIAR NOVAMENTE? \n-# RESPONDA ESSA MENSAGEM COM `sim` OU `não` ';
const PG_TEXTO_JA_PROCESSANDO = '## `🔴` JA TEM UM PIX EM PROCESSAMENTO PARA ESSA MESMA PESSOA\n-# Nada foi enviado. Aguarde ele concluir para enviar outro.';
const pgEmAndamento = new Set();
function pgChavePessoa(userId, chaveBruta, tipoForcado) {
  const c = apClassificarChave(chaveBruta, tipoForcado);
  return c && c.ok ? { chave: c.chave, k: `${userId}|${c.chave}` } : null;
}
function pgGuardaMesmaPessoa(userId, chaveBruta, tipoForcado) {
  const id = pgChavePessoa(userId, chaveBruta, tipoForcado);
  if (!id) return { k: null, processando: false, recente: false };
  const agora = Date.now();
  let processando = pgEmAndamento.has(id.k), recente = processando;
  for (const s of Object.values(apUsuario(userId).saques || {})) {
    if (!s || s.chave !== id.chave) continue;
    if ((s.status === 'enviando' || s.status === 'enviado') && agora - (s.criadoEm || 0) < PG_PROCESSANDO_MAX_MS) { processando = true; recente = true; }
    else if (s.status === 'concluido' && agora - (s.concluidoEm || s.criadoEm || 0) < PG_JANELA_MESMA_PESSOA_MS) recente = true;
  }
  return { k: id.k, processando, recente };
}
async function pgComReserva(userId, chaveBruta, tipoForcado, fn) {
  const id = pgChavePessoa(userId, chaveBruta, tipoForcado);
  if (id) pgEmAndamento.add(id.k);
  try { return await fn(); } finally { if (id) pgEmAndamento.delete(id.k); }
}
async function pgPedirConfirmacaoMesmaPessoa(mensagem, userId, { chave, cents, tipoForcado, silencioso }) {
  const msgConf = await enviarCanal(mensagem.channel, PG_TEXTO_MESMA_PESSOA, { semVariar: true });
  if (!msgConf || !msgConf.id) return;
  pgPendentes.set(msgConf.id, { userId: String(userId), chave, cents, tipoForcado, msg: msgConf, canal: mensagem.channel, silencioso: !!silencioso });
  setTimeout(() => {
    const p = pgPendentes.get(msgConf.id);
    if (!p) return;
    pgPendentes.delete(msgConf.id);
    editarMsgSegura(p.msg, PG_TEXTO_CANCELADO).catch(logErro);
  }, 5 * 60 * 1000);
}
async function apComandoPg(mensagem, userId, args) {
  try {
    // SEGURANÇA: o saque só pode sair da carteira da própria conta que enviou o comando.
    if (!apAutorEhContaDoUsuario(mensagem, userId)) {
      logEvento('seguranca', `🚨 BLOQUEADO: tentativa de .pg de <@${userId}> (\`${userId}\`) sem vínculo com a conta emissora.`).catch(logErro);
      aviso(`[AutoPay] BLOQUEADO: .pg de ${userId} sem vínculo com a conta emissora.`);
      return;
    }
    const tokens = String(args || '').replace(/`/g, '').trim().split(/\s+/).filter(Boolean);
    let chaveTxt = null, valorTxt = null, tipoForcado = null;
    const mapaTipo = { celular: 'PHONE', cel: 'PHONE', telefone: 'PHONE', tel: 'PHONE', cpf: 'CPF', cnpj: 'CNPJ', email: 'EMAIL', 'e-mail': 'EMAIL', aleatoria: 'EVP', aleatória: 'EVP', evp: 'EVP' };
    if (tokens.length >= 2) {
      const tt = mapaTipo[String(tokens[tokens.length - 1]).toLowerCase()];
      if (tt && (tokens.length >= 3 || mensagem.reference)) { tipoForcado = tt; tokens.pop(); }
    }
    if (tokens.length >= 2) {
      valorTxt = tokens[tokens.length - 1];
      chaveTxt = tokens.slice(0, -1).join(' ');
    } else if (tokens.length === 1 && mensagem.reference && (mensagem.reference.messageId || mensagem.reference.message_id)) {
      valorTxt = tokens[0];
      let ref = null;
      try { ref = typeof mensagem.fetchReference === 'function' ? await mensagem.fetchReference() : await mensagem.channel.messages.fetch(mensagem.reference.messageId); } catch {}
      const achada = ref ? apExtrairChaveDoTexto(extrairTextoComEmbeds(ref)) : null;
      if (!achada) {
        await apEnviarCanal(mensagem.channel, '# Operação não concluída\nNão encontrei uma chave PIX válida na mensagem respondida.');
        return;
      }
      chaveTxt = achada.chave;
    } else {
      await apEnviarCanal(mensagem.channel, 'Uso: `.pg [chave] [valor]` — ou responda a mensagem da chave com `.pg [valor]`.');
      return;
    }
    const cents = apParseValor(valorTxt);
    // Regra de 5 minutos por pessoa (mesma chave PIX).
    if (cents) {
      const g = pgGuardaMesmaPessoa(userId, chaveTxt, tipoForcado);
      if (g.processando) { await enviarCanal(mensagem.channel, PG_TEXTO_JA_PROCESSANDO, { semVariar: true }); return; }
      if (g.recente) { await pgPedirConfirmacaoMesmaPessoa(mensagem, userId, { chave: chaveTxt, cents, tipoForcado, silencioso: false }); return; }
    }
    // Acima de R$ 4: pede confirmação (responder "sim" ou "não" na mensagem do bot).
    if (cents && cents > PG_CONFIRMAR_ACIMA_CENTS) {
      const valorFmt = (cents / 100).toFixed(2).replace('.', ',');
      const msgConf = await apEnviarCanal(mensagem.channel, [
        '## `🟡` Confirmação de pix AutoPay:',
        '',
        `### VALOR: \`${valorFmt}\``,
        '',
        `### CHAVE PIX: \`${String(chaveTxt).replace(/`/g, '')}\``,
        '',
        '### RESPONDA ESSA MENSAGEM COM `sim` ou `não` para enviar ou cancelar o envio'
      ].join('\n'));
      if (msgConf && msgConf.id) {
        pgPendentes.set(msgConf.id, { userId: String(userId), chave: chaveTxt, cents, tipoForcado, msg: msgConf, canal: mensagem.channel });
        setTimeout(() => {
          const p = pgPendentes.get(msgConf.id);
          if (!p) return;
          pgPendentes.delete(msgConf.id);
          editarMsgSegura(p.msg, PG_TEXTO_CANCELADO).catch(logErro);
        }, 5 * 60 * 1000);
      }
      return;
    }
    // Reação removida (anti-detecção): em vez de reagir com ⏳, o status é
    // informado na própria mensagem de resposta do saque.
    await pgComReserva(userId, chaveTxt, tipoForcado, () => pgExecutar({ canal: mensagem.channel, userId, chave: chaveTxt, cents, tipoForcado, msgEditavel: null }));
  } catch (e) {
    erro(`.pg [${userId}]: ${e.message}`);
    if (!tratarErroConta(e, userId)) {
      try { await enviarCanal(mensagem.channel, `# Operação não concluída\nDeu erro ao processar a transferência: ${String(e.message || e).slice(0, 150)}`, { semVariar: true }); } catch (eE) { aviso(`.pg: não consegui avisar o erro: ${eE.message}`); }
    }
  }
}
// Comando ". [chave] [valor]": mesmo saque do .pg, mas SILENCIOSO — sem comprovante, sem avisos de andamento.
// Só responde "Pix enviado para [nome] no valor de [valor]" (ou o erro, se falhar).
async function apComandoPgSilencioso(mensagem, userId, args) {
  try {
    if (!apAutorEhContaDoUsuario(mensagem, userId)) {
      logEvento('seguranca', `🚨 BLOQUEADO: tentativa de ". chave valor" de <@${userId}> (\`${userId}\`) sem vínculo com a conta emissora.`).catch(logErro);
      return;
    }
    const tokens = String(args || '').replace(/`/g, '').trim().split(/\s+/).filter(Boolean);
    const canal = mensagem.channel;
    let valorTxt, chave;
    if (tokens.length >= 2) {
      valorTxt = tokens[tokens.length - 1];
      chave = tokens.slice(0, -1).join(' ');
    } else if (tokens.length === 1 && mensagem.reference && (mensagem.reference.messageId || mensagem.reference.message_id)) {
      // ". 1.1" respondendo a mensagem da chave PIX: envia para a chave dessa mensagem.
      valorTxt = tokens[0];
      let ref = null;
      try { ref = typeof mensagem.fetchReference === 'function' ? await mensagem.fetchReference() : await canal.messages.fetch(mensagem.reference.messageId); } catch {}
      const achada = ref ? apExtrairChaveDoTexto(extrairTextoComEmbeds(ref)) : null;
      if (!achada) { await enviarCanal(canal, '# Operação não concluída\nNão encontrei uma chave PIX válida na mensagem respondida.', { semVariar: true }); return; }
      chave = achada.chave;
    } else return;
    const cents = apParseValor(valorTxt);
    const fantasma = modoSilencioso(userId);
    if (cents) {
      const g = pgGuardaMesmaPessoa(userId, chave, null);
      info(`[${userId}] ". " guarda 5 min: processando=${g.processando} recente=${g.recente}`);
      if (g.processando) {
        if (fantasma) await enviarResultado(mensagem, '❌', true);
        else await enviarCanal(canal, PG_TEXTO_JA_PROCESSANDO, { semVariar: true });
        return;
      }
      if (g.recente) {
        if (fantasma) { await enviarResultado(mensagem, '❌', true); return; }   // modo fantasma não posta pergunta: não envia e reage ❌
        await pgPedirConfirmacaoMesmaPessoa(mensagem, userId, { chave, cents, tipoForcado: null, silencioso: true });
        return;
      }
    }
    await pgComReserva(userId, chave, null, () => pgExecutarSilencioso({ canal, userId, chave, cents, mensagem }));
  } catch (e) {
    erro(`. [${userId}]: ${e.message}`);
    tratarErroConta(e, userId);
  }
}
// Saque do comando ".": usado direto e também depois do "sim" da confirmação dos 5 minutos.
async function pgExecutarSilencioso({ canal, userId, chave, cents, mensagem }) {
  const fantasma = modoSilencioso(userId);   // modo fantasma: executa o saque sem postar nada, só reage ✅/❌ no comando
  const reagir = emoji => (fantasma && mensagem) ? enviarResultado(mensagem, emoji, true).catch(logErro) : Promise.resolve(false);
  try {
    let msgAvisoPonto = null;
    if (cents && !fantasma) { try { msgAvisoPonto = await enviarCanal(canal, MSG_AP_TRANSFERINDO, { semVariar: true }); } catch (eA) { aviso(`. aviso: ${eA.message}`); } }
    const dizer = texto => fantasma ? Promise.resolve(null) : (msgAvisoPonto ? editarMsgSegura(msgAvisoPonto, texto).then(() => msgAvisoPonto).catch(() => enviarCanal(canal, texto, { semVariar: true })) : enviarCanal(canal, texto, { semVariar: true })).then(m => {
      if (AP_APAGAR_SEG > 0 && m && typeof m.delete === 'function') setTimeout(() => { try { m.delete().catch(logErro); } catch {} }, AP_APAGAR_SEG * 1000);
      return m;
    });
    const textoOk = res => {
      const c = (res.saque && res.saque.comprovante) || {};
      return `Pix enviado para ${c.nome || apMascarar(res.saque.chave)} no valor de ${formatarValor(((res.saque && res.saque.valorCents) || cents) / 100)}`;
    };
    // Saque que ficou pendente e concluiu/falhou depois: avisa só quando terminar.
    const notificar = async res => {
      if (res && res.codigo === 'ok') { await dizer(textoOk(res)); await reagir('✅'); }
      else if (res && res.codigo && res.codigo !== 'pendente') await reagir('❌');
    };
    const r = cents ? await apSerial(userId, () => apExecutarSaque(userId, chave, cents, notificar, null)) : { ok: false, codigo: 'valor_invalido' };
    if (r.codigo === 'ok') { await dizer(textoOk(r)); await reagir('✅'); }
    else if (r.codigo !== 'pendente') { await dizer(apTextoSaque(r)); await reagir('❌'); }
  } catch (e) {
    erro(`. [${userId}]: ${e.message}`);
    await reagir('❌');
    tratarErroConta(e, userId);
  }
}
// Executa o saque. Se vier msgEditavel (mensagem de confirmação), os resultados EDITAM essa mensagem.
const MSG_AP_TRANSFERINDO = '## `🟡` ESTOU ENVIANDO O PIX!';
async function pgExecutar({ canal, userId, chave, cents, tipoForcado, msgEditavel }) {
  let msgAviso = null;
  try {
    if (cents && !msgEditavel) msgAviso = await enviarCanal(canal, MSG_AP_TRANSFERINDO, { semVariar: true });
    else if (cents && msgEditavel) { try { await editarMsgSegura(msgEditavel, MSG_AP_TRANSFERINDO); } catch {} }
  } catch (eT) { aviso(`.pg aviso de transferência: ${eT.message}`); }
  const mostrar = async res => {
    const t = apTextoSaque(res);
    if (msgEditavel) { try { await editarMsgSegura(msgEditavel, t); return; } catch {} }
    if (msgAviso) { try { await editarMsgSegura(msgAviso, t); return; } catch {} }
    await apEnviarCanal(canal, t);
  };
  const notificar = async res => { await mostrar(res); await apEnviarComprovante(res, o => enviarCanal(canal, o)); };
  let r;
  try {
    r = cents ? await apSerial(userId, () => apExecutarSaque(userId, chave, cents, notificar, tipoForcado)) : { ok: false, codigo: 'valor_invalido' };
  } catch (eX) {
    erro(`.pg executar [${userId}]: ${eX.message}`);
    r = { ok: false, codigo: 'indisponivel' };
  }
  await mostrar(r);
  await apEnviarComprovante(r, o => enviarCanal(canal, o));
}
const PG_CONFIRMAR_ACIMA_CENTS = 400;
const PG_TEXTO_CANCELADO = '## > `🔴` transferência AutoPay cancelada\n\n-# Para enviar outra transferência use `.pg [chave] [valor]`';
const pgPendentes = new Map();
// Resposta "sim"/"não" (como reply) à mensagem de confirmação. Só vale da própria conta emissora.
async function pgResponderConfirmacao(mensagem, userId) {
  const ref = mensagem.reference && (mensagem.reference.messageId || mensagem.reference.message_id);
  if (!ref) return false;
  const pend = pgPendentes.get(String(ref));
  if (!pend || pend.userId !== String(userId)) return false;
  if (!apAutorEhContaDoUsuario(mensagem, userId)) return false;
  const t = limparTexto(mensagem.content || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\s.!?]+$/g, '');
  const sim = /^(sim|s|yes|y)$/.test(t);
  const nao = /^(nao|n|no)$/.test(t);
  if (!sim && !nao) return false;
  pgPendentes.delete(String(ref));          // consome ANTES de executar: "sim" repetido nunca envia PIX duas vezes
  ctxEnvio.enterWith({ comando: true });
  if (nao) {
    try { await editarMsgSegura(pend.msg, PG_TEXTO_CANCELADO); } catch { await apEnviarCanal(pend.canal, PG_TEXTO_CANCELADO); }
    return true;
  }
  // Reação removida (anti-detecção): o status do saque aparece na própria
  // mensagem de confirmação, que é editada com o resultado.
  // Reconfere na hora do "sim": se entrou outro saque da mesma pessoa em processamento nesse meio tempo, não envia.
  const g = pgGuardaMesmaPessoa(userId, pend.chave, pend.tipoForcado);
  if (g.processando) {
    try { await editarMsgSegura(pend.msg, PG_TEXTO_JA_PROCESSANDO, true); } catch { await enviarCanal(pend.canal, PG_TEXTO_JA_PROCESSANDO, { semVariar: true }); }
    return true;
  }
  if (pend.silencioso) await pgComReserva(userId, pend.chave, pend.tipoForcado, () => pgExecutarSilencioso({ canal: pend.canal, userId, chave: pend.chave, cents: pend.cents, mensagem: pend.mensagem || null }));
  else await pgComReserva(userId, pend.chave, pend.tipoForcado, () => pgExecutar({ canal: pend.canal, userId, chave: pend.chave, cents: pend.cents, tipoForcado: pend.tipoForcado, msgEditavel: pend.msg }));
  return true;
}
// ============================================================
// BOT PRINCIPAL
// ============================================================
// /criar-logs: SOMENTE verifica se os canais de logs existem (não cria nada).
async function criarLogsComando(interacao) {
  const guild = interacao.guild;
  if (!guild) { await interacao.reply({ content: '⛔ Use este comando dentro de um servidor.', ...EFEMERO }); return; }
  const ehAdmin = ehLiberado(interacao.user.id) || !!(interacao.memberPermissions && interacao.memberPermissions.has(8n));
  if (!ehAdmin) { await interacao.reply({ content: '⛔ Apenas administradores do servidor podem usar este comando.', ...EFEMERO }); return; }
  await interacao.deferReply(EFEMERO);
  try {
    const logs = carregarLogs();
    const atual = logs[guild.id] || {};
    const NOMES_CANAIS = ['geral', 'autopay', 'seguranca', 'erros'];
    const canalExiste = async id => { if (!id) return false; const c = await guild.channels.fetch(id).catch(() => null); return !!c; };
    const todosExistem = async () => { for (const n of NOMES_CANAIS) if (!(await canalExiste(atual[n]))) return false; return true; };
    if (await todosExistem()) { await interacao.editReply({ content: `ℹ️ Os logs já existem: <#${atual.autopay}>` }); return; }
    // O bot NÃO cria canais automaticamente. Apenas avisa o que está faltando.
    const faltando = [];
    for (const n of NOMES_CANAIS) if (!(await canalExiste(atual[n]))) faltando.push(n);
    await interacao.editReply({ content: `⚠️ Canais de logs não encontrados: **${faltando.join(', ')}**.\n-# O bot não cria canais automaticamente. Crie-os manualmente.` });
  } catch (e) {
    erro(`/criar-logs: ${e.message}`);
    await interacao.editReply({ content: `❌ Não consegui verificar os logs: ${e.message}` }).catch(logErro);
  }
}
// /personalizar: botões para mudar avatar, banner e nome do bot SOMENTE neste servidor.
function pzEhAdmin(interacao) {
  return ehLiberado(interacao.user.id) || !!(interacao.memberPermissions && interacao.memberPermissions.has(8n));
}
function pzTela() {
  return painel({
    cor: COR.principal,
    texto: '## 🎨 Personalizar o bot\nEscolha o que você quer mudar **neste servidor**. A mudança vale só aqui; nos outros servidores o bot continua igual.',
    linhas: [linhaBotoes(
      btn('pz_avatar', 'Mudar avatar', ButtonStyle.Primary, '🖼️'),
      btn('pz_banner', 'Mudar banner', ButtonStyle.Primary, '🏞️'),
      btn('pz_nome', 'Mudar nome', ButtonStyle.Secondary, '✏️')
    )]
  });
}
async function pzBaixarComoDataUri(url) {
  if (!/^https?:\/\//i.test(url)) throw new Error('O link precisa começar com http:// ou https://');
  const r = await fetch(url, { headers: { 'User-Agent': UA_NAVEGADOR }, signal: AbortSignal.timeout(40000) });
  if (!r.ok) throw new Error(`Não consegui baixar a imagem (HTTP ${r.status}).`);
  const tipo = String(r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(tipo)) throw new Error('O link não é de uma imagem válida (use PNG, JPG, GIF ou WEBP).');
  let buf = Buffer.from(await r.arrayBuffer());
  let mime = tipo;
  // Imagem estática acima de 2 MB: reduz para no máximo 1600px e comprime em JPEG.
  if (buf.length > 2 * 1024 * 1024 && tipo !== 'image/gif' && CanvasLib) {
    try {
      const img = await CanvasLib.loadImage(buf);
      const esc = Math.min(1, 1600 / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * esc));
      const h = Math.max(1, Math.round(img.height * esc));
      const cv = CanvasLib.createCanvas(w, h);
      cv.getContext('2d').drawImage(img, 0, 0, w, h);
      buf = cv.toBuffer('image/jpeg', 85);
      mime = 'image/jpeg';
    } catch (e) { aviso(`/personalizar: não consegui comprimir a imagem (${e.message}).`); }
  }
  const mbReal = (buf.length / 1024 / 1024).toFixed(2);
  info(`/personalizar: imagem baixada com ${mbReal} MB (${tipo}) de ${url}`);
  if (buf.length > 10 * 1024 * 1024) {
    throw new Error(`O arquivo baixado tem ${mbReal} MB (limite 10 MB). ${tipo === 'image/gif' ? 'GIF animado não é comprimido aqui.' : 'Mesmo comprimido ficou grande.'}`);
  }
  return `data:${mime};base64,${buf.toString('base64')}`;
}
async function pzAplicar(interacao, id) {
  await interacao.deferReply(EFEMERO);
  const guildId = interacao.guildId;
  try {
    const campo = id === 'pz_avatar_mdl' ? 'avatar' : (id === 'pz_banner_mdl' ? 'banner' : 'nick');
    const bruto = String(interacao.fields.getTextInputValue(campo === 'nick' ? 'nome' : 'url') || '').trim();
    if (!bruto) throw new Error('Campo vazio.');
    const body = {};
    if (campo === 'nick') body.nick = bruto.slice(0, 32);
    else body[campo] = await pzBaixarComoDataUri(bruto);
    try {
      await botClient.rest.patch(`/guilds/${guildId}/members/@me`, { body });
    } catch (eApi) {
      const status = eApi && (eApi.status || eApi.statusCode) ? (eApi.status || eApi.statusCode) : '?';
      erro(`/personalizar falhou em ${guildId}: ${JSON.stringify(eApi && eApi.rawError ? eApi.rawError : String(eApi && eApi.message)).slice(0, 500)}`);
      const codigo = eApi && eApi.code ? `, código ${eApi.code}` : '';
      let detalhe = String((eApi && eApi.rawError && eApi.rawError.message) || (eApi && eApi.message) || 'erro desconhecido');
      if (status === 429) detalhe = 'Muitas alterações seguidas. Espere um pouco e tente de novo.';
      throw new Error(`${detalhe} (HTTP ${status}${codigo})`);
    }
    const rotulo = campo === 'avatar' ? 'Avatar' : (campo === 'banner' ? 'Banner' : 'Nome');
    sucesso(`🎨 ${rotulo} do bot alterado em ${interacao.guild ? interacao.guild.name : guildId} (${guildId}) por ${interacao.user.id}`);
    logEmbed('geral', `🎨 /personalizar: ${rotulo} alterado`, [['Servidor', String(guildId), true], ['Por', `<@${interacao.user.id}>`, true]], interacao.user.id).catch(logErro);
    await interacao.editReply({ content: `✅ **${rotulo} alterado!** Pode levar alguns segundos para aparecer neste servidor.` });
  } catch (e) {
    await interacao.editReply({ content: `❌ Não consegui alterar: ${e.message}` }).catch(logErro);
  }
}
async function personalizarComando(interacao) {
  if (!interacao.guild) { await interacao.reply({ content: '⛔ Use este comando dentro de um servidor.', ...EFEMERO }); return; }
  if (!pzEhAdmin(interacao)) { await interacao.reply({ content: '⛔ Apenas administradores do servidor podem usar este comando.', ...EFEMERO }); return; }
  await interacao.reply(opcoesResposta(pzTela(), true));
}
// ---------- Servidores EXTERNOS (quem adicionou o bot pelo /link-bot) ----------
// Em servidor externo, quem não é o dono só usa estes comandos (e só com permissão de Gerenciar Servidor).
const CMDS_LIBERADOS_EXTERNOS = new Set(['mudar', 'personalizar', 'personalizar-bot', 'central', 'central-antiban', 'painel-compra', 'variaveis']);
// Servidores que NÃO são seus mas devem ter acesso total: SERVIDORES_LIVRES=id1,id2 no .env
const SERVIDORES_LIVRES = new Set(String(process.env.SERVIDORES_LIVRES || '').split(',').map(s => s.trim()).filter(Boolean));
function servidorExterno(interacao) {
  if (!interacao.guildId) return false;
  if (SERVIDORES_LIVRES.has(String(interacao.guildId))) return false;
  const g = interacao.guild;
  if (!g) return true;
  return !DONOS_IDS.has(String(g.ownerId));
}
function externoPodeGerenciar(interacao) {
  return !!(interacao.memberPermissions && interacao.memberPermissions.has(32n));
}
// /link-bot: embed público com o botão "Adicionar bot".
function linkBotUrl() {
  const id = (botClient && botClient.user && botClient.user.id) || '';
  const perms = 8n; // Administrador
  return `https://discord.com/oauth2/authorize?client_id=${id}&permissions=${perms}&integration_type=0&scope=bot%20applications.commands`;
}
async function linkBotComando(interacao) {
  if (!ehLiberado(interacao.user.id)) { await interacao.reply({ content: '⛔ Apenas o dono pode usar este comando.', ...EFEMERO }); return; }
  const embed = new EmbedBuilder()
    .setColor(COR.principal)
    .setTitle('🤖 Adicione o bot no seu servidor')
    .setDescription([
      'Clique no botão abaixo para adicionar o bot no servidor que você escolher.',
      '',
      '**Comandos disponíveis para quem adicionar:**',
      '`/central` • `/painel-compra` • `/mudar` • `/personalizar`',
      '',
      '-# Só administradores do servidor conseguem usar os comandos.'
    ].join('\n'));
  const botao = new ButtonBuilder().setLabel('Adicionar bot').setStyle(ButtonStyle.Link).setURL(linkBotUrl()).setEmoji('🤖');
  await interacao.reply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(botao)] });
}
// /excluir-logs: apaga os canais e a categoria de logs e limpa a configuração.
async function excluirLogsComando(interacao) {
  const guild = interacao.guild;
  if (!guild) { await interacao.reply({ content: '⛔ Use este comando dentro de um servidor.', ...EFEMERO }); return; }
  const ehAdmin = ehLiberado(interacao.user.id) || !!(interacao.memberPermissions && interacao.memberPermissions.has(8n));
  if (!ehAdmin) { await interacao.reply({ content: '⛔ Apenas administradores do servidor podem usar este comando.', ...EFEMERO }); return; }
  await interacao.deferReply(EFEMERO);
  try {
    const logs = carregarLogs();
    const atual = logs[guild.id] || {};
    const ids = [atual.geral, atual.autopay, atual.seguranca, atual.erros, atual.categoria].filter(Boolean);
    let apagados = 0;
    for (const id of ids) {
      const c = await guild.channels.fetch(id).catch(() => null);
      if (c) { await c.delete('Exclusão de logs solicitada por administrador').catch(logErro); apagados++; }
    }
    delete logs[guild.id];
    salvarLogs(logs);
    sucesso(`🗑️ Logs excluídos em ${guild.name} (${guild.id}) — ${apagados} canal(is)/categoria apagado(s)`);
    await interacao.editReply({ content: `✅ **Logs excluídos!** Removi ${apagados} canal(is)/categoria de logs deste servidor. Crie novos canais manualmente se precisar.` });
  } catch (e) {
    erro(`/excluir-logs: ${e.message}`);
    await interacao.editReply({ content: `❌ Não consegui excluir os logs: ${e.message}\n-# O bot precisa da permissão **Gerenciar Canais** no servidor.` }).catch(logErro);
  }
}
// ============================================================
// REVENDA / INDICAÇÃO (/painel-revenda) e GATEWAY DE PAGAMENTO (/mudar)
// ============================================================
const RV_PATH = path.join(__dirname, 'revenda.json');
const RV_COMISSAO = 0.30; // 30% do valor pago em compras de PLANOS (salas não contam)
const RV_EMO = {
  gerar: '<:1002684675:1560288850515992606>',
  indicacoes: '<:1002683754:1558309690058870894>',
  sacar: '<:1002683210:1557150593703739472>',
  validas: '<:1002683209:1557150697424687105>',
  trofeu: '<:trophy:1558203954729328670>',
  info1: '<:1002684676:1560289656409694250>',
  info2: '<:1002684677:1560289669134950550>',
  cancel: '<a:cancel:1553640762946756648>'
};
let rvCache = null;
function rvDb() {
  if (rvCache) return rvCache;
  try {
    if (fs.existsSync(RV_PATH)) {
      const d = JSON.parse(fs.readFileSync(RV_PATH, 'utf8'));
      rvCache = d && typeof d === 'object' ? d : {};
    }
  } catch (e) { aviso(`[Revenda] Erro lendo revenda.json: ${e.message}`); }
  if (!rvCache) rvCache = {};
  rvCache.donos = rvCache.donos || {};       // { userId: { codigo, saldoCents, compras, totalGanhoCents } }
  rvCache.codigos = rvCache.codigos || {};   // { CODIGO: userId }
  rvCache.usos = rvCache.usos || {};         // { compradorId: donoId }  (cada pessoa só usa 1 código)
  rvCache.creditados = rvCache.creditados || {}; // { chaveDaCompra: true } (evita pagar 2x)
  return rvCache;
}
function rvSalvar() {
  try {
    fs.writeFileSync(RV_PATH + '.tmp', JSON.stringify(rvDb(), null, 2), { mode: 0o600 });
    fs.renameSync(RV_PATH + '.tmp', RV_PATH);
  } catch (e) { aviso(`[Revenda] Erro salvando revenda.json: ${e.message}`); }
}
function rvDono(userId) { return rvDb().donos[userId] || null; }
function rvGarantirDono(userId) {
  const db = rvDb();
  if (db.donos[userId]) return db.donos[userId];
  let codigo;
  do { codigo = `AUTO${crypto.randomBytes(4).toString('hex').toUpperCase()}`; } while (db.codigos[codigo]);
  db.codigos[codigo] = userId;
  db.donos[userId] = { codigo, saldoCents: 0, compras: 0, totalGanhoCents: 0, criadoEm: Date.now() };
  rvSalvar();
  return db.donos[userId];
}
function rvBuscarCodigo(txt) {
  const codigo = String(txt || '').trim().toUpperCase().replace(/\s+/g, '');
  const donoId = codigo ? rvDb().codigos[codigo] : null;
  return donoId ? { codigo, donoId } : null;
}
// Chamado quando a compra é CONFIRMADA. Credita 30% do valor pago ao dono do código.
async function rvCreditarCompra(p, chaveCompra) {
  try {
    if (!p || p.tipo !== 'var' || !p.revendaDono || !p.revendaCodigo) return;
    const db = rvDb();
    const chave = String(chaveCompra || p.paymentId || '');
    if (!chave || db.creditados[chave]) return;
    const donoId = db.codigos[p.revendaCodigo];
    if (!donoId || donoId !== p.revendaDono || donoId === p.userId) return;
    const d = db.donos[donoId];
    if (!d) return;
    // trava o comprador no 1º código usado
    if (db.usos[p.userId] && db.usos[p.userId] !== donoId) return;
    db.usos[p.userId] = donoId;
    const cents = Math.floor(Math.round(Number(p.valor) * 100) * RV_COMISSAO);
    db.creditados[chave] = true;
    d.saldoCents = (d.saldoCents || 0) + cents;
    d.totalGanhoCents = (d.totalGanhoCents || 0) + cents;
    d.compras = (d.compras || 0) + 1;
    rvSalvar();
    sucesso(`🤝 Revenda: +${apMoeda(cents)} para ${donoId} (código ${p.revendaCodigo}, comprador ${p.userId})`);
    logEmbed('geral', '🤝 Comissão de revenda CREDITADA', [
      ['👤 Dono do código', `<@${donoId}>`, true],
      ['🏷️ Código', p.revendaCodigo, true],
      ['🛒 Comprador', `<@${p.userId}>`, true],
      ['💰 Comissão', apMoeda(cents), true]
    ], donoId).catch(logErro);
    // Sem DM: o aviso da comissão já foi para o canal de logs (logEmbed acima).
  } catch (e) { aviso(`[Revenda] crédito falhou: ${e.message}`); }
}
// Venda feita dentro de servidor externo: 30% vai pro saldo (/painel-revenda) do dono daquele servidor.
async function rvCreditarVendaServidor(p, chaveCompra) {
  try {
    if (!p || p.tipo !== 'var' || !p.guildId) return false;
    const gid = String(p.guildId);
    if (SERVIDORES_LIVRES.has(gid)) return false;
    const g = botClient.guilds.cache.get(gid) || await botClient.guilds.fetch(gid).catch(() => null);
    if (!g || !g.ownerId || DONOS_IDS.has(String(g.ownerId))) return false;
    const donoId = String(g.ownerId);
    const db = rvDb();
    const chave = `srv_${String(chaveCompra || p.paymentId || '')}`;
    if (chave === 'srv_' || db.creditados[chave]) return true;
    const d = rvGarantirDono(donoId);
    const cents = Math.floor(Math.round(Number(p.valor) * 100) * RV_COMISSAO);
    db.creditados[chave] = true;
    d.saldoCents = (d.saldoCents || 0) + cents;
    d.totalGanhoCents = (d.totalGanhoCents || 0) + cents;
    d.compras = (d.compras || 0) + 1;
    rvSalvar();
    sucesso(`🤝 Venda em servidor ${gid}: +${apMoeda(cents)} para ${donoId}`);
    logEmbed('geral', '🤝 Comissão de venda em servidor CREDITADA', [
      ['👤 Dono do servidor', `<@${donoId}>`, true],
      ['🏠 Servidor', gid, true],
      ['🛒 Comprador', `<@${p.userId}>`, true],
      ['💰 Comissão', apMoeda(cents), true]
    ], donoId).catch(logErro);
    // Sem DM: o aviso da comissão já foi para o canal de logs (logEmbed acima).
    return true;
  } catch (e) { aviso(`[Revenda] venda servidor falhou: ${e.message}`); return false; }
}
function rvTelaPainel() {
  return painel({
    cor: COR.principal,
    texto: [
      `# ${RV_EMO.trofeu} Indique e ganhe dias de AutoMed`,
      'Compartilhe seu código com amigos e acompanhe suas recompensas.',
      '',
      'A cada **compra confirmada de plano AutoMed**, você recebe **30% da sua venda do AutoMed**.',
      '',
      '> Compras de salas não contam para a recompensa.',
      '> Cada pessoa pode usar apenas um código de convite.',
      '-# Use os botões abaixo para acessar suas informações.'
    ].join('\n'),
    linhas: [linhaBotoes(
      btn('rv_gerar', 'gerar codigo', ButtonStyle.Primary, RV_EMO.gerar),
      btn('rv_indic', 'minhas indicações', ButtonStyle.Secondary, RV_EMO.indicacoes),
      btn('rv_sacar', 'sacar', ButtonStyle.Success, RV_EMO.sacar)
    )]
  });
}
const rvSacando = new Set();
// Resposta efêmera própria do painel de revenda (não depende de nenhum helper declarado em outro ponto do arquivo).
function rvResponder(interacao, conteudo) {
  const payload = { content: conteudo, ...EFEMERO };
  if (interacao.deferred || interacao.replied) return interacao.followUp(payload);
  return interacao.reply(payload);
}
async function rvProcessarSaque(interacao, userId) {
  const chave = String(interacao.fields.getTextInputValue('chave') || '').trim();
  const cents = apParseValor(interacao.fields.getTextInputValue('valor'));
  if (!chave) { await rvResponder(interacao, '❌ Informe a chave PIX.'); return; }
  if (!cents) { await rvResponder(interacao, '❌ Valor inválido. Exemplo: `10,00`.'); return; }
  const d = rvDono(userId);
  if (!d || (d.saldoCents || 0) < cents) {
    await rvResponder(interacao, `${RV_EMO.cancel} Você não tem saldo disponível, revenda mais automed ou coloque um valor mais baixo`);
    return;
  }
  if (!apConfigurado()) { await rvResponder(interacao, '❌ Saques indisponíveis no momento (API da Turbofy não configurada). Tente mais tarde.'); return; }
  if (rvSacando.has(userId)) { await rvResponder(interacao, '⏳ Você já tem um saque em andamento.'); return; }
  rvSacando.add(userId);
  try {
    await interacao.deferReply(EFEMERO);
    // Debita o saldo de revenda e repassa para a carteira AutoPay (valor + taxa, para sair o valor cheio).
    const aporte = cents + AP_TAXA_SAQUE_CENTS;
    d.saldoCents -= cents;
    rvSalvar();
    const w = apUsuario(userId);
    w.saldoCents += aporte;
    apSalvar();
    let revertido = false;
    const reverter = () => {
      if (revertido) return;
      revertido = true;
      const w2 = apUsuario(userId);
      const volta = Math.min(aporte, w2.saldoCents);
      w2.saldoCents -= volta;
      apSalvar();
      const d2 = rvDono(userId);
      if (d2) { d2.saldoCents += cents; rvSalvar(); }
    };
    // Mesma resposta do .pg (texto + comprovante), mas efêmera. Se não der (ex.: interação expirou), vai na DM.
    const textoRv = (res) => {
      let t = apTextoSaque(res);
      if (!res.ok) {
        t = t.replace(/voltou para sua carteira AutoPay/g, 'voltou para o seu saldo de revenda');
        if (!t.includes('saldo de revenda')) t += '\n-# O valor voltou para o seu saldo de revenda.';
      }
      return t;
    };
    const enviarEfemero = async (opcoes) => {
      try { await interacao.followUp({ ...opcoes, ...EFEMERO }); }
      catch { try { const u = await botClient.users.fetch(userId); await u.send(opcoes); } catch {} }
    };
    const mostrar = async (res) => {
      const texto = textoRv(res);
      try { await interacao.editReply({ content: texto }); }
      catch { await enviarEfemero({ content: texto }); }
    };
    let comprovanteEnviado = false;
    const mostrarComprovante = async (res) => {
      if (comprovanteEnviado || !res || res.codigo !== 'ok') return;
      comprovanteEnviado = true;
      await apEnviarComprovante(res, enviarEfemero);
    };
    const avisarFinal = async (res) => {
      if (!res.ok) reverter();
      await mostrar(res);
      await mostrarComprovante(res);
    };
    logEmbed('geral', '🤝 Saque de revenda SOLICITADO', [
      ['👤 Usuário', `<@${userId}>`, true],
      ['💰 Valor', apMoeda(cents), true]
    ], userId).catch(logErro);
    const r = await apSerial(userId, () => apExecutarSaque(userId, chave, cents, avisarFinal));
    if (!r.ok) reverter();
    await mostrar(r);
    await mostrarComprovante(r);
  } catch (e) {
    erro(`[Revenda] saque ${userId}: ${e.message}`);
    await interacao.editReply({ content: '❌ Não foi possível processar o saque agora. Seu saldo foi mantido, tente novamente.' }).catch(logErro);
  } finally { rvSacando.delete(userId); }
}

// ---------- Gateway de pagamento: Turbofy (padrão) ou Mercado Pago ----------
const GW_PATH = path.join(__dirname, 'gateway.json');
function gwAtual() {
  try { const j = JSON.parse(fs.readFileSync(GW_PATH, 'utf8')); return j && j.ativo === 'mp' ? 'mp' : 'turbofy'; } catch { return 'turbofy'; }
}
function gwDefinir(ativo) {
  try { fs.writeFileSync(GW_PATH, JSON.stringify({ ativo: ativo === 'mp' ? 'mp' : 'turbofy', em: Date.now() }, null, 2), { mode: 0o600 }); } catch (e) { aviso(`[Gateway] ${e.message}`); }
}
// O token do Mercado Pago fica SOMENTE no .env (MP_ACCESS_TOKEN=APP_USR-...), nunca no código.
function gwMpToken() { return String(process.env.MP_ACCESS_TOKEN || '').trim(); }
function gwTela(avisoTxt) {
  const atual = gwAtual();
  const botao = atual === 'turbofy'
    ? btn('gw_mp', 'MP token', ButtonStyle.Primary, '<:1002682620:1556632145898905620>')
    : btn('gw_turbofy', 'API da turbofy', ButtonStyle.Primary, '<:1002682625:1556634754567110797>');
  return painel({
    cor: COR.pagamentos,
    texto: [
      '# 💳 Gateway de pagamento',
      `Ativo agora: **${atual === 'mp' ? 'Mercado Pago (MP token)' : 'API da Turbofy'}**`,
      '',
      'As vendas do AutoMed estão sendo recebidas por ele. Use o botão abaixo para trocar.'
    ].join('\n') + linhaAviso(avisoTxt),
    linhas: [linhaBotoes(botao)]
  });
}

// ============================================================
// CARRINHO DE COMPRA (Mercado Pago)
// ============================================================
const MP_TOKEN = 'turbofy'; // o carrinho usa o AutoPay (Turbofy) — rápido e pré-criado
const CP_PRECO_SALA = Number(String(process.env.PRECO_SALA || '0.03').replace(',', '.')) || 0.03;
// /valorsala: preço da sala do AutoMed POR SERVIDOR (só vale no servidor onde foi definido).
const PRECOS_SALA_PATH = path.join(__dirname, 'precos_sala.json');
function cpPrecosSalaLer() {
  try { const j = JSON.parse(fs.readFileSync(PRECOS_SALA_PATH, 'utf8')); return j && typeof j === 'object' ? j : {}; } catch { return {}; }
}
function cpPrecoSala(guildId) {
  const v = Number(cpPrecosSalaLer()[String(guildId || '')]);
  return Number.isFinite(v) && v > 0 ? v : CP_PRECO_SALA;
}
function cpPrecoSalaSalvar(guildId, valor) {
  const o = cpPrecosSalaLer();
  if (valor === null) delete o[String(guildId)]; else o[String(guildId)] = Number(valor);
  try { fs.writeFileSync(`${PRECOS_SALA_PATH}.tmp`, JSON.stringify(o, null, 2)); fs.renameSync(`${PRECOS_SALA_PATH}.tmp`, PRECOS_SALA_PATH); } catch (e) { erro(`Preço da sala: ${e.message}`); }
}
const CP_PATH = path.join(__dirname, 'carrinhos.json');
const DJS = (() => { try { return require('discord.js'); } catch { return {}; } })();
const carrinhos = new Map();
const cpGerando = new Set();
try {
  if (fs.existsSync(CP_PATH)) {
    for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(CP_PATH, 'utf8')))) carrinhos.set(k, v);
  }
} catch {}
function cpSalvar() {
  try { fs.writeFileSync(CP_PATH, JSON.stringify(Object.fromEntries(carrinhos), null, 2), { mode: 0o600 }); } catch {}
}
async function cpMp(caminho, { method = 'GET', body, idem, timeoutMs = 20000 } = {}) {
  const headers = { Authorization: `Bearer ${gwMpToken()}`, 'Content-Type': 'application/json' };
  if (idem) headers['X-Idempotency-Key'] = idem;
  const r = await httpNatural(`https://api.mercadopago.com${caminho}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeoutMs)
  }, 3);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.message || d.error || `mp_http_${r.status}`);
  return d;
}
async function cpMpCriarPix(userId, valor, descricao) {
  if (!gwMpToken()) throw new Error('MP_ACCESS_TOKEN não definido no .env');
  const expira = Date.now() + 15 * 60000;
  const dataExp = new Date(expira - 3 * 3600000).toISOString().replace('Z', '-03:00');
  const d = await cpMp('/v1/payments', {
    method: 'POST',
    idem: crypto.randomUUID(),
    body: {
      transaction_amount: Number(Number(valor).toFixed(2)),
      description: String(descricao || 'AutoMed').slice(0, 200),
      payment_method_id: 'pix',
      payer: { email: process.env.MP_PAYER_EMAIL || 'cliente@automed.com.br' },
      external_reference: `automed_${userId}_${Date.now()}`,
      date_of_expiration: dataExp
    }
  });
  const td = (d.point_of_interaction && d.point_of_interaction.transaction_data) || {};
  if (!d.id || !td.qr_code) throw new Error('Mercado Pago não devolveu o código Pix');
  info(`[Carrinho] Pix Mercado Pago ${formatarValor(valor)} gerado (id ${d.id})`);
  return { paymentId: String(d.id), copiaECola: td.qr_code, qrBase64: td.qr_code_base64 || '', expiraEm: expira, gateway: 'mp' };
}
async function cpMpStatus(paymentId) {
  const d = await cpMp(`/v1/payments/${encodeURIComponent(paymentId)}`);
  if (d.status === 'approved') return 'approved';
  if (['cancelled', 'rejected', 'refunded', 'charged_back'].includes(d.status)) return 'cancelled';
  return 'pending';
}
function cpEmbedConfirmacao(userId, qtd, valor) {
  return new EmbedBuilder()
    .setColor('#faa61a')
    .setTitle(`Confirmação da compra • \`${qtd}\` SALAS`)
    .setDescription(
      `Olá <@${userId}>, confirme abaixo os dados da sua compra.\n\n` +
      `Produto: **salas de free fire**\n` +
      `Valor: \`${formatarValor(valor)}\`\n\n` +
      `Quantidade de salas: \`${qtd}\` SALAS`
    )
    .setFooter({ text: NOME_MARCA });
}
function cpLinhaConfirmacao(p) {
  const botoes = [btn('cp_prosseguir', 'Prosseguir', ButtonStyle.Success, '<a:check:1549930769219194990>')];
  if (!(p && p.cupom)) botoes.push(btn('cp_cupom', 'CUPOM', ButtonStyle.Primary, '<a:voiddinheirinho:1553640772551843852>'));
  if (p && p.tipo === 'var' && !p.revendaCodigo) botoes.push(btn('rv_codigo', 'inserir codigo', ButtonStyle.Secondary, RV_EMO.indicacoes));
  botoes.push(btn('cp_cancelar', 'Cancelar compra', ButtonStyle.Danger, '<a:cancel:1553640762946756648>'));
  return linhaBotoes(...botoes);
}
function cpEmbedPix(p, semImagem = false) {
  const e = new EmbedBuilder()
    .setColor('#3ba55c')
    .setTitle(`💳 Pagamento Pix • ${p.rotulo || `${p.quantidade} SALAS`}`)
    .setDescription('Escaneie o **QR Code** abaixo ou use o **código copia e cola**.\nA confirmação é automática.')
    .addFields(
      { name: '💰 Valor', value: `\`${formatarValor(p.valor)}\``, inline: true },
      { name: '🎮 Quantidade', value: `\`${p.quantidade}\` ${p.rotulo ? 'dia(s)' : 'salas'}`, inline: true },
      { name: '📋 Código Copia e Cola', value: `\`\`\`${p.copiaECola || '—'}\`\`\``, inline: false }
    );
  if (!semImagem && p.qrBase64) e.setImage('attachment://qrcode.png');
  e.setFooter({ text: NOME_MARCA });
  return e;
}
function cpLinhaPix() {
  return linhaBotoes(
    btn('cp_cancelar', 'Cancelar compra', ButtonStyle.Danger, '<a:cancel:1553640762946756648>'),
    btn('cp_copiar', 'Código copia e cola', ButtonStyle.Primary, '📋'),
    btn('cp_qr', 'QR CODE', ButtonStyle.Secondary, '<:1002685029:1560776017528881252>')
  );
}
async function cpCriarCarrinho(userId, username, canalId, guildId, qtd) {
  if (!DJS.ChannelType) return { ok: false, motivo: 'Compra indisponível (discord.js real não carregado).' };
  for (const [tid, p] of [...carrinhos.entries()]) {
    if (p.userId !== userId) continue;
    const existe = await botClient.channels.fetch(tid).catch(() => null);
    if (existe) return { ok: false, motivo: `Você já tem um carrinho aberto: <#${tid}>` };
    carrinhos.delete(tid);
    cpSalvar();
  }
  const canal = botClient.channels.cache.get(canalId) || await botClient.channels.fetch(canalId).catch(() => null);
  if (!canal || !canal.threads || canal.type !== DJS.ChannelType.GuildText) {
    return { ok: false, motivo: 'Abra o painel em um canal de texto de servidor para criar o carrinho.' };
  }
  const valor = Number((qtd * cpPrecoSala(guildId)).toFixed(2));
  const pagamentoPromise = MP_TOKEN ? cpCriarPagamentoMP(userId, qtd, valor) : null;
  if (pagamentoPromise) pagamentoPromise.catch(logErro);
  let thread;
  try {
    thread = await canal.threads.create({
      name: `🛒 Compra — ${username}`.slice(0, 100),
      autoArchiveDuration: 60,
      type: DJS.ChannelType.GuildPrivateThread,
      invitable: false,
      reason: 'Nova compra de salas'
    });
  } catch (e) {
    return { ok: false, motivo: `Não consegui criar o tópico privado: ${e.message} (o bot precisa de "Criar Tópicos Privados" e "Gerenciar Tópicos").` };
  }
  await thread.members.add(userId).catch(logErro);
  setTimeout(async () => {
    try {
      const recentes = await canal.messages.fetch({ limit: 5 });
      for (const m of recentes.values()) {
        if (m.type === DJS.MessageType.ThreadCreated && m.thread && m.thread.id === thread.id) await m.delete().catch(logErro);
      }
    } catch {}
  }, 1000);
  carrinhos.set(thread.id, {
    userId, username, quantidade: qtd, valor, guildId: guildId || null, canalId,
    paymentId: null, copiaECola: null, qrBase64: null, criadoEm: Date.now()
  });
  cpSalvar();
  if (pagamentoPromise) cpAplicarPagamento(thread.id, pagamentoPromise); else cpPrepararPagamento(thread.id);
  await thread.send({
    content: `<@${userId}>`,
    embeds: [cpEmbedConfirmacao(userId, qtd, valor)],
    components: [cpLinhaConfirmacao()]
  }).catch(logErro);
  logEmbed('geral', '🛒 Carrinho de salas CRIADO', [
    ['👤 Comprador', `<@${userId}>`, true],
    ['🎮 Quantidade', `${qtd} salas`, true],
    ['💰 Valor', formatarValor(valor), true]
  ], userId).catch(logErro);
  return { ok: true, threadId: thread.id };
}
const cpPromessas = new Map();
const CP_MIN_REAIS = Number(String(process.env.CP_MIN_REAIS || '3').replace(',', '.')) || 3;
const CP_MIN_SALAS = 20;   // mínimo de salas por compra (era 100 via CP_MIN_REAIS)
const CP_DESTINO_ID = '1390599937485705337';
async function cpCriarPagamentoMP(userId, qtd, valor) {
  const ini = Date.now();
  if (gwAtual() === 'mp') return cpMpCriarPix(userId, valor, `AutoMed • ${qtd}`);
  if (!apAtivo()) throw new Error('AutoPay offline');
  const cents = Math.round(Number(valor) * 100);
  let r = { ok: false, motivo: 'erro' };
  for (let t = 1; t <= 2 && !r.ok; t++) {
    r = await apCriarDeposito(CP_DESTINO_ID, cents, true, true).catch(() => ({ ok: false, motivo: 'erro' }));
    if (!r.ok && ['chave_recebedor', 'offline', 'minimo'].includes(r.motivo)) break;
    if (!r.ok && t < 2) await esperar(1500);
  }
  if (!r.ok) throw new Error(`Turbofy recusou ${apMoeda(cents)} (${r.motivo})`);
  r.dep.creditoCents = cents;
  apSalvar();
  const qr = await Promise.race([apObterQrBuffer(r.qrApi, r.dep.copiaCola), esperar(3000).then(() => null)]).catch(() => null);
  info(`[Carrinho] Pix Turbofy ${apMoeda(cents)} gerado em ${Date.now() - ini}ms`);
  return { paymentId: r.dep.id, copiaECola: r.dep.copiaCola, qrBase64: qr ? qr.toString('base64') : '', expiraEm: r.dep.expiraEm, gateway: 'turbofy' };
}
function cpAplicarPagamento(threadId, promessaPag) {
  const pr = promessaPag.then(d => {
    const p = carrinhos.get(threadId);
    if (!p) {
      // carrinho não existe mais: a cobrança expira sozinha
      return null;
    }
    Object.assign(p, d);
    if (d.paymentId && !d.tipoPagamento && d.gateway !== 'mp') apCbDep.set(d.paymentId, { pago: async () => {}, expirou: async () => {} });
    cpSalvar();
    return p;
  }).finally(() => cpPromessas.delete(threadId));
  cpPromessas.set(threadId, pr);
  pr.catch(e => aviso(`[Carrinho] pré-criar pagamento: ${e.message}`));
  return pr;
}
function cpPrepararPagamento(threadId) {
  const p = carrinhos.get(threadId);
  if (!p) return Promise.resolve(null);
  if (p.paymentId) return Promise.resolve(p);
  if (cpPromessas.has(threadId)) return cpPromessas.get(threadId);
  return cpAplicarPagamento(threadId, cpCriarPagamentoMP(p.userId, p.quantidade, p.valor));
}
function iniciarPollCarrinhos() {
  if (!MP_TOKEN) { aviso('[Carrinho] MP_TOKEN não definido no .env — compras desativadas.'); return; }
  let pollCarrinhosAtivo = false; // um ciclo por vez: se o anterior ainda não terminou, este é pulado (nada roda em paralelo/duplicado)
  setInterval(async () => {
    if (pollCarrinhosAtivo) return;
    pollCarrinhosAtivo = true;
    try {
    for (const [threadId, p] of [...carrinhos.entries()]) {
      try {
        if (!p.paymentId) {
          if (Date.now() - p.criadoEm > 60 * 60 * 1000) {
            carrinhos.delete(threadId); cpSalvar();
            const t = await botClient.channels.fetch(threadId).catch(() => null);
            if (t) t.delete().catch(logErro);
          }
          continue;
        }
        let st;
        if (p.gateway === 'mp') {
          st = await cpMpStatus(p.paymentId);
        } else if (p.tipoPagamento === 'mp') {
          // Carrinho antigo do Mercado Pago (sem depósito Turbofy): cancela para não ficar preso.
          st = 'cancelled';
        } else {
          const dep = apUsuario(CP_DESTINO_ID).depositos[p.paymentId];
          if (dep && dep.status === 'pendente') await apVerificarDeposito(CP_DESTINO_ID, dep).catch(logErro);
          st = !dep ? 'pending'
            : dep.status === 'pago' ? 'approved'
            : ['expirado', 'cancelado', 'divergente'].includes(dep.status) ? 'cancelled'
            : 'pending';
        }
        if (st === 'approved') {
          carrinhos.delete(threadId); cpSalvar();
          if (p.tipo === 'var') {
            try { await cpEntregarKey(p); } catch (e) { aviso(`[Loja] entrega da key: ${e.message}`); }
            const pagoServidor = await rvCreditarVendaServidor(p, p.paymentId || threadId);
            if (!pagoServidor) await rvCreditarCompra(p, p.paymentId || threadId);
            vendasLogRegistrar(p, p.paymentId || threadId, pagoServidor ? Math.floor(Math.round(Number(p.valor) * 100) * RV_COMISSAO) : 0);   // alimenta o /historico
          } else {
            const cfg = obterConfigUsuario(p.userId);
            salvarConfigUsuario(p.userId, { salasCompradas: (Number(cfg.salasCompradas) || 0) + Number(p.quantidade) });
            salasBotRegistrarDelta(p.userId, Number(p.quantidade));
            sucesso(`🛒 Compra aprovada: +${p.quantidade} salas para ${p.userId}`);
            logEmbed('geral', '🛒 Compra de salas APROVADA', [
              ['👤 Comprador', `<@${p.userId}>`, true],
              ['🎮 Quantidade', `${p.quantidade} salas`, true],
              ['💰 Valor', formatarValor(p.valor), true]
            ], p.userId).catch(logErro);
          }
          const t = await botClient.channels.fetch(threadId).catch(() => null);
          if (t) {
            await t.send('✅ Ordem aprovada, carrinho sendo excluído.').catch(logErro);
            await t.setName('✅・Pagamento Aprovado').catch(logErro);
            setTimeout(() => { t.delete().catch(logErro); }, 60000);
          }
        } else if (['cancelled', 'rejected', 'refunded'].includes(st)) {
          carrinhos.delete(threadId); cpSalvar();
          const t = await botClient.channels.fetch(threadId).catch(() => null);
          if (t) {
            await t.send(`❌ Pagamento **${st}**. Este tópico será excluído.`).catch(logErro);
            setTimeout(() => { t.delete().catch(logErro); }, 3000);
          }
        }
      } catch (e) { aviso(`[Carrinho] ${p.paymentId}: ${e.message}`); }
    }
    } finally { pollCarrinhosAtivo = false; }
  }, 8000);
}
// ============================================================
// LOJA DE KEYS — /variaveis (dono) e /painel-compra (público)
// ============================================================
const VAR_PATH = path.join(__dirname, 'variaveis.json');
const varCtx = new AsyncLocalStorage();
const VAR_EXT_PATH = path.join(__dirname, 'variaveis_ext.json');
let variaveisCache = null;
let variaveisExtCache = null;
function varGuildExterna(guildId) {
  if (!guildId) return false;
  const id = String(guildId);
  if (SERVIDORES_LIVRES.has(id)) return false;
  const g = botClient && botClient.guilds.cache.get(id);
  if (!g) return true;
  return !DONOS_IDS.has(String(g.ownerId));
}
function varGuildAtual() {
  const s = varCtx.getStore();
  const gid = s && s.guildId;
  return varGuildExterna(gid) ? String(gid) : null;
}
function varPodeGerenciar(interacao) {
  if (ehLiberado(interacao.user.id)) return true;
  return varGuildExterna(interacao.guildId) && !!(interacao.memberPermissions && interacao.memberPermissions.has(32n));
}
function varDonoLer() {
  if (variaveisCache) return variaveisCache;
  try {
    if (fs.existsSync(VAR_PATH)) {
      const d = JSON.parse(fs.readFileSync(VAR_PATH, 'utf8'));
      variaveisCache = d && typeof d === 'object' ? d : {};
      return variaveisCache;
    }
  } catch (e) { aviso(`Erro lendo variaveis.json: ${e.message}`); }
  variaveisCache = {};
  return variaveisCache;
}
function varExtDb() {
  if (variaveisExtCache) return variaveisExtCache;
  try {
    if (fs.existsSync(VAR_EXT_PATH)) {
      const d = JSON.parse(fs.readFileSync(VAR_EXT_PATH, 'utf8'));
      variaveisExtCache = d && typeof d === 'object' ? d : {};
      return variaveisExtCache;
    }
  } catch (e) { aviso(`Erro lendo variaveis_ext.json: ${e.message}`); }
  variaveisExtCache = {};
  return variaveisExtCache;
}
function varExtSalvar() {
  try { fs.writeFileSync(VAR_EXT_PATH + '.tmp', JSON.stringify(varExtDb(), null, 2), { mode: 0o600 }); fs.renameSync(VAR_EXT_PATH + '.tmp', VAR_EXT_PATH); } catch {}
}
function carregarVariaveis() {
  const gid = varGuildAtual();
  if (!gid) return varDonoLer();
  const db = varExtDb();
  if (!db[gid]) { db[gid] = JSON.parse(JSON.stringify(varDonoLer())); varExtSalvar(); }
  return db[gid];
}
function salvarVariaveis(v) {
  const gid = varGuildAtual();
  if (gid) { varExtDb()[gid] = v; varExtSalvar(); return; }
  variaveisCache = v;
  try { fs.writeFileSync(VAR_PATH + '.tmp', JSON.stringify(v, null, 2), { mode: 0o600 }); fs.renameSync(VAR_PATH + '.tmp', VAR_PATH); } catch {}
}
function listaVariaveis() {
  return Object.values(carregarVariaveis()).sort((a, b) => (a.criadaEm || 0) - (b.criadaEm || 0));
}
function parseEmojiVar(emoji) {
  const e = String(emoji || '').trim();
  if (!e) return undefined;
  const m = e.match(/^<a?:([A-Za-z0-9_]+):(\d+)>$/);
  if (m) return { name: m[1], id: m[2], animated: e.startsWith('<a:') };
  if (/^\d+$/.test(e)) return { name: 'x', id: e };
  return e;
}
function telaVariaveis(aviso_) {
  const total = listaVariaveis().length;
  return painel({
    cor: COR.keys,
    texto: [
      '# Gerenciar variáveis da loja',
      RODAPE,
      '',
      `**${total}** variável(is) cadastrada(s).`,
      'Elas aparecem como opções no **/painel-compra**.',
      '',
      '**Adicionar** cria uma nova opção de compra; **Editar** altera uma existente; **Remover** apaga as selecionadas.'
    ].join('\n') + linhaAviso(aviso_),
    linhas: [
      linhaBotoes(
        btn('var_add', 'Adicionar variável', ButtonStyle.Success, '➕'),
        btn('var_edit', 'Editar variável', ButtonStyle.Primary, '✏️'),
        btn('var_rem', 'Remover variável', ButtonStyle.Danger, '➖')
      )
    ]
  });
}
function telaEditarVariaveis(aviso_) {
  const vars = listaVariaveis();
  if (!vars.length) return telaVariaveis('❌ Nenhuma variável cadastrada para editar.');
  const s = new StringSelectMenuBuilder()
    .setCustomId('sl_var_edit')
    .setPlaceholder('Selecione a variável que deseja editar...')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(vars.slice(0, 25).map(v => ({
      label: String(v.titulo).slice(0, 100),
      description: `${v.descricao} • ${v.dias} dia(s) • ${formatarValor(v.preco)}`.slice(0, 100),
      value: v.id,
      emoji: '✏️'
    })));
  return painel({
    cor: COR.keys,
    texto: [
      '# Editar variável',
      RODAPE,
      '',
      'Selecione a variável abaixo. Vai abrir um formulário com **todas as configurações** dela para você alterar.'
    ].join('\n') + linhaAviso(aviso_),
    linhas: [
      new ActionRowBuilder().addComponents(s),
      linhaBotoes(botaoVoltar('var_voltar'))
    ]
  });
}
function telaRemoverVariaveis(aviso_) {
  const vars = listaVariaveis();
  if (!vars.length) return telaVariaveis('❌ Nenhuma variável cadastrada para remover.');
  const s = new StringSelectMenuBuilder()
    .setCustomId('sl_var_rem')
    .setPlaceholder('Selecione uma ou mais variáveis para apagar...')
    .setMinValues(1)
    .setMaxValues(Math.min(vars.length, 25))
    .addOptions(vars.slice(0, 25).map(v => ({
      label: String(v.titulo).slice(0, 100),
      description: `${v.descricao} • ${v.dias} dia(s) • ${formatarValor(v.preco)}`.slice(0, 100),
      value: v.id,
      emoji: '<:1002684186:1559203407359639572>'
    })));
  return painel({
    cor: COR.erro,
    texto: [
      '# Remover variáveis',
      RODAPE,
      '',
      'Selecione **uma ou mais** variáveis abaixo e confirme para apagar.'
    ].join('\n') + linhaAviso(aviso_),
    linhas: [
      new ActionRowBuilder().addComponents(s),
      linhaBotoes(botaoVoltar('var_voltar'))
    ]
  });
}
function telaPainelCompra() {
  const vars = listaVariaveis();
  const texto = [
    'Automatize sua operação diretamente pelo **Discord**, sem precisar perder tempo conferindo pagamentos, comprovantes e criando salas manualmente.',
    '',
    'O AutoMed cuida de tudo: **validação de PIX, criação automática de salas, análise de comprovantes, resultados e logs completos**.',
    '',
    '**Mais agilidade, menos trabalho manual e mais controle** sobre sua operação.',
    '',
    'Disponível **24/7**, deixando você livre para focar no que realmente importa: **faturar e crescer.**'
  ].join('\n');
  if (!vars.length) {
    const s = new StringSelectMenuBuilder()
      .setCustomId('sl_compra')
      .setPlaceholder('Nenhuma variável disponível no momento.')
      .setDisabled(true)
      .addOptions([{ label: 'Em breve', value: 'vazio' }]);
    return painel({ cor: COR.principal, texto, linhas: [new ActionRowBuilder().addComponents(s)] });
  }
  const opcoes = vars.slice(0, 25).map(v => ({
    label: String(v.titulo).slice(0, 100),
    description: `${v.descricao} • ${v.dias} dia(s) • ${formatarValor(v.preco)}`.slice(0, 100),
    value: v.id,
    emoji: parseEmojiVar(v.emoji)
  }));
  return painel({ cor: COR.principal, texto, linhas: [menu('sl_compra', 'Selecione sua opção...', opcoes)] });
}
function cpVarEmbedConfirmacao(userId, v, valor) {
  return new EmbedBuilder()
    .setColor('#faa61a')
    .setTitle(`Confirmação da compra • ${v.titulo}`)
    .setDescription(
      `Olá <@${userId}>, confirme abaixo os dados da sua compra.\n\n` +
      `Produto: **${v.titulo}**\n` +
      `Valor: \`${formatarValor(valor)}\`\n\n` +
      `Key válida por **${v.dias} dia(s)**`
    )
    .setFooter({ text: NOME_MARCA });
}
function cpEmbedConfirmacaoDe(p) {
  const e = p.tipo === 'var'
    ? cpVarEmbedConfirmacao(p.userId, { titulo: p.titulo, dias: p.dias }, p.valor)
    : cpEmbedConfirmacao(p.userId, p.quantidade, p.valor);
  if (p.cupom) {
    e.setDescription(`${(e.data && e.data.description) || ''}\n\n🎟️ Cupom \`${p.cupom}\`: **-${p.desconto}%** (de ${formatarValor(p.valorOriginal)} por ${formatarValor(p.valor)})`);
  }
  if (p.revendaCodigo) {
    e.setDescription(`${(e.data && e.data.description) || ''}\n\n🤝 Código de indicação \`${p.revendaCodigo}\``);
  }
  return e;
}
async function cpCriarCarrinhoVariavel(userId, username, canalId, guildId, v) {
  if (!DJS.ChannelType) return { ok: false, motivo: 'Compra indisponível (discord.js real não carregado).' };
  for (const [tid, p] of [...carrinhos.entries()]) {
    if (p.userId !== userId) continue;
    const existe = await botClient.channels.fetch(tid).catch(() => null);
    if (existe) return { ok: false, motivo: `Você já tem um carrinho aberto: <#${tid}>` };
    carrinhos.delete(tid);
    cpSalvar();
  }
  const canal = botClient.channels.cache.get(canalId) || await botClient.channels.fetch(canalId).catch(() => null);
  if (!canal || !canal.threads || canal.type !== DJS.ChannelType.GuildText) {
    return { ok: false, motivo: 'Abra o painel em um canal de texto de servidor para criar o carrinho.' };
  }
  const valor = Number(v.preco);
  const pagamentoPromise = MP_TOKEN ? cpCriarPagamentoMP(userId, v.dias, valor) : null;
  if (pagamentoPromise) pagamentoPromise.catch(logErro);
  let thread;
  try {
    thread = await canal.threads.create({
      name: `🛒 Compra — ${username}`.slice(0, 100),
      autoArchiveDuration: 60,
      type: DJS.ChannelType.GuildPrivateThread,
      invitable: false,
      reason: 'Nova compra de key'
    });
  } catch (e) {
    return { ok: false, motivo: `Não consegui criar o tópico privado: ${e.message} (o bot precisa de "Criar Tópicos Privados" e "Gerenciar Tópicos").` };
  }
  await thread.members.add(userId).catch(logErro);
  setTimeout(async () => {
    try {
      const recentes = await canal.messages.fetch({ limit: 5 });
      for (const m of recentes.values()) {
        if (m.type === DJS.MessageType.ThreadCreated && m.thread && m.thread.id === thread.id) await m.delete().catch(logErro);
      }
    } catch {}
  }, 1000);
  carrinhos.set(thread.id, {
    tipo: 'var', userId, username, varId: v.id, titulo: v.titulo, dias: v.dias,
    quantidade: v.dias, rotulo: `KEY ${v.dias} DIAS`, valor,
    guildId: guildId || null, canalId,
    paymentId: null, copiaECola: null, qrBase64: null, criadoEm: Date.now()
  });
  cpSalvar();
  if (pagamentoPromise) cpAplicarPagamento(thread.id, pagamentoPromise); else cpPrepararPagamento(thread.id);
  await thread.send({
    content: `<@${userId}>`,
    embeds: [cpVarEmbedConfirmacao(userId, v, valor)],
    components: [cpLinhaConfirmacao({ tipo: 'var' })]
  }).catch(logErro);
  logEmbed('geral', '🛒 Carrinho de key CRIADO', [
    ['👤 Comprador', `<@${userId}>`, true],
    ['📦 Produto', v.titulo || '—', true],
    ['➕ Dias', `${v.dias} dia(s)`, true],
    ['💰 Valor', formatarValor(valor), true]
  ], userId).catch(logErro);
  return { ok: true, threadId: thread.id };
}
// ============================================================
// CARGOS DE CLIENTE POR SERVIDOR (/server-ativar)
// CLIENTE AUTOMED (cinza, permanente) • AUTOMED ATIVO (verde, sai quando a key acaba) • CLIENTE FIEL (branco, mais de 3 compras)
// Cargos criados SEM nenhuma permissão e na última posição (logo acima do @everyone).
// ============================================================
const CARGOS_PATH = path.join(__dirname, 'cargos_servidores.json');
const CARGOS_DEF = {
  cliente: { nome: 'CLIENTE AUTOMED', cor: 0x95A5A6 },
  ativo:   { nome: 'AUTOMED ATIVO',   cor: 0x2ECC71 },
  fiel:    { nome: 'CLIENTE FIEL',    cor: 0xFFFFFF }
};
const CLIENTE_FIEL_MIN_COMPRAS = 4; // "mais de 3 compras" = a partir da 4ª
function cargosCarregar() {
  try { const j = JSON.parse(fs.readFileSync(CARGOS_PATH, 'utf8')); return j && typeof j === 'object' && !Array.isArray(j) ? j : {}; } catch { return {}; }
}
function cargosSalvar(o) {
  try { fs.writeFileSync(`${CARGOS_PATH}.tmp`, JSON.stringify(o, null, 2)); fs.renameSync(`${CARGOS_PATH}.tmp`, CARGOS_PATH); } catch (e) { aviso(`Salvar cargos: ${e.message}`); }
}
async function cargosCriarNoServidor(guild) {
  const me = guild.members.me || await guild.members.fetchMe();
  if (!me.permissions.has('ManageRoles')) throw new Error('o bot não tem a permissão **Gerenciar cargos** neste servidor');
  const db = cargosCarregar();
  const reg = db[guild.id] || { roles: {}, compras: {} };
  reg.roles = reg.roles || {};
  reg.compras = reg.compras || {};
  await guild.roles.fetch();
  const resultado = [];
  for (const chave of ['fiel', 'ativo', 'cliente']) {
    const def = CARGOS_DEF[chave];
    let role = (reg.roles[chave] && guild.roles.cache.get(reg.roles[chave])) || guild.roles.cache.find(r => r.name === def.nome) || null;
    let criado = false;
    if (!role) {
      role = await guild.roles.create({ name: def.nome, color: def.cor, permissions: [], hoist: false, mentionable: false, reason: '/server-ativar' });
      criado = true;
    } else if (role.permissions.bitfield !== 0n) {
      await role.setPermissions([], '/server-ativar: cargo sem permissões').catch(e => aviso(`Cargo ${def.nome}: não consegui zerar permissões (${e.message})`));
    }
    await role.setPosition(1, { reason: '/server-ativar: último cargo do servidor' }).catch(e => aviso(`Cargo ${def.nome}: não consegui mover para o fim (${e.message})`));
    reg.roles[chave] = role.id;
    resultado.push({ chave, id: role.id, nome: def.nome, criado });
    await esperar(600);
  }
  reg.criadoEm = reg.criadoEm || Date.now();
  db[guild.id] = reg;
  cargosSalvar(db);
  return resultado;
}
async function serverAtivarComando(interacao) {
  if (!interacao.guild) { await responderTexto(interacao, '❌ Use este comando dentro de um servidor.'); return; }
  await interacao.deferReply(EFEMERO);
  try {
    const r = await cargosCriarNoServidor(interacao.guild);
    const linhas = ['cliente', 'ativo', 'fiel'].map(k => r.find(x => x.chave === k)).map(x => `${x.criado ? '✅ criado' : '♻️ já existia'}: <@&${x.id}>`);
    await interacao.editReply({
      content: '# Cargos ativados neste servidor\n' + linhas.join('\n') +
        '\n\n-# Sem nenhuma permissão e na última posição. Quem comprar aqui recebe **CLIENTE AUTOMED** e **AUTOMED ATIVO**; a partir da 4ª compra também **CLIENTE FIEL**. O **AUTOMED ATIVO** sai quando a key acabar.',
      allowedMentions: { parse: [] }
    });
    sucesso(`🏷️ /server-ativar em ${interacao.guild.name} (${interacao.guild.id})`);
  } catch (e) {
    erro(`/server-ativar: ${e.message}`);
    await interacao.editReply({ content: `❌ Não consegui criar os cargos: ${e.message}`, allowedMentions: { parse: [] } }).catch(logErro);
  }
}
// Compra entregue: dá CLIENTE + ATIVO (e FIEL a partir da 4ª compra) no servidor onde comprou. Nunca derruba a entrega da key.
async function cargosAplicarCompra(guildId, userId, contaCompra = true) {
  try {
    if (!guildId || !userId) return;
    const db = cargosCarregar();
    const reg = db[String(guildId)];
    if (!reg || !reg.roles) return;
    const guild = botClient && botClient.guilds.cache.get(String(guildId));
    if (!guild) return;
    const membro = await guild.members.fetch(String(userId)).catch(() => null);
    if (!membro) { aviso(`[Cargos] ${userId} não está no servidor ${guildId} — cargos não entregues.`); return; }
    reg.compras = reg.compras || {};
    let n = reg.compras[String(userId)] || 0;
    if (contaCompra) { n += 1; reg.compras[String(userId)] = n; cargosSalvar(db); }   // .semanaladd NÃO conta como compra
    const dar = [['cliente', reg.roles.cliente], ['ativo', reg.roles.ativo]];
    if (contaCompra && n >= CLIENTE_FIEL_MIN_COMPRAS) dar.push(['fiel', reg.roles.fiel]);
    for (const [nome, rid] of dar) {
      if (!rid || !guild.roles.cache.has(rid) || membro.roles.cache.has(rid)) continue;
      await membro.roles.add(rid, 'Compra de key').catch(e => aviso(`[Cargos] não consegui dar ${nome} a ${userId}: ${e.message}`));
    }
    sucesso(`🏷️ [Cargos] ${userId} em ${guild.name}: ${contaCompra ? `compra nº ${n}` : 'semanal'} — cargos entregues.`);
  } catch (e) { aviso(`[Cargos] compra: ${e.message}`); }
}
// Key expirou: tira AUTOMED ATIVO nos servidores onde a pessoa comprou (CLIENTE e FIEL ficam).
async function cargosRemoverAtivo(rec) {
  try {
    if (!rec || !rec.usadaPor || !botClient) return;
    const guilds = new Set([...(rec.cargosGuilds || []), rec.compraGuildId].filter(Boolean).map(String));
    if (!guilds.size) return;
    const db = cargosCarregar();
    for (const gid of guilds) {
      const reg = db[gid];
      if (!reg || !reg.roles || !reg.roles.ativo) continue;
      const guild = botClient.guilds.cache.get(gid);
      if (!guild) continue;
      const membro = await guild.members.fetch(String(rec.usadaPor)).catch(() => null);
      if (membro && membro.roles.cache.has(reg.roles.ativo)) {
        await membro.roles.remove(reg.roles.ativo, 'Key expirada').catch(e => aviso(`[Cargos] não consegui tirar AUTOMED ATIVO de ${rec.usadaPor}: ${e.message}`));
        info(`🏷️ [Cargos] AUTOMED ATIVO removido de ${rec.usadaPor} em ${guild.name} (key expirou).`);
      }
    }
  } catch (e) { aviso(`[Cargos] expiração: ${e.message}`); }
}
// .perm (só o dono): os 3 cargos de cliente veem ESTE canal, mas não enviam mensagem, não criam tópico e não falam em tópico.
async function comandoPermCargos(mensagem) {
  const resp = txt => mensagem.reply({ content: txt, allowedMentions: { parse: [], repliedUser: false } }).catch(logErro);
  try {
    const guild = mensagem.guild;
    let canal = mensagem.channel;
    if (canal && typeof canal.isThread === 'function' && canal.isThread()) canal = canal.parent;
    if (!guild || !canal || !canal.permissionOverwrites) { await resp('❌ Use em um canal do servidor.'); return; }
    const reg = cargosCarregar()[guild.id];
    const ids = reg && reg.roles ? ['cliente', 'ativo', 'fiel'].map(k => reg.roles[k]).filter(r => r && guild.roles.cache.has(r)) : [];
    if (ids.length < 3) { await resp('❌ Os cargos ainda não existem aqui. Rode `/server-ativar` primeiro.'); return; }
    for (const rid of ids) {
      await canal.permissionOverwrites.edit(rid, {
        ViewChannel: true,
        ReadMessageHistory: true,
        SendMessages: false,
        CreatePublicThreads: false,
        CreatePrivateThreads: false,
        SendMessagesInThreads: false
      }, { reason: '.perm: cargos de cliente só visualizam este canal' });
    }
    sucesso(`🏷️ .perm em #${canal.name} (${guild.name}): 3 cargos só visualizam.`);
    await resp(`✅ Os 3 cargos agora **veem** <#${canal.id}>, mas não enviam mensagem, não criam tópico e não falam em tópico.`);
  } catch (e) {
    erro(`.perm: ${e.message}`);
    await resp(`❌ Não consegui aplicar: ${e.message}`);
  }
}
// ---------------- HISTÓRICO DE VENDAS POR SERVIDOR (/historico) ----------------
// 1 linha por venda de key (AutoMed), gravada na hora com fsync. Só entra venda feita dentro de um servidor.
const VENDAS_LOG_PATH = path.join(__dirname, 'vendas_servidores.jsonl');
const vendasLog = [];
const vendasLogChaves = new Set();
let vendasLogPronto = false;
function jsonlAcrescentar(caminho, r) {
  const fd = fs.openSync(caminho, 'a', 0o600);
  try {
    fs.writeSync(fd, JSON.stringify(r) + '\n');
    try { fs.fsyncSync(fd); } catch {}
  } finally { fs.closeSync(fd); }
}
function vendasLogIniciar() {
  if (vendasLogPronto) return;
  vendasLogPronto = true;
  try {
    if (!fs.existsSync(VENDAS_LOG_PATH)) return;
    for (const ln of fs.readFileSync(VENDAS_LOG_PATH, 'utf8').split('\n')) {
      if (!ln.trim()) continue;
      try {
        const r = JSON.parse(ln);
        if (r && r.k && !vendasLogChaves.has(r.k)) { vendasLog.push(r); vendasLogChaves.add(r.k); }
      } catch {}
    }
  } catch (e) { aviso(`vendas_servidores.jsonl ilegível: ${e.message}`); }
}
function vendasLogRegistrar(p, chave, comissaoCents) {
  try {
    if (!p || !p.guildId) return false;
    vendasLogIniciar();
    const k = `h|${chave}`.slice(0, 120);
    if (vendasLogChaves.has(k)) return false;
    const valorCents = Math.round(Number(p.valor) * 100);
    const r = {
      k, ts: Date.now(), guildId: String(p.guildId), userId: String(p.userId),
      titulo: String(p.titulo || '').slice(0, 60), dias: Number(p.dias) || 0,
      valorCents: Number.isFinite(valorCents) ? valorCents : 0,
      comissaoCents: Number(comissaoCents) || 0
    };
    jsonlAcrescentar(VENDAS_LOG_PATH, r);
    vendasLog.push(r);
    vendasLogChaves.add(k);
    return true;
  } catch (e) { erro(`Venda NÃO gravada no histórico (${chave}): ${e.message}`); return false; }
}
function historicoAgregar(lista) {
  const por = new Map();
  for (const r of lista) {
    const x = por.get(r.guildId) || { guildId: r.guildId, vendas: 0, valorCents: 0, comissaoCents: 0, ultima: 0 };
    x.vendas++;
    x.valorCents += Number(r.valorCents) || 0;
    x.comissaoCents += Number(r.comissaoCents) || 0;
    x.ultima = Math.max(x.ultima, Number(r.ts) || 0);
    por.set(r.guildId, x);
  }
  return [...por.values()].sort((a, b) => (b.valorCents - b.comissaoCents) - (a.valorCents - a.comissaoCents));
}
async function historicoComando(interacao) {
  vendasLogIniciar();
  const linhasAgr = historicoAgregar(vendasLog);
  const reais = c => formatarValor(c / 100);
  const embed = new EmbedBuilder().setColor(COR.keys).setTitle('📜 Histórico de vendas do AutoMed').setFooter({ text: NOME_MARCA });
  if (!linhasAgr.length) {
    embed.setDescription('Nenhum servidor registrou venda de AutoMed ainda.\n\n-# O histórico passou a ser gravado agora: vendas feitas antes disso não foram guardadas com servidor e valor.');
    await interacao.reply({ embeds: [embed], ...EFEMERO });
    return;
  }
  const totalVendas = linhasAgr.reduce((s, x) => s + x.vendas, 0);
  const totalValor = linhasAgr.reduce((s, x) => s + x.valorCents, 0);
  const totalLucro = linhasAgr.reduce((s, x) => s + (x.valorCents - x.comissaoCents), 0);
  const nome = gid => { const g = botClient && botClient.guilds.cache.get(gid); return g ? g.name : `Servidor ${gid}`; };
  const cab = [
    `**${linhasAgr.length}** servidor(es) • **${totalVendas}** venda(s)`,
    `💰 Vendido: **${reais(totalValor)}** • 🏦 Lucro: **${reais(totalLucro)}**`,
    ''
  ].join('\n');
  const rodape = '\n\n-# Lucro = valor vendido − 30% do dono do servidor (só em servidores de terceiros). Ordenado pelo maior lucro.' +
    `\n-# Registrado desde <t:${Math.floor(Math.min(...vendasLog.map(r => Number(r.ts) || Date.now())) / 1000)}:d>.`;
  let corpo = '';
  let mostrados = 0;
  for (const [i, x] of linhasAgr.entries()) {
    const l = `**${i + 1}. ${String(nome(x.guildId)).slice(0, 60)}** (\`${x.guildId}\`)\n└ ${x.vendas} venda(s) • vendido ${reais(x.valorCents)} • **lucro ${reais(x.valorCents - x.comissaoCents)}** • última <t:${Math.floor(x.ultima / 1000)}:R>\n`;
    if ((cab + corpo + l + rodape + '\n… e mais 999 servidor(es)').length > 4000) break;
    corpo += l;
    mostrados++;
  }
  const resto = linhasAgr.length - mostrados;
  embed.setDescription(cab + corpo + (resto > 0 ? `\n… e mais ${resto} servidor(es)` : '') + rodape);
  await interacao.reply({ embeds: [embed], ...EFEMERO });
}
// ============================================================
// /extratosalas — salas gastas por servidor do Discord (período)
// ============================================================
const EXT_PERIODOS = [
  { v: '1d', label: '1 dia' },
  { v: '7d', label: '7 dias' },
  { v: '10d', label: '10 dias' },
  { v: '30d', label: '30 dias' },
  { v: 'all', label: 'Todo período' }
];
// Descobre em qual servidor do Discord a sala foi criada:
// - chaves s|cmd|CANAL|... → guild pelo canal (cache do client ou salasAtivas)
// - chaves s|api|SESSÃO...  → guild via salasAtivas (sessão ainda ativa)
// Sem identificação, entra em "Não identificado".
function extGuildDeRegistro(r) {
  try {
    const k = String(r.k || '');
    if (k.startsWith('s|cmd|')) {
      const canalId = k.split('|')[2];
      const sa = salasAtivas.get(canalId);
      if (sa && sa.guildId) return String(sa.guildId);
      const ch = botClient && botClient.channels && botClient.channels.cache.get(canalId);
      if (ch && ch.guildId) return String(ch.guildId);
    } else if (k.startsWith('s|api|')) {
      const sid = k.slice('s|api|'.length);
      for (const sa of salasAtivas.values()) if (sa.sid === sid && sa.guildId) return String(sa.guildId);
    }
    const m = k.match(/\|(\d{17,20})\|/);
    if (m) {
      const ch = botClient && botClient.channels && botClient.channels.cache.get(m[1]);
      if (ch && ch.guildId) return String(ch.guildId);
    }
  } catch {}
  return null;
}
function extMontar(periodo) {
  salasLogIniciar();
  const agora = Date.now();
  const diasMs = { '1d': 1, '7d': 7, '10d': 10, '30d': 30 }[periodo];
  const por = new Map();
  let total = 0;
  for (const r of salasLog) {
    if (diasMs && (agora - (Number(r.ts) || 0)) > diasMs * 86400000) continue;
    const gid = extGuildDeRegistro(r) || 'sem_guild';
    const x = por.get(gid) || { gid, salas: 0 };
    x.salas++;
    por.set(gid, x);
    total++;
  }
  const lista = [...por.values()].sort((a, b) => b.salas - a.salas);
  const nome = gid => {
    if (gid === 'sem_guild') return '🌐 Não identificado';
    const g = botClient && botClient.guilds.cache.get(gid);
    return g ? g.name : `Servidor \`${gid}\``;
  };
  const rotulo = (EXT_PERIODOS.find(p => p.v === periodo) || EXT_PERIODOS[4]).label;
  const corpo = lista.length
    ? lista.map((x, i) => `**${i + 1}.** ${nome(x.gid)} — **${x.salas}** sala(s)`).join('\n')
    : '_Nenhuma sala registrada neste período._';
  const embed = new EmbedBuilder()
    .setColor(COR.salas)
    .setTitle('🎮 Extrato de salas por servidor')
    .setDescription(
      `**Período:** ${rotulo}\n` +
      `**Total:** ${total} sala(s) em **${lista.length}** servidor(es)\n\n` +
      corpo
    )
    .setFooter({ text: NOME_MARCA });
  return {
    embeds: [embed],
    components: [menu('ext_per', 'Selecione o período...', EXT_PERIODOS.map(p => ({ label: p.label, value: p.v, default: p.v === periodo })))]
  };
}
async function cpEntregarKey(p) {
  const keys = carregarKeys();
  const ativa = keyAtivaDoUsuario(p.userId);
  let rec;
  let estendida = false;
  if (ativa) {
    // Usuário já tem key ativa: NÃO gera outra — estende a atual e envia a MESMA key.
    rec = ativa;
    rec.expiraEm = (rec.expiraEm || Date.now()) + p.dias * 86400000;
    rec.congeladaEm = null;
    rec.expiradaTratada = false;
    // Extensão NÃO muda o servidor da key (vale o servidor da compra original).
    if (!rec.compraGuildId && rec.origem === 'compra') rec.compraGuildId = p.guildId || null;
    estendida = true;
    sucesso(`🔑 Key ${rec.chave} ESTENDIDA +${p.dias} dia(s) para ${p.userId} via compra (nova expiração <t:${Math.floor(rec.expiraEm / 1000)}:R>)`);
    logKey('Key ESTENDIDA (compra)', rec);
  } else {
    rec = gerarKey(p.dias, p.userId);
    rec.usadaPor = p.userId;
    rec.usadaEm = Date.now();
    rec.expiraEm = Date.now() + p.dias * 86400000;
    rec.congeladaEm = null;
    rec.expiradaTratada = false;
    rec.origem = 'compra';
    rec.compraGuildId = p.guildId || null;
    sucesso(`🔑 Key ${rec.chave} ativada por ${p.userId} (${p.dias} dia(s)) via compra`);
    logKey('Key ATIVADA (compra)', rec);
  }
  if (p.orgGuildId) rec.orgGuildId = String(p.orgGuildId);
  const vincCompra = keyServidorVinculado(rec);
  if (vincCompra && !rec.orgGuildId) sucesso(`🔒 Key ${rec.chave} vinculada ao servidor ${vincCompra} (servidor da compra).`);
  if (p.guildId) rec.cargosGuilds = Array.from(new Set([...(rec.cargosGuilds || []), String(p.guildId)]));
  salvarKeys(keys);
  const embed = new EmbedBuilder()
    .setColor(COR.keys)
    .setTitle(estendida ? '✅ Compra aprovada — sua key foi estendida' : '✅ Compra aprovada — sua key de acesso')
    .setDescription(
      `Olá <@${p.userId}>! Obrigado pela compra de **${p.titulo}**.\n\n` +
      (estendida
        ? `Você já possuía uma key ativa, então **adicionamos ${p.dias} dia(s)** nela.\n\n`
        : `Sua key de acesso:\n`)
      + `\`\`\`${rec.chave}\`\`\`\n` +
      `⏳ Válida até <t:${Math.floor(rec.expiraEm / 1000)}:F> (<t:${Math.floor(rec.expiraEm / 1000)}:R>)` +
      (keyServidorVinculado(rec) ? `\n\n🔒 Esta key vale **somente no servidor** \`${keyServidorVinculado(rec)}\` (automed e autopay).` : '')
    )
    .setFooter({ text: NOME_MARCA });
  try {
    const usr = await botClient.users.fetch(p.userId);
    await usr.send({ embeds: [embed] });
  } catch (e) {
    aviso(`[Loja] não consegui enviar a key na DM de ${p.userId}: ${e.message}`);
  }
  logEmbed('geral', estendida ? '🔑 Key ESTENDIDA (compra)' : '🔑 Key ENTREGUE (compra)', [
    ['?? Comprador', `<@${p.userId}>`, true],
    ['📦 Produto', p.titulo || '—', true],
    ['➕ Dias', `${p.dias} dia(s)`, true],
    ['🔑 Key', `\`${rec.chave}\``, false]
  ], p.userId).catch(logErro);
  await cargosAplicarCompra(p.guildId, p.userId);
  return rec;
}
// ============================================================
// EMOJIS — Application Emojis do próprio bot (portado do Zeroun Salas)
// ------------------------------------------------------------
// • Coloque PNG/GIF/WEBP na pasta `emojis/` e reinicie: o bot sobe sozinho os que faltam.
// • O mapa nome → { id, animated } fica em `emojis.json`.
// • E.get('check') devolve o emoji do bot se existir; senão o Unicode de reserva (nunca quebra).
// • Pra cada nome `x` existe a versão amarela `y_x`: quando ela existe, vence a antiga.
// • Desligar o envio automático: AUTO_EMOJIS=false no .env.
// ============================================================
const EMOJIS_JSON_PATH = path.join(__dirname, 'emojis.json');
const EMOJIS_DIR = path.join(__dirname, 'emojis');
const EMOJI_UNICODE = {
    // ── Fallbacks Unicode dos emojis amarelos gerados a partir dos emojis soltos do código ──
    y_circle: '🟢',
    y_square: '⬜',
    y_circle_dot: '🔘',
    y_circle_help: '❔',
    y_arrow_right: '➞',
    y_tv: '📺',
    y_settings: '⚙',
    y_drama: '🎭',
    y_hourglass: '⏳',
    y_landmark: '🏦',
    y_credit_card: '💳',
    y_ticket: '🎫',
    y_clipboard_list: '📋',
    y_notepad_text: '🗒',
    y_shopping_basket: '🧺',
    y_map_pin: '📍',
    y_pin: '📌',
    y_paperclip: '📎',
    y_plus: '➕',
    y_minus: '➖',
    y_trash_2: '🗑',
    y_wrench: '🛠',
    y_medal: '🥉',
    y_bot: '🤖',
    y_lock_keyhole: '🔐',
    y_target: '🎯',
    y_repeat: '🔁',
    y_shirt: '🧥',
    y_snowflake: '❄',
    y_hard_hat: '🧢',
    y_crosshair: '🔫',
    y_gamepad_2: '🎮',
    y_party_popper: '🎉',
    y_bed: '🛏',
    y_star: '⭐',
    y_key_round: '🔑',
    y_laptop: '💻',
    y_smartphone: '📱',
    y_monitor: '🖥',
    y_puzzle: '🧩',
    y_timer: '⏱',
    y_eye: '👁',
    y_cloud: '☁',
    y_triangle_alert: '⚠',
    y_ban: '🚫',
    y_image: '🖼',
    y_pencil_line: '📝',
    y_pencil: '✏',
    y_heart: '💛',
    y_bell_off: '🔕',
    y_message_circle: '💬',
    y_shopping_bag: '👜',
    y_handshake: '🤝',
    y_piggy_bank: '💰',
    y_hand_coins: '💸',
    y_diamond: '🔹',
    y_sparkles: '✨',
    y_user_round: '👤',
    y_play: '▶',
    y_x: '✖',
    y_check: '✔',
    y_circle_check: '✅',
    y_circle_x: '❌',
    y_truck: '🚚',
    y_shopping_cart: '🛒',
    y_siren: '🚨',
    y_building_2: '🏢',
    y_hash: '🔢',
    y_calendar_days: '📅',
    y_palette: '🎨',
    y_brush: '🖌',
    y_house: '🏠',
    y_waves: '🌊',
    y_send: '📤',
    y_crown: '👑',
    y_chart_column: '📊',
    y_shield_check: '🛡',
    y_flag: '🚩',
    y_plug: '🔌',
    y_case_upper: '🔠',
    y_folder: '📁',
    y_refresh_cw: '🔄',
    y_info: 'ℹ',
    y_bookmark: '🔖',
    y_sun: '☀',
    y_moon: '🌙',
    y_gem: '💎',
    y_wand_sparkles: '🔮',
    y_trophy: '🏆',
    y_hand: '👋',
    y_swords: '⚔',
    y_apple: '🍎',
    // ── Amarelos (#087CFF, Lucide) do /central ──
    // O PNG de cada um está em emojis/y_*.png e sobe sozinho no boot. Até
    // subir (ou se falhar), estes Unicode entram no lugar.
    y_wallet: '👛', y_saque: '💸', y_banknote: '💵', y_coins: '🪙', y_crown: '👑',
    y_infinity: '♾️', y_users: '👥', y_settings: '⚙️', y_shield: '🛡️', y_key: '🔑',
    y_clock: '⏰', y_history: '📜', y_check: '✅', y_x: '❌', y_alert: '⚠️',
    y_percent: '💯', y_zap: '⚡', y_qr: '📱', y_copy: '📋', y_back: '◀️',
    y_refresh: '🔄', y_trending: '📈', y_store: '🏪', y_gamepad: '🎮', y_send: '📤',
    y_lock: '🔒', y_calendar: '📅', y_tag: '🏷️', y_pencil: '✏️', y_landmark: '🏦',
    y_sliders: '🎚️', y_bot: '🤖', y_receipt: '🧾', y_link: '🔗', y_layers: '📚',
    // ── Estado / resultado ──
    check: '✅',
    success: '✅',
    // `cancel` é a chave oficial de erro/fechar. `close` fica como apelido.
    cancel: '❌',
    close: '❌',
    warning: '⚠️',
    info: 'ℹ️',
    // ── Navegação ──
    arrow_back: '◀️',
    left: '◀️',
    rigth: '▶️',
    refresh: '🔄',
    loading: '⏳',
    clock: '⏰',
    as_time: '⏱️',
    // ── Segurança ──
    key: '🔑',
    hash: '#️⃣',
    lock: '🔒',
    unlock: '🔓',
    shield: '🛡️',
    block: '🚫',
    hammer: '🔨',
    wrench: '🔧',
    // ── Dinheiro ──
    balance: '💰',
    coin: '🪙',
    dollar: '💵',
    wallet: '👛',
    card: '💳',
    cardbox: '💳',
    receipt: '🧾',
    valor_2: '💲',
    pix: '💠',
    suportecoins: '🪙',
    // ── Marcadores de lista ──
    pontoextreme: '🔸',
    wponto: '🔹',
    dir: '▫️',
    e_: '🔸',
    emoji_78: '🔹',
    emoji_79: '🔹',
    menos: '➖',
    minus: '➖',
    add: '➕',
    // ── Loja ──
    cart: '🛒',
    basket: '🧺',
    bag: '👜',
    store: '🏪',
    coupon: '🎟️',
    discount: '🏷️',
    gift: '🎁',
    // ── Salas / jogo ──
    rooms: '🎮',
    infinito: '♾️',
    // `espadas` é o ícone de alvo/meta do bot. `target` é apelido.
    espadas: '🎯',
    target:  '🎯',
    salinha2: '🎮',
    cube: '🧊',
    jigsaw: '🧩',
    embed: '🧩',
    embeds: '🧩',
    // ── Ranking e números ──
    crown: '👑',
    achievement: '🏆',
    medal: '🏅',
    gold: '🥇',
    silver: '🥈',
    bronze: '🥉',
    building: '🏢',
    celebration: '🎉',
    stats: '📊',
    chart: '📈',
    // `activity` e `dollar` são apelidos: usam a arte de `stats` e `money`.
    activity: '📊',
    // ── Conteúdo ──
    logs: '📋',
    layers: '📚',
    layout: '🗂️',
    folder: '📁',
    pencil: '✏️',
    description: '📄',
    settings: '⚙️',
    slash: '⌨️',
    wand: '🪄',
    brush: '🖌️',
    // `palette` é a chave oficial de cor. As três abaixo ficam como apelido
    // pra não quebrar código antigo, mas o arquivo a subir é `palette.png`.
    palette: '🎨',
    paint: '🎨',
    color: '🎨',
    colorpicker: '🎨',
    // ── Mídia e visão ──
    image: '🖼️',
    'Image': '🖼️',
    thumbnail: '🖼️',
    visible: '👁️',
    discover: '🔎',
    world: '🌐',
    web: '🌐',
    // ── Metas e alertas ──
    belloff: '🔕',
    fire: '🔥',
    star: '⭐',
    ticket: '🎫',
    calendar: '📅',
    search: '🔍',
    sets: '🗃️',

    // ── Comunicação ──
    channel: '💬',
    feedback: '💬',
    call2: '📞',
    bell: '🔔',
    link: '🔗',
    invite: '📨',
    upload: '📤',
    save: '💾',
    // ── Pessoas e diversos ──
    users: '👥',
    account: '👤',
    author: '✍️',
    bot: '🤖',
    online: '🟢',
    cloud: '☁️',
    trashcan: '🗑️',
    emoji_29: '🔒',
    yellow_raio: '⚡',
    // ── Chaves criadas junto com os emojis próprios ──
    // Todas com fallback Unicode: se o PNG não for enviado (`node emojis.js`),
    // o botão continua com um ícone em vez de ficar vazio.
    play:          '▶️',
    arrow_forward: '➡️',
    money:         '💵',
    banner:        '🖼️',
    heartmoney:    '💝',
    qrcode:        '🔳',
    rocket:        '🚀',
    sparkles:      '✨',
    userconfig:    '👤',
    pix:           '💠',
    pencil:        '✏️',

    // ── Novo pack (167 ícones) — nomes que não existiam antes na tabela.
    // Fallback Unicode só pra nunca ficar vazio antes do `node emojis.js`
    // subir o PNG de verdade pro Application Emoji do bot.
    android:       '🤖',
    announcementc: '📢',
    aqua:          '🩵',
    attach:        '📎',
    bank:          '🏦',
    blue:          '🔵',
    boost1:        '🚀',
    boost2:        '🚀',
    boost3:        '🚀',
    bug:           '🐛',
    checkbook:     '🧾',
    chip:          '🔵',
    clipboard:     '📋',
    code:          '💻',
    content:       '🗂️',
    danger:        '🚨',
    database:      '🗄️',
    discord:       '🎮',    disket:        '💾',
    dnd:           '⛔',
    dots:          '⋯',
    down:          '⬇️',
    download:      '📥',
    drag:          '↕️',
    education:     '🎓',
    epicgames:     '🎮',
    facebook:      '📘',
    fatal:         '💀',
    fav:           '⭐',
    field:         '📝',
    file:          '📄',
    flask:         '🧪',
    footer:        '📃',
    forum:         '💬',
    git:           '🌿',
    github:        '🐙',
    gray:          '⚪',
    green:         '🟢',
    hearth:        '❤️',
    hidden:        '🙈',
    home:          '🏠',
    idle:          '🌙',
    instagram:     '📸',
    invisible:     '⚫',
    keyboard:      '⌨️',
    laptop:        '💻',
    lightning:     '⚡',
    linkedin:      '💼',
    location:      '📍',
    message:       '✉️',
    mic:           '🎤',
    mobile:        '📱',
    mouse:         '🖱️',
    mute:          '🔇',
    nitro:         '💎',
    notion:        '📓',
    orange:        '🟠',
    paypal:        '💸',
    pin:           '📌',
    ping:          '📶',
    pink:          '🩷',
    playstation:   '🎮',
    plug:          '🔌',
    plus:          '➕',
    purple:        '🟣',
    red:           '🔴',
    refreshing:    '🔄',
    remove:        '🗑️',
    report:        '🚩',
    role:          '🏷️',
    roller:        '🖌️',
    route:         '🗺️',
    signal:        '📶',
    sparks:        '✨',
    spinning:      '🔄',
    spotify:       '🎵',
    steam:         '🎮',
    suitcase:      '💼',
    telegram:      '✈️',
    textc:         '📝',
    tiktok:        '🎵',
    timestamp:     '🕒',
    toright:       '➡️',
    truck:         '🚚',
    twitch:        '📺',
    up:            '⬆️',
    url:           '🔗',
    voicec:        '🔊',
    vscode:        '💻',
    webhook:       '🪝',
    whatsapp:      '💬',
    wifi:          '📶',
    window:        '🪟',
    windows:       '🪟',
    xbox:          '🎮',
    xtwitter:      '🐦',
    youtube:       '▶️',

    // Selo de verificação (badge branco com check) — pedido pra usar no
    // header do log de "Sala criada" no lugar do check genérico.
    verified:      '✅',
    // Ticket amarelo com o cubo — usado no botão "N criadas" (contador da
    // org) e em qualquer lugar que hoje usa `rooms`/`salinha2` genérico.
    salinha:       '🎫',

    // ── Varredura geral de emojis crus (troca de ✅❌⚠️🔑💰👤🏠🗑️👑 etc.
    // por E.get() em tudo que faltava) — chaves novas que já tinham PNG no
    // pack mas nenhum lugar do código usava pelo nome exato do arquivo.
    message_circle: '💬',
    house:          '🏠',
    mail:           '📩',
    flame:          '🔥',
    trophy:         '🏆',
    // `crown` e `trash_2` são ícones novos (reconstruídos no estilo Lucide
    // "crown" e "trash-2") — não existiam nem como Unicode fallback antes.
    crown:          '👑',
    trash_2:        '🗑️',
    podium:         '🥇', // disponível pra uso geral (ex: resumo de ranking)

    // Alvos de apelidos "custom sem PNG ainda" (ver ALIASES mais abaixo:
    // kick/logout→log_out, announcement→megaphone, status→chart_up,
    // star2→star_circle) que não tinham NENHUMA entrada aqui — sem isso,
    // `E.get()` seguia a cadeia de apelidos até não achar nada e voltava
    // string vazia (bug real: o botão "Expulsar Jogadores" usa `kick` e
    // ficava sem ícone nenhum). Com o Unicode aqui, some o ícone some;
    // se algum dia o PNG correspondente for enviado (`node emojis.js`),
    // ele assume automaticamente no lugar deste fallback.
    log_out:        '🚪',
    megaphone:      '📣',
    chart_up:       '📈',
    star_circle:    '🌟',
    circle_check:   '☑️',
};
const EMOJI_ALIASES = {
    // O Modo Flash usava o raio AMARELO (`yellow_raio.png`, removido do
    // pack). O novo pack trouxe um `lightning.png` de propósito pra isso.
    flash:       'lightning',
    fields:      'pencil',
    title:       'pencil',
    transfer:    'refresh',
    server:      'coupon',
    chart:       'stats',
    activity:    'stats',
    dollar:      'money',
    close:       'cancel',
    success:     'check',
    target:      'espadas',
    paint:       'palette',
    color:       'palette',
    colorpicker: 'palette',
    wand:        'pencil',
    image:       'banner',
    cart:        'money',
    basket:      'money',
    feedback:    'channel',
    menos:       'minus',
    pontoextreme: 'wponto',
    e_:          'wponto',
    emoji_78:    'wponto',
    emoji_79:    'wponto',
    dir:         'wponto',
    salinha2:    'salinha',
    coin:        'money',
    suportecoins: 'money',
    valor_2:     'money',
    cardbox:     'card',
    receipt:     'card',
    store:       'coupon',
    discount:    'coupon',
    layers:      'logs',
    layout:      'logs',
    description: 'pencil',
    author:      'pencil',
    embeds:      'jigsaw',
    upload:      'refresh',
    clock:       'as_time',
    cube:        'salinha',
    author:      'pencil',
    embeds:      'jigsaw',
    upload:      'refresh',
    clock:       'as_time',
    cube:        'salinha',
    nome:        'pencil',
    embed:       'jigsaw',
    embeds:      'jigsaw',
    slash:       'settings',

    // ── Pack novo (167+2 ícones): nomes antigos que perderam o PNG próprio
    // (removidos do pack "amarelo") agora reaproveitam a arte nova mais
    // parecida. Só entra em ação DEPOIS que `node emojis.js` subir os
    // arquivos — até lá, cada um continua com o fallback Unicode de sempre,
    // então nada muda visualmente antes do upload.
    arrow_back:   'left',
    arrow_forward: 'toright',
    as_time:      'clock',
    balance:      'bank',
    banner:       'thumbnail',
    bronze:       'orange',
    building:     'home',
    call2:        'mic',
    channel:      'forum',
    desktop:      'laptop',
    heartmoney:   'hearth',
    link:         'url',
    loading:      'spinning',
    logs:         'clipboard',
    medal:        'fav',
    palette:      'color',
    pix:          'chip',
    save:         'disket',
    sets:         'content',
    silver:       'gray',
    sparkles:     'sparks',
    star:         'fav',
    stats:        'chart',
    userconfig:   'account',
    brush:       'palette',
    web:         'world',
    thumbnail:   'thumbnail',

    // Ícone novo (reconstruído a partir do Lucide "log-out": colchete
    // aberto + seta saindo) — usado no botão "Expulsar Jogadores".
    kick:        'log_out',
    logout:      'log_out',

    // Ícones novos (medalha, estrela, top1/troféu, anúncio, status) —
    // troféu e medalha usados no /ranking (1º e 2º lugar); os outros dois
    // ficam disponíveis pra uso geral no bot.
    top1:        'trophy',
    announcement: 'megaphone',
    status:      'chart_up',
    star2:       'star_circle',

    // ── Log de "Sala criada" (utils/logger.js) e outros logs do Logger —
    // usavam nomes sem PNG próprio (por isso ficavam sempre no fallback
    // Unicode, mesmo depois do `node emojis.js`). Aqui cada um passa a
    // reaproveitar o ícone do pack mais parecido.
    verified:     'circle_check', // selo de verificação (badge) — distinto do check genérico
    yellow_raio:  'lightning',
    infinito:     'infinity',
    timestamp:    'clock',
    achievement:  'trophy',
};

const E = (() => {
  const cache = { ...EMOJI_UNICODE };
  let personalizados = 0;
  let sincronizando = false;
  const EXT_OK = ['.png', '.gif', '.jpg', '.jpeg', '.webp'];
  const LIMITE_BYTES = 256 * 1024;
  const LIMITE_TOTAL = 2000;

  function parseCustom(valor) {
    const m = /^<(a?):([a-zA-Z0-9_]+):(\d+)>$/.exec(String(valor || ''));
    return m ? { id: m[3], name: m[2], animated: m[1] === 'a' } : null;
  }
  // Lê o emojis.json. Entrada com ID/nome inválido é ignorada (o Unicode continua valendo).
  function carregar() {
    for (const k of Object.keys(cache)) if (String(cache[k]).startsWith('<')) delete cache[k];
    Object.assign(cache, EMOJI_UNICODE);
    personalizados = 0;
    try {
      if (!fs.existsSync(EMOJIS_JSON_PATH)) return 0;
      const dados = JSON.parse(fs.readFileSync(EMOJIS_JSON_PATH, 'utf8'));
      for (const [nome, inf] of Object.entries(dados || {})) {
        if (!inf || !/^\d{17,20}$/.test(String(inf.id)) || nome.length > 32) continue;
        cache[nome] = `<${inf.animated ? 'a' : ''}:${nome}:${inf.id}>`;
        personalizados++;
      }
    } catch (e) { aviso(`[Emojis] emojis.json inválido — seguindo só com Unicode: ${e.message}`); }
    return personalizados;
  }
  function get(name) {
    if (!name) return '';
    if (!String(name).startsWith('y_')) {
      const amarelo = cache['y_' + name];
      if (amarelo && amarelo.startsWith('<') && amarelo.length <= 100) return amarelo;
    }
    const direto = cache[name];
    if (direto && direto.length > 100) return '';
    if (direto && direto.startsWith('<')) return direto;
    let alvo = EMOJI_ALIASES[name];
    let unicodeDoCaminho = null;
    const visitados = new Set([name]);
    while (alvo && !visitados.has(alvo)) {
      visitados.add(alvo);
      const doAlvo = cache[alvo];
      if (doAlvo && doAlvo.length > 100) { alvo = EMOJI_ALIASES[alvo]; continue; }
      if (doAlvo && doAlvo.startsWith('<')) return doAlvo;
      if (doAlvo && !unicodeDoCaminho) unicodeDoCaminho = doAlvo;
      alvo = EMOJI_ALIASES[alvo];
    }
    return direto || unicodeDoCaminho || '';
  }
  // Só Unicode — pra onde emoji personalizado não renderiza (placeholder de select, título de modal...).
  function plain(name) {
    let k = name;
    for (let i = 0; i < 6 && k; i++) {
      const v = EMOJI_UNICODE[k];
      if (v && !String(v).startsWith('<')) return v;
      k = EMOJI_ALIASES[k];
    }
    return '';
  }
  // Objeto de emoji pra botões/selects ({ id, name, animated } ou { name }).
  function obj(name) {
    const v = get(name);
    if (!v) return undefined;
    return parseCustom(v) || { name: v };
  }
  function withEmoji(name) { const o = obj(name); return o ? { emoji: o } : {}; }

  function nomeValido(arquivo) {
    const base = path.basename(arquivo, path.extname(arquivo));
    let nome = base.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 32);
    if (nome.length < 2) nome = `e_${nome}`;
    return nome;
  }
  // Se a pasta `emojis/` não existe (o pacote veio só com o emojis.zip), extrai o zip sozinho — sem biblioteca extra.
  function extrairZipEmojis() {
    try {
      const zipPath = path.join(__dirname, 'emojis.zip');
      if (!fs.existsSync(zipPath) || arquivosDaPasta().length) return 0;
      const zlibE = require('zlib');
      const buf = fs.readFileSync(zipPath);
      const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
      if (eocd < 0) return 0;
      const total = buf.readUInt16LE(eocd + 10);
      let off = buf.readUInt32LE(eocd + 16);
      fs.mkdirSync(EMOJIS_DIR, { recursive: true });
      let n = 0;
      for (let i = 0; i < total; i++) {
        if (buf.readUInt32LE(off) !== 0x02014b50) break;
        const metodo = buf.readUInt16LE(off + 10), csize = buf.readUInt32LE(off + 20);
        const nomeLen = buf.readUInt16LE(off + 28), extraLen = buf.readUInt16LE(off + 30), comLen = buf.readUInt16LE(off + 32);
        const lho = buf.readUInt32LE(off + 42);
        const nome = buf.toString('utf8', off + 46, off + 46 + nomeLen);
        off += 46 + nomeLen + extraLen + comLen;
        const base = path.basename(nome);
        if (nome.endsWith('/') || !EXT_OK.includes(path.extname(base).toLowerCase())) continue;
        const ini = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
        const dados = buf.subarray(ini, ini + csize);
        const saida = metodo === 0 ? dados : (metodo === 8 ? zlibE.inflateRawSync(dados) : null);
        if (!saida) continue;
        fs.writeFileSync(path.join(EMOJIS_DIR, base), saida);
        n++;
      }
      if (n) info(`[Emojis] pasta emojis/ não existia — extraí ${n} arquivo(s) do emojis.zip.`);
      return n;
    } catch (e) { aviso(`[Emojis] não consegui extrair o emojis.zip: ${e.message}`); return 0; }
  }
  function arquivosDaPasta() {
    try {
      if (!fs.existsSync(EMOJIS_DIR)) return [];
      return fs.readdirSync(EMOJIS_DIR).filter(f => EXT_OK.includes(path.extname(f).toLowerCase())).sort();
    } catch { return []; }
  }
  function gravarMapa(mapa) {
    try {
      const tmp = `${EMOJIS_JSON_PATH}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(mapa, null, 2));
      fs.renameSync(tmp, EMOJIS_JSON_PATH);
      return true;
    } catch (e) { aviso(`[Emojis] não consegui gravar emojis.json: ${e.message}`); return false; }
  }
  // Compara a pasta com os emojis que a aplicação já tem e envia só o que falta (em segundo plano,
  // respeitando o rate limit). A verdade é a API: o emojis.json é reescrito a partir dela.
  // A pasta `emojis/` não precisa estar extraída: se só existir o emojis.zip ao lado do index.js, extrai sozinho (sem pacote extra).
  function extrairZipEmojis() {
    try {
      const zipPath = path.join(__dirname, 'emojis.zip');
      if (!fs.existsSync(zipPath) || arquivosDaPasta().length) return 0;
      const zl = require('zlib');
      const buf = fs.readFileSync(zipPath);
      const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
      if (eocd < 0) return 0;
      const total = buf.readUInt16LE(eocd + 10);
      let p = buf.readUInt32LE(eocd + 16), n = 0;
      fs.mkdirSync(EMOJIS_DIR, { recursive: true });
      for (let i = 0; i < total; i++) {
        if (buf.readUInt32LE(p) !== 0x02014b50) break;
        const metodo = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
        const nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), lho = buf.readUInt32LE(p + 42);
        const nome = buf.slice(p + 46, p + 46 + nlen).toString('utf8');
        p += 46 + nlen + elen + clen;
        const base = path.basename(nome);
        if (nome.endsWith('/') || !EXT_OK.includes(path.extname(base).toLowerCase())) continue;
        const ini = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
        const dados = buf.slice(ini, ini + csize);
        fs.writeFileSync(path.join(EMOJIS_DIR, base), metodo === 0 ? dados : zl.inflateRawSync(dados));
        n++;
      }
      if (n) info(`[Emojis] emojis.zip extraído: ${n} arquivo(s) na pasta emojis/.`);
      return n;
    } catch (e) { aviso(`[Emojis] não consegui extrair o emojis.zip: ${e.message}`); return 0; }
  }
  async function sincronizar(client) {
    if (sincronizando) return;
    extrairZipEmojis();
    if (String(process.env.AUTO_EMOJIS || '').toLowerCase() === 'false') return;
    if (!client || !client.application || !client.application.emojis) return;
    sincronizando = true;
    try {
      extrairZipEmojis();
      const existentes = await client.application.emojis.fetch();
      const mapa = {};
      for (const e of existentes.values()) mapa[e.name] = { id: e.id, animated: !!e.animated };
      gravarMapa(mapa);
      carregar();
      const faltantes = arquivosDaPasta().filter(a => !mapa[nomeValido(a)]);
      if (!faltantes.length) { sucesso(`[Emojis] sincronizados — ${existentes.size} no bot, ${personalizados} em uso.`); sincronizando = false; return; }
      info(`[Emojis] enviando ${faltantes.length} emoji(s) novo(s) em segundo plano...`);
      let enviados = 0, falhas = 0;
      for (const arq of faltantes) {
        const nome = nomeValido(arq);
        const caminho = path.join(EMOJIS_DIR, arq);
        let tam = 0;
        try { tam = fs.statSync(caminho).size; } catch { continue; }
        if (tam > LIMITE_BYTES) { aviso(`[Emojis] "${nome}" passa de 256 KB — pulei.`); falhas++; continue; }
        if (existentes.size + enviados >= LIMITE_TOTAL) { aviso(`[Emojis] limite de ${LIMITE_TOTAL} emojis atingido.`); break; }
        try {
          const criado = await client.application.emojis.create({ attachment: caminho, name: nome });
          mapa[nome] = { id: criado.id, animated: !!criado.animated };
          enviados++;
          if (enviados % 20 === 0) { gravarMapa(mapa); carregar(); }
          await esperar(700);
        } catch (e) {
          falhas++;
          aviso(`[Emojis] falha ao enviar "${nome}": ${e.message}`);
          if (/rate limit/i.test(String(e.message))) await esperar(5000);
        }
      }
      gravarMapa(mapa);
      carregar();
      sucesso(`[Emojis] sincronização concluída: ${enviados} enviado(s)${falhas ? `, ${falhas} falha(s)` : ''}.`);
    } catch (e) { aviso(`[Emojis] não consegui sincronizar: ${e.message}`); }
    sincronizando = false;
  }
  carregar();
  return { carregar, get, plain, obj, withEmoji, sincronizar, nomeValido, list: () => Object.keys(cache), UNICODE: EMOJI_UNICODE };
})();

// ============================================================
// DROP DE DIAS DE KEY (portado do /enviardrop do Zeroun Salas)
// ------------------------------------------------------------
// /enviardrop enviar      — publica um drop agora, uma vez.
// /enviardrop automatico  — publica drops sozinho, a cada X horas, num canal fixo.
// /enviardrop desligar    — desliga o automático.   /enviardrop status — mostra a configuração.
// Quem clicar em "Resgatar" já recebe os dias: a key é criada e ATIVADA na hora; se a pessoa já
// tem key ativa, os dias são somados nela (mesma regra da compra). Tudo gravado em drops.json.
// ============================================================
const DROPS_PATH = path.join(__dirname, 'drops.json');
// Faixa de dias, cor e chance (peso) de cada raridade. Edite aqui pra mudar o prêmio.
const DROP_RARIDADES = {
  comum:    { label: 'Comum',    emoji: '⚪', cor: '#9E9E9E', min: 1,  max: 3,  peso: 50 },
  raro:     { label: 'Raro',     emoji: '🔵', cor: '#2E86FF', min: 3,  max: 7,  peso: 30 },
  epico:    { label: 'Épico',    emoji: '🟣', cor: '#9B30FF', min: 7,  max: 15, peso: 15 },
  lendario: { label: 'Lendário', emoji: '🟡', cor: '#FFB800', min: 15, max: 30, peso: 5 }
};
const DROP_INTERVALO_CICLO_MS = 30 * 1000;
const DROP_RETENCAO_MS = 30 * 86400000;   // drops com mais de 30 dias saem do arquivo

let dropsCache = null;
function dropsCarregar() {
  if (dropsCache) return dropsCache;
  try {
    if (fs.existsSync(DROPS_PATH)) {
      const d = JSON.parse(fs.readFileSync(DROPS_PATH, 'utf8'));
      if (d && typeof d === 'object') {
        dropsCache = { drops: d.drops && typeof d.drops === 'object' ? d.drops : {}, auto: d.auto && typeof d.auto === 'object' ? d.auto : {} };
        return dropsCache;
      }
    }
  } catch (e) {
    try { fs.copyFileSync(DROPS_PATH, DROPS_PATH + '.bak'); } catch {}
    aviso(`drops.json corrompido (backup em drops.json.bak): ${e.message}`);
  }
  dropsCache = { drops: {}, auto: {} };
  return dropsCache;
}
function dropsSalvar() {
  const db = dropsCarregar();
  const corte = Date.now() - DROP_RETENCAO_MS;
  for (const [id, d] of Object.entries(db.drops)) if (d && d.createdAt && d.createdAt < corte) delete db.drops[id];
  const tmp = DROPS_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DROPS_PATH);
}
const dropRar = r => DROP_RARIDADES[r] || DROP_RARIDADES.comum;
function dropSortearDias(raridade) {
  const r = dropRar(raridade);
  return Math.floor(Math.random() * (r.max - r.min + 1)) + r.min;
}
function dropSortearRaridade() {
  const entradas = Object.entries(DROP_RARIDADES);
  let alvo = Math.random() * entradas.reduce((s, [, r]) => s + r.peso, 0);
  for (const [chave, r] of entradas) { alvo -= r.peso; if (alvo <= 0) return chave; }
  return 'comum';
}
function dropRotuloIntervalo(horas) {
  return horas >= 1 ? `${horas} hora${horas === 1 ? '' : 's'}` : `${Math.round(horas * 60)} minutos`;
}
const dropDiasTxt = n => `${n} dia${n === 1 ? '' : 's'}`;

// ---- Telas ----
function dropTelaAtiva(drop, marcar) {
  const r = dropRar(drop.raridade);
  const vagas = drop.maxWinners || 1;
  const restantes = Math.max(0, vagas - (drop.winners || []).length);
  const linhas = [];
  if (marcar) linhas.push('@everyone');
  linhas.push(
    `## ${r.emoji} Drop ${r.label}`,
    '> Apareceu um drop de **dias de key AutoMed**! Corre que é por ordem de chegada.',
    '',
    `${E.get('key') || '🔑'} **Prêmio:** \`${dropDiasTxt(drop.dias)}\` de key`,
    `${E.get('users') || '👥'} **Vagas:** \`${restantes}\` de \`${vagas}\` disponíveis`,
    '',
    '-# Clique em Resgatar pra receber a key na hora — ela já vem ativada.'
  );
  const botao = btn(`drop_resgatar:${drop.id}`, 'Resgatar Drop', ButtonStyle.Success, E.get('gift') || '🎁');
  const p = painel({ cor: r.cor, texto: linhas.join('\n'), linhas: [linhaBotoes(botao)] });
  if (!V2_OK && marcar) p.content = '@everyone';
  return p;
}
function dropTelaEsgotada(drop) {
  const r = dropRar(drop.raridade);
  const blocos = (drop.winners || []).map(w =>
    `${E.get('account') || '👤'} **Usuário:** <@${w.userId}>\n${E.get('key') || '🔑'} **Ganhou:** \`${dropDiasTxt(drop.dias)}\` de key`
  ).join('\n\n');
  return painel({
    cor: r.cor,
    texto: [
      `## ${E.get('gift') || '🎁'} Drop Resgatado`,
      '> Esse drop foi resgatado, veja as informações abaixo.',
      '',
      '### Informações',
      blocos || '—',
      '',
      `-# ${r.emoji} Drop ${r.label}`
    ].join('\n')
  });
}
function dropTelaAviso(texto, cor = COR.erro) { return painel({ cor, texto }); }
// Respostas de drop são sempre efêmeras (só quem clicou/usou vê).
function dropResponder(interacao, p) { return interacao.reply(opcoesResposta(p, true)); }
function dropMensagemPublica(drop, marcar) {
  const p = dropTelaAtiva(drop, marcar);
  p.allowedMentions = marcar ? { parse: ['everyone'] } : { parse: [] };
  return p;
}

// ---- Entrega da key (mesma regra da compra: estende a key ativa, senão cria e ativa) ----
function dropEntregarKey({ userId, dias, guildId, dropId, criadoPor }) {
  const keys = carregarKeys();
  const ativa = keyAtivaDoUsuario(userId);
  let rec, estendida = false;
  if (ativa) {
    rec = ativa;
    rec.expiraEm = (rec.expiraEm || Date.now()) + dias * 86400000;   // congelada continua congelada: só soma ao que sobra
    rec.expiradaTratada = false;
    estendida = true;
    sucesso(`🎁 Key ${rec.chave} ESTENDIDA +${dias} dia(s) para ${userId} via drop (expira <t:${Math.floor(rec.expiraEm / 1000)}:R>)`);
    logKey('Key ESTENDIDA (drop)', rec);
  } else {
    rec = gerarKey(dias, criadoPor || 'drop');
    rec.usadaPor = userId;
    rec.usadaEm = Date.now();
    rec.expiraEm = Date.now() + dias * 86400000;
    rec.congeladaEm = null;
    rec.expiradaTratada = false;
    rec.origem = 'drop';
    rec.dropId = dropId;
    sucesso(`🎁 Key ${rec.chave} ativada por ${userId} (${dias} dia(s)) via drop`);
    logKey('Key ATIVADA (drop)', rec);
  }
  if (guildId) rec.cargosGuilds = Array.from(new Set([...(rec.cargosGuilds || []), String(guildId)]));
  salvarKeys(keys);
  return { rec, estendida };
}
async function dropAvisarGanhador(userId, dias, rec, estendida) {
  try {
    const embed = new EmbedBuilder()
      .setColor(COR.keys)
      .setTitle(estendida ? '🎁 Drop resgatado — sua key foi estendida' : '🎁 Drop resgatado — sua key de acesso')
      .setDescription(
        `Parabéns <@${userId}>! Você ganhou **${dropDiasTxt(dias)}** de AutoMed.\n\n` +
        (estendida ? 'Você já tinha uma key ativa, então **somamos os dias** nela.\n\n' : 'Sua key já está **ativada** na sua conta:\n\n') +
        `\`\`\`${rec.chave}\`\`\`\n` +
        `⏳ Válida até <t:${Math.floor(rec.expiraEm / 1000)}:F> (<t:${Math.floor(rec.expiraEm / 1000)}:R>)`
      )
      .setFooter({ text: NOME_MARCA });
    const usr = await botClient.users.fetch(userId);
    await usr.send({ embeds: [embed] });
  } catch (e) { aviso(`[Drop] não consegui enviar a key na DM de ${userId}: ${e.message}`); }
}

// ---- Resgate (botão "Resgatar Drop") — qualquer pessoa pode clicar ----
function dropReservarVaga(dropId, userId) {
  const db = dropsCarregar();
  const d = db.drops[dropId];
  if (!d) return { ok: false, erro: 'inexistente' };
  d.winners = d.winners || [];
  if (d.winners.some(w => w.userId === userId)) return { ok: false, erro: 'ja_pegou' };
  if (d.winners.length >= (d.maxWinners || 1)) return { ok: false, erro: 'esgotado' };
  d.winners.push({ userId, em: Date.now() });
  return { ok: true, drop: d, esgotado: d.winners.length >= (d.maxWinners || 1) };
}
async function dropResgatarBotao(interacao, dropId) {
  const userId = interacao.user.id;
  if (interacao.user.bot) return;
  // Seção crítica síncrona (sem await): dois cliques simultâneos nunca passam do limite de vagas.
  const r = dropReservarVaga(dropId, userId);
  if (!r.ok) {
    const msg = {
      inexistente: `### ${E.get('cancel') || '❌'} Este drop não existe mais.`,
      ja_pegou: `### ${E.get('cancel') || '❌'} Você já resgatou este drop.`,
      esgotado: `### ${E.get('cancel') || '❌'} Vagas esgotadas\n> Todo mundo que podia resgatar já resgatou. Fique de olho no próximo drop!`
    }[r.erro];
    await dropResponder(interacao, dropTelaAviso(msg));
    return;
  }
  const drop = r.drop;
  let entrega;
  try {
    entrega = dropEntregarKey({ userId, dias: drop.dias, guildId: interacao.guildId || drop.guildId, dropId: drop.id, criadoPor: drop.createdBy });
    dropsSalvar();
  } catch (e) {
    // Falhou ao entregar: devolve a vaga pra pessoa poder tentar de novo.
    drop.winners = (drop.winners || []).filter(w => w.userId !== userId);
    try { dropsSalvar(); } catch {}
    erro(`[Drop] falha ao entregar key de ${dropDiasTxt(drop.dias)} para ${userId}: ${e.message}`);
    await dropResponder(interacao, dropTelaAviso(`### ${E.get('cancel') || '❌'} Não consegui entregar a key\n> Tente clicar de novo em instantes.`));
    return;
  }
  const { rec, estendida } = entrega;
  sucesso(`[Drop] ${drop.id} resgatado por ${userId} · vaga ${drop.winners.length}/${drop.maxWinners || 1} · ${dropDiasTxt(drop.dias)}`);
  // Atualiza a mensagem pública: continua ativa com o contador, ou vira a tela final.
  let atualizou = true;
  try {
    const tela = r.esgotado ? dropTelaEsgotada(drop) : dropTelaAtiva(drop, false);
    await interacao.update({ ...tela, allowedMentions: { parse: [] } });
  } catch (e) { atualizou = false; aviso(`[Drop] não consegui editar a mensagem do drop: ${e.message}`); }
  const texto = [
    `### ${E.get('check') || '✅'} Parabéns!`,
    `> Você ganhou **${dropDiasTxt(drop.dias)}** de AutoMed.${estendida ? ' Os dias foram **somados** na sua key ativa.' : ' Sua key já foi **ativada**.'}`,
    '',
    `${E.get('key') || '🔑'} \`${rec.chave}\``,
    `${E.get('clock') || '⏰'} Expira <t:${Math.floor(rec.expiraEm / 1000)}:R>`,
    '',
    '-# Use /central pra configurar. A key também foi enviada na sua DM.'
  ].join('\n');
  const resp = opcoesResposta(dropTelaAviso(texto, COR.pagamentos), true);
  if (atualizou) await interacao.followUp(resp).catch(logErro);
  else await interacao.reply(resp).catch(logErro);
  dropAvisarGanhador(userId, drop.dias, rec, estendida).catch(logErro);
  cargosAplicarCompra(interacao.guildId || drop.guildId, userId, false).catch(logErro);
  logEmbed('geral', 'Drop resgatado', [
    ['🎁 Drop', `\`${drop.id}\``, false],
    ['⏳ Dias', dropDiasTxt(drop.dias), true],
    ['🏷️ Raridade', dropRar(drop.raridade).label, true],
    ['🔑 Key', `\`${rec.chave}\``, false]
  ], userId).catch(logErro);
}

// ---- Publicação ----
async function dropPublicar({ canal, guildId, raridade, dias, maxWinners, marcar, createdBy, prefixoId = 'drop' }) {
  const drop = {
    id: `${prefixoId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    guildId, channelId: canal.id, messageId: null,
    dias, raridade, maxWinners,
    winners: [],
    createdBy, createdAt: Date.now()
  };
  const msg = await canal.send(dropMensagemPublica(drop, marcar));
  drop.messageId = msg.id;
  const db = dropsCarregar();
  db.drops[drop.id] = drop;
  dropsSalvar();
  return { drop, msg };
}

// ---- Automático ----
async function dropDispararAuto(guildId, cfg) {
  const canal = await botClient.channels.fetch(cfg.channelId).catch(() => null);
  if (!canal || typeof canal.send !== 'function') {
    aviso(`[Drop] canal do automático sumiu (guild ${guildId}) — desliguei o automático.`);
    const db = dropsCarregar();
    if (db.auto[guildId]) { db.auto[guildId].enabled = false; dropsSalvar(); }
    return;
  }
  const raridade = dropSortearRaridade();
  let dias = dropSortearDias(raridade);
  if (cfg.diasMax) dias = Math.max(1, Math.min(dias, cfg.diasMax));
  await dropPublicar({ canal, guildId, raridade, dias, maxWinners: cfg.maxWinners || 1, marcar: cfg.marcar !== false, createdBy: 'auto', prefixoId: 'drop_auto' });
  sucesso(`[Drop] automático enviado · guild=${guildId} · ${dropRar(raridade).label} · ${dropDiasTxt(dias)}`);
}
let dropAutoRodando = false, dropAutoInicio = 0, dropAutoIniciado = false;
async function dropCicloAuto() {
  const db = dropsCarregar();
  const agora = Date.now();
  for (const [guildId, cfg] of Object.entries(db.auto)) {
    if (!cfg || !cfg.enabled || !cfg.channelId) continue;
    if (agora < (cfg.nextFireAt || 0)) continue;
    // Reagenda a partir de AGORA (não do nextFireAt antigo): se o bot ficou fora do ar, não sai rajada de drops atrasados.
    cfg.nextFireAt = Date.now() + (cfg.intervalMs || 3600000);
    dropsSalvar();
    try { await dropDispararAuto(guildId, cfg); }
    catch (e) { erro(`[Drop] falha ao enviar drop automático (guild ${guildId}): ${e.message}`); }
  }
}
function iniciarDropAuto() {
  if (dropAutoIniciado) return;
  dropAutoIniciado = true;
  setInterval(async () => {
    if (dropAutoRodando) {
      if (Date.now() - dropAutoInicio < 5 * 60 * 1000) return;
      aviso('[Drop] ciclo travado há mais de 5min — reiniciando.');
    }
    dropAutoRodando = true; dropAutoInicio = Date.now();
    try { await dropCicloAuto(); } catch (e) { erro(`[Drop] erro no ciclo: ${e.message}`); }
    finally { dropAutoRodando = false; }
  }, DROP_INTERVALO_CICLO_MS);
  sucesso(`🎁 Poller de drop automático ativo (checagem a cada ${DROP_INTERVALO_CICLO_MS / 1000}s).`);
}

// ---- Comando /enviardrop (somente o dono) ----
async function dropComando(interacao) {
  if (!ehLiberado(interacao.user.id)) { await dropResponder(interacao, dropTelaAviso('⛔ Apenas o dono pode usar este comando.')); return; }
  const sub = interacao.options.getSubcommand(false);
  if (!sub) {
    await dropResponder(interacao, dropTelaAviso(`### ${E.get('warning') || '⚠️'} Comando desatualizado\n> O Discord ainda está com a versão antiga do \`/enviardrop\`. Reinicie o bot e tente de novo em alguns minutos.`, COR.sistema));
    return;
  }
  if (!interacao.guildId) { await dropResponder(interacao, dropTelaAviso('⛔ Use este comando dentro de um servidor.')); return; }
  const db = dropsCarregar();

  if (sub === 'enviar') {
    const raridade = interacao.options.getString('raridade') || 'comum';
    const maxWinners = interacao.options.getInteger('vencedores') || 1;
    const diasFixos = interacao.options.getInteger('dias');
    const marcar = interacao.options.getBoolean('marcar_everyone') !== false;
    const canal = interacao.options.getChannel('canal') || interacao.channel;
    const r = dropRar(raridade);
    const dias = diasFixos || dropSortearDias(raridade);
    if (!canal || typeof canal.send !== 'function') { await dropResponder(interacao, dropTelaAviso('❌ Canal inválido.')); return; }
    await interacao.deferReply(EFEMERO);
    try {
      const { drop, msg } = await dropPublicar({ canal, guildId: interacao.guildId, raridade, dias, maxWinners, marcar, createdBy: interacao.user.id });
      await interacao.editReply(dropTelaAviso([
        `### ${E.get('check') || '✅'} Drop enviado!`,
        `> ${r.emoji} **Raridade:** ${r.label}`,
        `> ${E.get('key') || '🔑'} **Prêmio:** \`${dropDiasTxt(dias)}\`${diasFixos ? ' (fixo)' : ` (sorteado entre ${r.min}-${r.max})`} para cada um dos \`${maxWinners}\` vencedor(es)`,
        `> **Canal:** <#${canal.id}> · [ver mensagem](${msg.url})`
      ].join('\n'), r.cor));
      sucesso(`[Drop] ${drop.id} enviado por ${interacao.user.id} em #${canal.id}: ${r.label}, ${dropDiasTxt(dias)}, ${maxWinners} vaga(s)`);
    } catch (e) {
      await interacao.editReply(dropTelaAviso(`### ${E.get('cancel') || '❌'} Erro ao enviar o drop\n> ${String(e.message || e).slice(0, 300)}\n-# Confira se o bot pode ver e enviar mensagens em <#${canal.id}>.`));
    }
    return;
  }

  if (sub === 'automatico') {
    const horas = interacao.options.getNumber('intervalo_horas');
    const canal = interacao.options.getChannel('canal');
    const diasMax = interacao.options.getInteger('dias_max') || null;
    const maxWinners = interacao.options.getInteger('vencedores') || 1;
    const marcar = interacao.options.getBoolean('marcar_everyone') !== false;
    if (!canal || typeof canal.send !== 'function') { await dropResponder(interacao, dropTelaAviso('❌ Canal inválido.')); return; }
    const intervaloMs = Math.round(horas * 3600000);
    db.auto[interacao.guildId] = {
      enabled: true, intervalMs: intervaloMs, channelId: canal.id, diasMax, maxWinners, marcar,
      nextFireAt: Date.now() + intervaloMs, updatedBy: interacao.user.id, updatedAt: Date.now()
    };
    dropsSalvar();
    const label = dropRotuloIntervalo(horas);
    await dropResponder(interacao, dropTelaAviso([
      `### ${E.get('check') || '✅'} Drop automático ligado`,
      `> **A cada:** \`${label}\``,
      `> **Canal:** <#${canal.id}>`,
      `> **Prêmio:** sorteado por raridade${diasMax ? ` (até \`${dropDiasTxt(diasMax)}\`)` : ''}`,
      `> **Vagas por drop:** \`${maxWinners}\``,
      '',
      `-# O primeiro drop cai em ${label}. Use /enviardrop status pra acompanhar.`
    ].join('\n'), COR.pagamentos));
    return;
  }

  if (sub === 'desligar') {
    const atual = db.auto[interacao.guildId];
    if (!atual || !atual.enabled) { await dropResponder(interacao, dropTelaAviso(`### ${E.get('info') || 'ℹ️'} Já está desligado.`, COR.principal)); return; }
    atual.enabled = false;
    dropsSalvar();
    await dropResponder(interacao, dropTelaAviso(`### ${E.get('check') || '✅'} Drop automático desligado.`, COR.pagamentos));
    return;
  }

  if (sub === 'status') {
    const cfg = db.auto[interacao.guildId];
    if (!cfg || !cfg.enabled) {
      await dropResponder(interacao, dropTelaAviso(`### ${E.get('info') || 'ℹ️'} Drop automático desligado\n-# Use /enviardrop automatico pra ligar.`, COR.principal));
      return;
    }
    const proximoMin = Math.max(0, Math.round((cfg.nextFireAt - Date.now()) / 60000));
    await dropResponder(interacao, dropTelaAviso([
      `### ${E.get('check') || '✅'} Drop automático ativo`,
      `> **A cada:** \`${dropRotuloIntervalo(cfg.intervalMs / 3600000)}\``,
      `> **Canal:** <#${cfg.channelId}>`,
      `> **Prêmio:** sorteado por raridade${cfg.diasMax ? ` (até \`${dropDiasTxt(cfg.diasMax)}\`)` : ''}`,
      `> **Vagas por drop:** \`${cfg.maxWinners || 1}\``,
      `> **Próximo em:** \`~${proximoMin} min\``
    ].join('\n'), COR.pagamentos));
    return;
  }
}
const DROP_COMANDO_DEF = {
  name: 'enviardrop',
  description: 'Gerencia os drops de dias de key do AutoMed (somente o dono)',
  dmPermission: false,
  options: [
    { type: 1, name: 'enviar', description: 'Envia um drop agora, uma única vez', options: [
      { type: 3, name: 'raridade', description: 'Raridade do drop (define a faixa de dias)', required: false,
        choices: Object.entries(DROP_RARIDADES).map(([v, r]) => ({ name: `${r.emoji} ${r.label} (${r.min}-${r.max} dias)`, value: v })) },
      { type: 4, name: 'vencedores', description: 'Quantos podem resgatar (padrão: 1)', required: false, minValue: 1, maxValue: 50 },
      { type: 4, name: 'dias', description: 'Forçar uma quantidade exata de dias (ignora o sorteio da raridade)', required: false, minValue: 1, maxValue: 365 },
      { type: 7, name: 'canal', description: 'Canal do drop (padrão: o canal atual)', required: false, channelTypes: [0, 5] },
      { type: 5, name: 'marcar_everyone', description: 'Marcar @everyone no drop (padrão: sim)', required: false }
    ] },
    { type: 1, name: 'automatico', description: 'Liga o envio automático de drops em intervalos', options: [
      { type: 10, name: 'intervalo_horas', description: 'De quanto em quanto tempo (ex: 1 = a cada hora, 0.5 = a cada 30 min)', required: true, minValue: 0.25, maxValue: 24 },
      { type: 7, name: 'canal', description: 'Canal onde os drops automáticos serão enviados', required: true, channelTypes: [0, 5] },
      { type: 4, name: 'dias_max', description: 'Teto de dias por drop (padrão: sem teto, vale a faixa da raridade)', required: false, minValue: 1, maxValue: 365 },
      { type: 4, name: 'vencedores', description: 'Quantos podem resgatar cada drop (padrão: 1)', required: false, minValue: 1, maxValue: 50 },
      { type: 5, name: 'marcar_everyone', description: 'Marcar @everyone em cada drop (padrão: sim)', required: false }
    ] },
    { type: 1, name: 'desligar', description: 'Desliga o envio automático de drops neste servidor' },
    { type: 1, name: 'status', description: 'Mostra a configuração automática atual' }
  ]
};
// Chamado no começo de tratarInteracao: o botão "Resgatar Drop" é público (não exige key nem liberação).
async function dropInterceptar(interacao) {
  const ehBotao = typeof interacao.isButton === 'function' && interacao.isButton();
  if (!ehBotao) return false;
  const id = String(interacao.customId || '');
  if (!id.startsWith('drop_resgatar:')) return false;
  await dropResgatarBotao(interacao, id.slice('drop_resgatar:'.length));
  return true;
}

let botClient;
function configurarBot(c) {
botClient = c;
// expõe p/ appAcao (fora deste escopo) — corrige "iniciarSelfbot is not defined"
globalThis.iniciarSelfbot = iniciarSelfbot;
globalThis.responderTexto = globalThis.responderTexto || responderTexto;
async function registrarComandos() {
  try {
    if (!botClient.application) return;
    await botClient.application.commands.set([
      { name: 'central', description: 'Enviar o painel de Mediação Automatizada' },
      { name: 'central-antiban', description: 'Painel de Mediação Automatizada sem token (100% antiban)' },
      { name: 'gerarpix', description: 'Gerar cobrança PIX no canal (somente o dono)' },
      { name: 'variaveis', description: 'Gerenciar as variáveis da loja (somente o dono)' },
      { name: 'painel-compra', description: 'Enviar o painel de compra de keys' },
      { name: 'keys', description: 'Gerenciar as keys de acesso (somente o dono)' },
      { name: 'admin', description: 'Painel admin (somente o dono)' },
      { name: 'perfil', description: 'Ver seu perfil de salas, senha fixa e tempo de go' },
      { name: 'auto-mensagem', description: 'Gerencia as auto-mensagens (somente o dono)' },
      { name: 'criar-cupom', description: 'Cria, exclui e envia cupons de desconto (somente o dono)' },
      { name: 'codigo-promocional', description: 'Gerencia códigos promocionais com ORG de servidor (somente o dono)' },
      { name: 'painel-revenda', description: 'Enviar o painel de revenda/indicação' },
      { name: 'mudar', description: 'Trocar o gateway de pagamento do AutoMed (somente o dono)' },
      { name: 'valorsala', description: 'Define o valor das salas do AutoMed neste servidor (somente o dono)', dmPermission: false },
      { name: 'canal-mediacoes', description: 'Escolhe o canal onde saem as mediações concluídas (somente o dono)', dmPermission: false },
      { name: 'criar-logs', description: 'Verifica se os canais de logs existem — não cria nada (somente administradores)', defaultMemberPermissions: '8', dmPermission: false },
      { name: 'excluir-logs', description: 'Apaga os canais e a categoria de logs (somente administradores)', defaultMemberPermissions: '8', dmPermission: false },
      { name: 'personalizar', description: 'Muda avatar, banner e nome do bot neste servidor (somente administradores)', defaultMemberPermissions: '8', dmPermission: false },
      { name: 'link-bot', description: 'Envia o embed com o botão para adicionar o bot (somente o dono)' },
      { name: 'antiban', description: 'Gerencia os servidores em modo antiban (somente o dono)', dmPermission: false },
      { name: 'server-ativar', description: 'Cria os cargos de cliente neste servidor (somente o dono)', dmPermission: false },
      { name: 'historico', description: 'Servidores que já venderam AutoMed e o lucro de cada um (somente o dono)' },
      { name: 'extratosalas', description: 'Salas gastas por servidor no período (somente o dono)' },
      { name: 'ranking', description: 'Mostra o ranking de mediadores (mensagem pública)' },
      DROP_COMANDO_DEF,
      { name: 'teste', description: 'Envia um embed de teste para acionar o AutoMed (somente liberados)', options: [
        { type: 10, name: 'valor', description: 'Valor da aposta em R$ (padrão: 1)', required: false },
        { type: 6, name: 'mediador', description: 'Mediador do teste (padrão: você)', required: false },
        { type: 6, name: 'jogador1', description: 'Jogador 1 (opcional)', required: false },
        { type: 6, name: 'jogador2', description: 'Jogador 2 (opcional)', required: false }
      ] },
    ]);
    sucesso('Comandos /painel-revenda, /mudar, /central, /keys, /variaveis, /painel-compra, /auto-mensagem, /criar-cupom, /codigo-promocional, /criar-logs e /excluir-logs registrados.');
  } catch (e) { erro(`Falha ao registrar comandos: ${e.message}`); }
}
async function registrarPersonalizarGuilds(lista) {
  const cmd = { name: 'personalizar', description: 'Muda avatar, banner e nome do bot neste servidor', dmPermission: false, defaultMemberPermissions: null };
  const guilds = lista || Array.from(botClient.guilds.cache.values());
  let okPers = 0;
  for (const g of guilds) {
    try {
      const existentes = await g.commands.fetch();
      const ja = existentes.find(c => c.name === 'personalizar');
      if (ja) await g.commands.edit(ja.id, cmd); else await g.commands.create(cmd);
      okPers++;
    } catch (e) {
      aviso(`/personalizar NÃO registrado em ${g.name} (${g.id}): ${e.message} (código ${e.code || '?'}). Código 50001 = bot adicionado sem o escopo applications.commands.`);
    }
    await esperar(500);
  }
  if (okPers) info(`🎨 /personalizar registrado em ${okPers} servidor(es).`);
}
// Apaga os painéis /admin antigos (públicos) que o bot enviou. Roda uma vez ao ligar.
// Cada canal é varrido UMA vez (o resultado fica gravado): reinícios não repetem a leitura do histórico de todos os canais.
const PAINEIS_LIMPOS_PATH = path.join(__dirname, 'paineis_admin_limpos.json');
function carregarPaineisLimpos() {
  try { const j = JSON.parse(fs.readFileSync(PAINEIS_LIMPOS_PATH, 'utf8')); return j && typeof j === 'object' ? j : {}; } catch { return {}; }
}
function salvarPaineisLimpos(o) {
  try { fs.writeFileSync(`${PAINEIS_LIMPOS_PATH}.tmp`, JSON.stringify(o)); fs.renameSync(`${PAINEIS_LIMPOS_PATH}.tmp`, PAINEIS_LIMPOS_PATH); } catch {}
}
async function limparPaineisAdminAntigos() {
  let apagadas = 0;
  const limpos = carregarPaineisLimpos();
  let variou = false;
  try {
    for (const g of botClient.guilds.cache.values()) {
      for (const c of g.channels.cache.values()) {
        if (limpos[c.id]) continue; // já varrido antes
        try {
          if (typeof c.isTextBased !== 'function' || !c.isTextBased() || !c.messages) continue;
          const perms = c.permissionsFor(g.members.me);
          if (!perms || !perms.has(['ViewChannel', 'ReadMessageHistory'])) continue;
          const msgs = await c.messages.fetch({ limit: 100 });
          for (const m of msgs.values()) {
            if (!m.author || m.author.id !== botClient.user.id) continue;
            const bruto = JSON.stringify((m.components || []).map(x => (x && x.toJSON ? x.toJSON() : x)));
            if (!bruto.includes('adm_menu')) continue;
            await m.delete().then(() => { apagadas++; }).catch(logErro);
            await esperar(400);
          }
          limpos[c.id] = Date.now();
          variou = true;
        } catch {}
        await esperar(300);
      }
    }
  } finally {
    if (variou) salvarPaineisLimpos(limpos);
  }
  if (apagadas) sucesso(`🧹 ${apagadas} painel(is) /admin antigo(s) apagado(s).`);
}
// /teste: manda no canal um embed de "partida confirmada" para o selfbot ler e acionar o AutoMed.
async function testeAutomedComando(interacao) {
  if (!interacao.channel || typeof interacao.channel.send !== 'function') {
    await responderTexto(interacao, '⛔ Use este comando dentro de um canal de texto.'); return;
  }
  const valorOpt = interacao.options && interacao.options.getNumber ? interacao.options.getNumber('valor') : null;
  const valor = valorOpt && valorOpt > 0 ? valorOpt : 1;
  const medOpt = interacao.options && interacao.options.getUser ? interacao.options.getUser('mediador') : null;
  const medId = medOpt ? medOpt.id : interacao.user.id;
  const j1 = interacao.options.getUser ? interacao.options.getUser('jogador1') : null;
  const j2 = interacao.options.getUser ? interacao.options.getUser('jogador2') : null;
  const id1 = j1 ? j1.id : ((botClient && botClient.user && botClient.user.id) || '100000000000000001');
  const id2 = j2 ? j2.id : '100000000000000002';
  const vTxt = valor.toFixed(2).replace('.', ',');
  const embed = new EmbedBuilder()
    .setColor(COR.principal)
    .setTitle('Partida confirmada')
    .setDescription([
      'Valor da aposta: R$ ' + vTxt,
      '',
      'Jogadores',
      '<@' + id1 + '>',
      '<@' + id2 + '>',
      '',
      'Mediador',
      '<@' + medId + '>'
    ].join('\n'))
    .setFooter({ text: 'Teste do AutoMed' });
  await interacao.reply({ content: '🧪 Embed de teste enviado neste canal. O AutoMed deve reagir em instantes.\n-# As instruções são enviadas 1 vez por canal: para testar de novo, use outro canal ou `.rv`.', ...EFEMERO });
  await interacao.channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
}
function iniciarSelfbot(userId, tentativa = 0) {
  if (selfbots.has(userId)) return;
  if (!usuarioPodeRodar(userId)) {
    try {
      const u0 = carregarUsuarios()[userId] || {};
      const a0 = statusAcesso(userId);
      aviso(`[${userId}] iniciarSelfbot recusado: ligado=${u0.ligado} token=${!!u0.token} keyOk=${a0.ok} congelada=${!!a0.congelada}`);
    } catch {}
    return;
  }
  const usuarios = carregarUsuarios();
  const usuario = usuarios[userId];
  if (!SelfbotClient) {
    erro(`[${userId}] @trickstarcandina/discordjs-selfbot não carregou — conexão recusada.`);
    atualizarPainelSistema(userId, '❌ **Módulo do selfbot não carregou.** Instale `@trickstarcandina/discordjs-selfbot`.');
    return;
  }
  const livre = !usuario.token && !!abLivreCfg(usuario);
  const sb = livre ? abCriarSbLivre(userId) : SbRemoto.criar(userId);
  sb.on('raw', pacote => {
    try {
      if (!pacote || !pacote.d) return;
      const guardar = x => {
        if (!x || !x.id) return;
        const n = x.name || (x.properties && x.properties.name);
        if (n && typeof n === 'string') nomesServidores.set(String(x.id), n);
      };
      if (pacote.t === 'GUILD_CREATE' || pacote.t === 'GUILD_UPDATE') guardar(pacote.d);
      else if (pacote.t === 'READY' && Array.isArray(pacote.d.guilds)) pacote.d.guilds.forEach(guardar);
    } catch {}
  });
  sb.once('ready', () => {
    if (selfbots.get(userId) !== sb) { try { sb.destroy(); } catch {} return; }
    tentativasLoginSelfbot.delete(userId);
    if (global.__rcSb) global.__rcSb.delete(userId);
    registrarAtividadeValor(userId);
    iniciarPollerGmail(userId);
    try {
      const nomeReal = sb.user && (sb.user.globalName || sb.user.username);
      if (nomeReal) {
        const us = carregarUsuarios();
        if (us[userId] && us[userId].nomeConta !== nomeReal) { us[userId].nomeConta = nomeReal; salvarUsuarios(us); }
      }
    } catch {}
    // Bio da conta que cria as salas: ZEROUN APPS (se a biblioteca permitir; senão, deixa como está).
    (async () => {
      try {
        if (!sb.user || typeof sb.user.setAboutMe !== 'function') return;
        await sb.user.setAboutMe('ZEROUN APPS');
        info(`📝 Bio da conta ${sb.user.username} definida como "ZEROUN APPS"`);
      } catch (e) { aviso(`Não consegui alterar a bio de ${(sb.user && sb.user.username) || userId}: ${e.message}`); }
    })();
    sucesso(`Selfbot online: ${sb.user.username} (${userId}) — ${usuario.email || '?'} • ${selfbots.size} conta(s) no total`);
    atualizarPainelSistema(userId, '🟢 **Instância online!**');
    setTimeout(() => garantirNomesServidores(userId, 60000).catch(logErro), 5000);

    logEvento('geral', `✅ Selfbot ONLINE: **${sb.user.username}** (\`${userId}\`) — ${usuario.email || '?'} • ${selfbots.size} conta(s) ativa(s)`, userId).catch(logErro);
  });
  // Reconexão tratada corretamente (adaptado do on_resumed do discord.py-self):
  // o on_ready NÃO dispara de novo em uma simple queda de conexão — só o "resumed".
  sb.on('resumed', () => {
    if (selfbots.get(userId) !== sb) return;
    info(`🔁 [${userId}] Conexão retomada (resumed) — nada foi duplicado.`);
  });
  sb.on('shardResume', () => {
    if (selfbots.get(userId) !== sb) return;
    info(`🔁 [${userId}] Shard retomado — continuando normalmente.`);
  });
  sb.on('messageCreate', mensagem => {
    Promise.resolve().then(async () => {
      const iaDbg = (mensagem.author && sb.user && mensagem.author.id === sb.user.id && /^\s*\.ia(?:\s|$)/i.test(String(mensagem.content || '')))
        ? m => info(`[.ia] conta ${userId}: ${m}`) : () => {};
      iaDbg('mensagem recebida pela conta');
      const rastro = (() => {
        try {
          if (!(mensagem.author && mensagem.author.bot)) return () => {};
          const trRastro = textoCompletoMensagem(mensagem);
          if (!/mediador/i.test(trRastro)) return () => {};
          // só cards de aposta/valor; ranking, logs e convites não interessam
          if (!/valor|aposta|partida confirmada|teste do automed|taxa/i.test(trRastro)) return () => {};
          if (/ranking di[aá]rio|joined using|sala (?:criada|cancelada)/i.test(trRastro) || /log/i.test(String((mensagem.channel && mensagem.channel?.name) || ''))) return () => {};
          // As N contas recebem o mesmo card: uma linha por (mensagem, motivo), sem repetir por conta.
          return motivo => logUmaVez(`rastro|${mensagem.id}|${String(motivo).replace(/\d{15,}/g, '#')}`,
            () => info(`[rastro ${userId}] #${mensagem.channel && mensagem.channel?.name} → ${motivo}`));
        } catch { return () => {}; }
      })();
      rastro('card chegou nesta conta');
      if (process.env.LOG_SACI === '1' && guildIdDaMensagem(mensagem) === '1465118621360586786' && mensagem.author && mensagem.author.bot) {
        try { info(`[${userId}] [SACI] #${mensagem.channel && mensagem.channel?.name} content=${JSON.stringify(String(mensagem.content || '').slice(0, 120))} embeds=${(mensagem.embeds || []).length} components=${(mensagem.components || []).length} texto=${JSON.stringify(textoCompletoMensagem(mensagem).slice(0, 200))} raw=${JSON.stringify(mensagem.components || []).slice(0, 600)}`); }
        catch (e) { info(`[SACI] erro ao inspecionar: ${e.message}`); }
      }
      if (selfbots.get(userId) !== sb) { rastro('selfbot trocado'); iaDbg('IGNORADO: selfbot trocado'); return; }
      if (contaPausada(userId)) { rastro('conta pausada'); iaDbg('IGNORADO: conta pausada/congelada'); return; }
      if (orgBloqueada(userId, guildIdDaMensagem(mensagem))) { rastro('BLOQUEADO: key vinculada a OUTRO servidor (orgBloqueada)'); iaDbg('IGNORADO: key vinculada a OUTRO servidor (orgBloqueada)'); return; }
      if (
        CANAIS_BLOQUEADOS.has(String(mensagem.channel && mensagem.channel.id)) ||
        canalOuCategoriaEhDeLogs(mensagem.channel)
      ) { rastro('canal bloqueado/logs'); iaDbg('IGNORADO: canal bloqueado/de logs'); return; }
      const ehPropria = !!(mensagem.author && sb.user && mensagem.author.id === sb.user.id);
      if (ehPropria && conteudosProprios.has(String(mensagem.content || '').trim()) && !RX_CMD_SALA.test(String(mensagem.content || '').trim())) return;
      if (mensagem.author && !mensagem.author.bot && (!ehPropria || /^[.!]\S/.test(String(mensagem.content || '').trim()))) sbHumanoInteragiu(userId, mensagem.channel.id);
      const cfg = obterConfigUsuario(userId);
      if (cfg.automedAtivo === false) { rastro('automed DESLIGADO nesta conta'); return; }
      {
        const gAb = guildIdDaMensagem(mensagem);
        if (antibanAtivo(userId, gAb)) {
          if (botClient && botClient.user && mensagem.author && mensagem.author.id === botClient.user.id) {
            // /teste (embed "Teste do AutoMed") também reage no antiban: é o único caso em que o selfbot responde ao bot oficial.
            try {
              const tTxt = textoCompletoMensagem(mensagem);
              if (!/teste do automed|partida confirmada/i.test(tTxt)) return;
            } catch { return; }
          }
          // Comandos da PRÓPRIA conta que funcionam no antiban (as respostas saem pelo bot oficial):
          // .lucro/.extrato/.saldo/.comandos/.perfil, ".pg [chave] [valor]", ". [chave] [valor]" e o "sim/não" de confirmação do .pg.
          const ehComandoProprio = (() => {
            if (!(mensagem.author && sb.user && mensagem.author.id === sb.user.id)) return false;
            const tCp = limparTexto(mensagem.content || '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
            if (/^\.(?:lucro|extrato|saldo|comandos|perfil)(?:\s+(?:zerar|reset))?\s*$/i.test(tCp)) return true;
            if (/^\.pg(?:\s|$)/i.test(tCp)) return true;
            if (/^\.ia(?:\s|$)/i.test(tCp)) return true;   // .ia também funciona nas contas em modo antiban (resposta sai pelo bot oficial)
            if (/^\+cs\s*\d{0,2}\s*$/i.test(tCp)) return true;
            if ( /^\.\s+\S+(?:\s+\S+)*$/.test(tCp)) return true;
            const refCp = mensagem.reference && (mensagem.reference.messageId || mensagem.reference.message_id);
            if (refCp && pgPendentes.has(String(refCp)) && /^(?:sim|s|yes|y|n[aã]o|nao|n|no)[\s.!?]*$/i.test(tCp)) return true;
            return false;
          })();
          if (!ehComandoProprio && !antibanCanalLiberado(userId, mensagem)) {
            { const medR = antibanMediadorDoCard(mensagem); rastro(`ANTIBAN: mediador do card = ${medR || 'nenhum'} → ${medR ? estadoDonoMediador(medR) : 'card sem mediador'}`); }
            try {
              // Card de bot SEM mediador: não responde nada, mas continua lendo o valor do canal.
              if (mensagem.author && mensagem.author.bot && !antibanMediadorDoCard(mensagem)) {
                const dSil = extrairValorConta(mensagem, userId);
                if (dSil) {
                  valorEsperadoPorCanal.set(mensagem.channel.id, dSil.valor);
                  botPorCanal.set(mensagem.channel.id, mensagem.author.id);
                  info(`[${userId}] [sem mediador] valor ${formatarValor(dSil.valor)} guardado em #${mensagem.channel?.name}, aguardando mediador.`);
                }
              }
            } catch {}
            return;
          }
          antibanCtx.enterWith({ fixo: true });
        }
      }
      // Canal com valor ativo = conta em uso: renova a atividade (anti-desativação por inatividade).
      if (valorEsperadoPorCanal.has(String(mensagem.channel && mensagem.channel.id))) registrarAtividadeValor(userId);
      if (contaInativaPorUso(userId, guildIdDaMensagem(mensagem))) return;
      if (!ehPropria && !podeResponderAqui(userId, mensagem)) { rastro('podeResponderAqui = false (valor não lido, "Onde responder" ou servidor desativado)'); return; }
      if (!ehPropria && mensagem.attachments && mensagem.attachments.size > 0 &&
          valorEsperadoPorCanal.has(mensagem.channel.id) && !(cfg.pagAuto === true && pagAutoAtivo(mensagem.channel.id))) {
        processarImagensDaMensagem(mensagem, userId).catch(e => erro(`Imagem [${userId}]: ${e.message}`));
      }
      const texto = mensagem.content || '';
      // Comando digitado pela própria conta (.saldo, .reembolsar, +cs ...): respostas com delay de 1s.
      if (ehPropria && /^(?:[.!]\S|\.\s+\S+(?:\s+\S+)*$)/.test(limparTexto(texto))) {
        ctxEnvio.enterWith({ comando: true });
      }
      if (!texto.trim() && !(mensagem.embeds && mensagem.embeds.length) && !(mensagem.components && mensagem.components.length)) return;
      if (ehPropria && mensagem.reference && (pgPendentes.size || depConfPendentes.size)) {
        try { if (await pgResponderConfirmacao(mensagem, userId)) return; } catch (ePg) { erro(`Confirmação .pg [${userId}]: ${ePg.message}`); return; }
        try { if (await apResponderConfirmacaoDeposito(mensagem, userId)) return; } catch (eDp) { erro(`Confirmação de depósito [${userId}]: ${eDp.message}`); return; }
      }
      if (ehPropria) {
        const ml = limparTexto(texto).match(/^\.lucro(?:\s+(zerar|reset))?\s*$/i);
        if (ml) {
          logEmbed('autopay', ml[1] ? '🧹 .lucro zerado' : '📈 .lucro consultado', [['Conta', `<@${userId}>`], ['Valor', formatarValor(obterConfigUsuario(userId).lucro || 0)]], userId).catch(logErro);
          try {
            if (ml[1]) {
              salvarConfigUsuario(userId, { lucro: null });
              await enviarCanal(mensagem.channel, '<:1002682632:1556640539116572752> **Lucro zerado.**');
            } else {
              await enviarCanal(mensagem.channel, relatorioLucro(userId));
            }
          } catch (eL) { aviso(`.lucro: ${eL.message}`); }
          return;
        }
      }
      if (ehPropria) {
        const tAp = String(texto).replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
        iaDbg('chegou no despachante de comandos');
        if (cfg.modoSilencioso === true && /^\.pg(?:\s|$)/i.test(tAp)) return; // modo fantasma: o bot ignora o .pg
        if (/^\.(saldoall|addsaldo|remsaldoall|remsaldo|semanal|semanaladd|semanalrem|perm)(?:\s|$)/i.test(tAp)) return; // agora tratados pelo bot principal
        if (/^\.(?:comandos|testargmail|reembolsar)(?:\s|$)/i.test(tAp)) return; // fora da lista liberada (.ia liberado)
        if (/^\.saldo\s*$/i.test(tAp)) { logEmbed('autopay', '💰 .saldo consultado', [['Conta', `<@${userId}>`]], userId).catch(logErro); await apComandoSaldo(mensagem, userId); return; }
        
if (/^\.testargmail\s*$/i.test(tAp)) {
  if (!mensagem.channel || mensagem.channel.type !== 'DM') {
    await enviarCanal(
      mensagem.channel,
      '🔒 Por segurança, use `.testargmail` em uma conversa privada.'
    );
    return;
  }

  try {
    const gmailApi = await conectarGmailAPI(userId);

    if (!gmailApi) {
      throw new Error('Gmail não está conectado.');
    }

    // Busca somente e-mails dos últimos 30 dias.
    // A consulta não altera mensagens nem seus marcadores.
    const consulta =
      'newer_than:30d {PIX recebido "pix recebido" ' +
      '"transferência recebida" "transferencia recebida"}';

    const resposta = await gmailApi.users.messages.list({
      userId: 'me',
      q: consulta,
      maxResults: 20,
      includeSpamTrash: false,
      fields: 'messages(id)'
    });

    const ids = (resposta.data.messages || [])
      .map(email => email.id)
      .filter(Boolean);

    if (ids.length === 0) {
      await enviarCanal(
        mensagem.channel,
        '📭 Nenhuma notificação correspondente foi encontrada nos últimos 30 dias.'
      );
      return;
    }

    // Reutiliza o leitor de mensagens que já existe no index.js.
    // A função consulta o conteúdo, sem marcar como lido ou excluir.
    const emails = await lerEmailsEmLote(
      gmailApi,
      ids,
      userId
    );

    const pagamentos = emails
      .map(email => extrairDadosEmail(email))
      .filter(p =>
        p &&
        p.nome &&
        Number.isFinite(Number(p.valor)) &&
        Number(p.valor) > 0
      )
      .slice(0, 10);

    if (pagamentos.length === 0) {
      await enviarCanal(
        mensagem.channel,
        '🔎 Os e-mails foram consultados, mas não encontrei PIX recebido com nome e valor identificáveis.'
      );
      return;
    }

    const linhas = pagamentos.map((p, i) => {
      const data = p.data instanceof Date &&
        Number.isFinite(p.data.getTime())
        ? p.data.toLocaleString('pt-BR')
        : 'Data indisponível';

      return (
        `**${i + 1}. ${p.nome}**\n` +
        `💰 Valor: ${formatarValor(p.valor)}\n` +
        `🕒 Data: ${data}`
      );
    });

    await enviarCanal(
      mensagem.channel,
      '📩 **Resultado do teste Gmail**\n\n' +
      linhas.join('\n\n') +
      '\n\n🔒 Nenhuma mensagem foi marcada como lida ou excluída por este comando.'
    );

  } catch (e) {
    erro(`.testargmail [${userId}]: ${e.message}`);

    await enviarCanal(
      mensagem.channel,
      '⚠️ Não foi possível consultar o Gmail. ' +
      'Verifique a conexão OAuth2 e as permissões da API.'
    ).catch(logErro);
  }

  return;
}

if (/^\.comandos\s*$/i.test(tAp)) {
  logEmbed(
    'geral',
    '📜 .comandos consultado',
    [['Conta', `<@${userId}>`]],
    userId
  ).catch(logErro);

  await apComandoComandos(mensagem, userId);
  return;
}

        if (/^\.extrato\s*$/i.test(tAp)) { logEmbed('autopay', '🧾 .extrato consultado', [['Conta', `<@${userId}>`]], userId).catch(logErro); await apComandoExtrato(mensagem, userId); return; }
        if (/^\.perfil\s*$/i.test(tAp)) { logEmbed('geral', '📋 .perfil aberto', [['Conta', `<@${userId}>`]], userId).catch(logErro); await apagarComando(mensagem); await enviarPerfilDM(userId); return; }
        const mCs = tAp.match(RX_CMD_SALA);
        if (mCs) {
          const numCs = mCs[1] || '1';
          if (!TIPO_POR_NUMERO[numCs]) { await enviarCanal(mensagem.channel, '❌ Modo inexistente. Use `+cs`, `+cs2`, `+cs3`, `+cs4` ou `+cs5`.').catch(logErro); return; }
          logEmbed('geral', '🎮 +cs (criar sala)', [['Conta', `<@${userId}>`], ['Modo', numCs]], userId).catch(logErro);
          await comandoSalaManual(mensagem, userId, numCs);
          return;
        }

        const mIa = tAp.match(/^\.ia(?:\s+([\s\S]+))?$/i);
        if (mIa) { await comandoIA(mensagem, userId, mIa[1] || ''); return; }
        const mAdd = tAp.match(/^\.addsaldo(?:\s+([\s\S]+))?$/i);
        if (mAdd) {
          if (ehMeuId(userId)) { logEmbed('autopay', '💳 .addsaldo executado', [['Conta', `<@${userId}>`], ['Args', mAdd[1] || '']], userId).catch(logErro); await apComandoAddSaldo(mensagem, userId, mAdd[1] || ''); }
          else logEmbed('seguranca', '🚨 .addsaldo BLOQUEADO (não é o dono)', [['Tentou', `<@${userId}>`]], userId).catch(logErro);
          return;
        }
        const mRemAll = tAp.match(/^\.remsaldoall(?:\s+([\s\S]+))?$/i);
        if (mRemAll) {
          if (ehMeuId(userId)) { logEmbed('autopay', '💳 .remsaldoall executado', [['Conta', `<@${userId}>`], ['Args', mRemAll[1] || '']], userId).catch(logErro); await apComandoRemSaldoAll(mensagem, userId, mRemAll[1] || ''); }
          else logEmbed('seguranca', '🚨 .remsaldoall BLOQUEADO (não é o dono)', [['Tentou', `<@${userId}>`]], userId).catch(logErro);
          return;
        }
        const mRem = tAp.match(/^\.remsaldo(?:\s+([\s\S]+))?$/i);
        if (mRem) {
          if (ehMeuId(userId)) { logEmbed('autopay', '💳 .remsaldo executado', [['Conta', `<@${userId}>`], ['Args', mRem[1] || '']], userId).catch(logErro); await apComandoRemSaldo(mensagem, userId, mRem[1] || ''); }
          else logEmbed('seguranca', '?? .remsaldo BLOQUEADO (não é o dono)', [['Tentou', `<@${userId}>`]], userId).catch(logErro);
          return;
        }
        const mSAdd = tAp.match(/^\.semanaladd(?:\s+([\s\S]+))?$/i);
        if (mSAdd) {
          if (ehMeuId(userId)) { logEmbed('seguranca', '🔑 .semanaladd executado', [['Conta', `<@${userId}>`], ['Args', mSAdd[1] || '']], userId).catch(logErro); await apComandoSemanalAdd(mensagem, userId, mSAdd[1] || ''); }
          else logEmbed('seguranca', '🚨 .semanaladd BLOQUEADO (não é o dono)', [['Tentou', `<@${userId}>`]], userId).catch(logErro);
          return;
        }
        const mSRem = tAp.match(/^\.semanalrem(?:\s+([\s\S]+))?$/i);
        if (mSRem) {
          if (ehMeuId(userId)) { logEmbed('seguranca', '🔑 .semanalrem executado', [['Conta', `<@${userId}>`], ['Args', mSRem[1] || '']], userId).catch(logErro); await apComandoSemanalRem(mensagem, userId, mSRem[1] || ''); }
          else logEmbed('seguranca', '🚨 .semanalrem BLOQUEADO (não é o dono)', [['Tentou', `<@${userId}>`]], userId).catch(logErro);
          return;
        }
        const mSem = tAp.match(/^\.semanal(?:\s+([\s\S]+))?$/i);
        if (mSem) {
          if (ehMeuId(userId)) { logEmbed('seguranca', '🔑 .semanal consultado', [['Conta', `<@${userId}>`], ['Args', mSem[1] || '']], userId).catch(logErro); await apComandoSemanal(mensagem, userId, mSem[1] || ''); }
          else logEmbed('seguranca', '🚨 .semanal BLOQUEADO (não é o dono)', [['Tentou', `<@${userId}>`]], userId).catch(logErro);
          return;
        }
        const mRv = tAp.match(/^\.rv(?:\s+([\s\S]+))?$/i);
        if (mRv) { logEmbed('geral', '📌 .rv (valor canal)', [['Conta', `<@${userId}>`], ['Args', mRv[1] || '']], userId).catch(logErro); await apComandoValorCanal(mensagem, userId, mRv[1] || '', false); return; }
        const mRc = tAp.match(/^\.recriar(?:\s+([\s\S]+))?$/i);
        if (mRc) { logEmbed('geral', '🔄 .recriar (recriar canal)', [['Conta', `<@${userId}>`], ['Args', mRc[1] || '']], userId).catch(logErro); await apComandoValorCanal(mensagem, userId, mRc[1] || '', true); return; }

        const mRb = tAp.match(/^\.reembolsar(?:\s+([\s\S]+))?$/i);
        if (mRb) { logEmbed('autopay', '↩️ .reembolsar', [['Conta', `<@${userId}>`], ['Args', String(mRb[1] || '').slice(0, 80)]], userId).catch(logErro); await apComandoReembolsar(mensagem, userId, mRb[1] || ''); return; }
        const mAp = tAp.match(/^\.pg(?:\s+([\s\S]+))?$/i);
        const mPs = tAp.match(/^\.\s+(\S+(?:\s+\S+)*)$/);
        if (mPs && !/\s/.test(mPs[1]) && !(mensagem.reference && (mensagem.reference.messageId || mensagem.reference.message_id))) { /* ". valor" sem responder nada: ignora */ }
        else
        if (mPs) { logEmbed('autopay', '💸 . (saque PIX silencioso)', [['Conta', `<@${userId}>`]], userId).catch(logErro); await apComandoPgSilencioso(mensagem, userId, mPs[1]); return; }
        if (mAp) { logEmbed('autopay', '💸 .pg (saque PIX)', [['Conta', `<@${userId}>`], ['Args', String(mAp[1] || '').slice(0, 80)]], userId).catch(logErro); await apComandoPg(mensagem, userId, mAp[1] || ''); return; }
      }
      const estGo = salasAguardandoGo.get(mensagem.channel.id);
      if (estGo && mensagem.author && !mensagem.author.bot &&
          /^[.!\/]?\s*go\s*[.!?]*$/i.test(limparTexto(texto).replace(/[`*_~]/g, '').trim())) {
        await tratarGo(mensagem, estGo);
        return;
      }
      // Regra do MEDIADOR (vale em TODOS os modos, inclusive no antiban): se o card marca um
      // mediador/adm explícito e NÃO é a própria conta, esta conta não responde — quem responde
      // é a conta do mediador marcado no card. Vale SEMPRE (mesmo para mensagens da própria conta).
      // Mediador marcado SEM KEY ATIVA (sem acesso/vencida/congelada) → NENHUMA conta responde.
      try {
        const medCard = antibanMediadorDoCard(mensagem);
        if (medCard) {
          if (!antibanIdsDaConta(userId).has(String(medCard))) {
            if (mensagem.author && mensagem.author.bot) logUmaVez(`medOutro|${mensagem.id}`, () => info(`[med] card de outro mediador (${medCard}) em #${mensagem.channel && mensagem.channel?.name} — ignorado pelas demais contas.`));
            return;
          }
          const aMed = statusAcesso(String(userId));
          if (!aMed.ok || aMed.congelada) {
            info(`[${userId}] [med] você é o mediador, mas a key está sem acesso/congelada — ignorado.`);
            return;
          }
        }
      } catch {}
      const textoCompleto = extrairTextoComEmbeds(mensagem);
      const chavePix = String(cfg.chavePix || '').trim();
      const temChavePix = !!chavePix && textoContemChavePix(textoCompleto, chavePix);
      const dadosBot = extrairValorConta(mensagem, userId);
      if (dadosBot) {
        valorEsperadoPorCanal.set(mensagem.channel.id, dadosBot.valor);
        registrarAtividadeValor(userId);
        if (mensagem.author && mensagem.author.bot) botPorCanal.set(mensagem.channel.id, mensagem.author.id);
        info(`<:1002682632:1556640539116572752> [${userId}] Valor: ${formatarValor(dadosBot.valor)}`);
        if (dadosBot.nome) info(`👤 Cliente: ${dadosBot.nome}`);
        await enviarInstrucoes(mensagem, userId, dadosBot.valor, dadosBot.nome);
        return;
      }
      if (!ehPropria && mensagem.author && mensagem.author.bot && /aposta/i.test(textoCompleto) && /valor/i.test(textoCompleto)) {
        aviso(`[${userId}] Card de aposta com "Valor", mas NÃO li o número. Texto visto: "${textoLinhasMensagem(mensagem).join(' | ').slice(0, 300)}" • components: ${(mensagem.components || []).length}`);
      }
      if (/valor/i.test(textoCompleto) && /pag(?:o|ar)\b/i.test(textoCompleto) && !/^\s*(?:pg|pago)\b/i.test(texto)) {
        aviso(`[${userId}] Mensagem parecia ter valor a pagar, mas não consegui ler o número: "${textoCompleto.replace(/\s+/g, ' ').slice(0, 90)}"`);
      }
      const valorManual = extrairValorManual(texto);
      if (valorManual !== null) {
        valorEsperadoPorCanal.set(mensagem.channel.id, valorManual);
        registrarAtividadeValor(userId);
        sucesso(`<:1002682632:1556640539116572752> [${userId}] Valor manual: ${formatarValor(valorManual)}`);
        return;
      }
      // Chave PIX enviada: só define o valor/instruções. NUNCA verifica nem confirma pagamento.
      if (temChavePix) {
        const chavePixMsg = `pix|${userId}|${mensagem.id}`;
        if (verificacoesAtivas.has(chavePixMsg)) return;
        verificacoesAtivas.add(chavePixMsg);
        try { await processarChavePix(mensagem, userId); }
        finally { verificacoesAtivas.delete(chavePixMsg); }
        return;
      }
      if (ehPropria) return;
      // (GO movido para cima)
      if (cfg.pagAuto === true && pagAutoAtivo(mensagem.channel.id)) return;   // pag. auto desativado => o Gmail lê normalmente
      const dadosPg = extrairDadosPg(texto);
      if (!dadosPg) return;
      const chave = `${userId}|${mensagem.id}`;
      if (verificacoesAtivas.has(chave)) return;
      verificacoesAtivas.add(chave);
      try { await processarPg(mensagem, dadosPg, userId); }
      finally { verificacoesAtivas.delete(chave); }
    }).catch(e => {
      erro(`Selfbot [${userId}]: ${e.message}`);
      tratarErroConta(e, userId);
    });
  });
  sb.on('messageUpdate', (antiga, nova) => {
    try {
      if (!nova || !nova.channel) return;
      if (selfbots.get(userId) !== sb) return;
      if (contaPausada(userId)) return;
      if (orgBloqueada(userId, guildIdDaMensagem(nova))) { rastro('BLOQUEADO (msg editada): key vinculada a OUTRO servidor (orgBloqueada)'); return; }
      if (obterConfigUsuario(userId).automedAtivo === false) return;
      {
        const gAb = guildIdDaMensagem(nova);
        if (antibanAtivo(userId, gAb)) {
          if (!antibanCanalLiberado(userId, nova)) return;
          antibanCtx.enterWith({ fixo: true });
        }
      }
      // Regra do MEDIADOR também em EDIÇÕES (o bot edita o card de "Esperando" para "Partida
      // Iniciada/Confirmada" — sem isso a conta errada respondia pela edição).
      // Mediador marcado SEM KEY ATIVA (sem acesso/vencida/congelada) → NENHUMA conta responde.
      try {
        const medCard = antibanMediadorDoCard(nova);
        if (medCard) {
          if (!antibanIdsDaConta(userId).has(String(medCard))) return;
          const aMed = statusAcesso(String(medCard));
          if (!aMed.ok || aMed.congelada) return;
        }
      } catch {}
      const d = extrairValorConta(nova, userId);
      if (d) {
        const ganhouMediador = !(antiga && antibanMediadorDoCard(antiga)) && !!antibanMediadorDoCard(nova);
        const jaTinha = !!extrairValorConta(antiga, userId) && !ganhouMediador;
        valorEsperadoPorCanal.set(nova.channel.id, d.valor);
        registrarAtividadeValor(userId);
        info(`<:1002682632:1556640539116572752> [${userId}] Valor (mensagem editada): ${formatarValor(d.valor)}`);
        if (!jaTinha && podeResponderAqui(userId, nova) &&
            !CANAIS_BLOQUEADOS.has(String(nova.channel.id)) && !canalOuCategoriaEhDeLogs(nova.channel)) {
          enviarInstrucoes(nova, userId, d.valor, d.nome).catch(e => aviso(`Instruções (edição): ${e.message}`));
        }
      }
    } catch {}
  });
  sb.on('error', e => {
    erro(`Selfbot [${userId}]: ${e.message}`);
    atualizarPainelSistema(userId, `⚠️ **Erro:** ${String(e.message).slice(0, 200)}`);
    tratarErroConta(e, userId);
  });
  sb.on('close', () => {
    logEmbed(
      'geral',
      '🔌 Sessão desconectada',
      [['Conta', `<@${userId}>`], ['Situação', 'conexão encerrada; tentando religar automaticamente']]
    ).catch(e => erro(`[Sessão] Não foi possível registrar a desconexão: ${e.message}`));
    if (selfbots.get(userId) !== sb) return; // parada de propósito
    selfbots.delete(userId);
    try { sb.destroy(); } catch {}
    pararPollerGmail(userId);
    global.__rcSb = global.__rcSb || new Map();
    const n = (global.__rcSb.get(userId) || 0) + 1;
    global.__rcSb.set(userId, n);
    const espera = Math.min(10000 * n, 120000);
    aviso(`[${userId}] Conexão caiu. Religando em ${Math.round(espera / 1000)}s (tentativa ${n}).`);
    setTimeout(() => { if (!selfbots.has(userId) && usuarioPodeRodar(userId)) iniciarSelfbot(userId); }, espera);
  });
  sb.on('invalidated', () => {
    aviso(`Selfbot [${userId}]: sessão invalidada. A automação foi interrompida; não haverá reconexão automática.`);
        if (selfbots.get(userId) === sb) alertaFalha(userId, 'sessao');
if (selfbots.get(userId) !== sb) return;

    selfbots.delete(userId);
    tentativasLoginSelfbot.delete(userId);

    try { sb.destroy(); } catch {}
    pararPollerGmail(userId);

    atualizarPainelSistema(
      userId,
      '⛔ **Sessão invalidada.** A automação foi parada e não será reconectada automaticamente. Verifique a conta e utilize uma integração oficial.'
    );

    logEvento(
      'seguranca',
      `⛔ Sessão invalidada para <@${userId}>. Reconexão automática desativada.`,
      userId
    ).catch(logErro);
  });
  sb.on('warn', e => aviso(`Selfbot [${userId}]: ${e}`));
    (livre ? Promise.resolve().then(() => { setImmediate(() => sb.emit('ready')); }) : sb.login(usuario.token)).catch(e => {
    if (selfbots.get(userId) !== sb) return;

    const detalhe = String(e && e.message ? e.message : 'Erro de autenticação desconhecido');
    erro(`Login interrompido para [${userId}]: ${detalhe}`);

    selfbots.delete(userId);
    tentativasLoginSelfbot.delete(userId);

    try { sb.destroy(); } catch {}
    pararPollerGmail(userId);

    const msgErr = detalhe.toLowerCase();
    const tokenInvalido =
      msgErr.includes('invalid token') ||
      msgErr.includes('401: unauthorized') ||
      msgErr.includes('incorrect login') ||
      msgErr.trim() === 'unauthorized';

    if (tokenInvalido) {
      removerTokenInvalido(userId, usuario.token);
      return;
    }

    atualizarPainelSistema(
      userId,
      `⛔ **Login interrompido.** Não haverá novas tentativas automáticas. Verifique a configuração e o estado da conta antes de realizar qualquer ação manual.`
    );
    // Retry automático: falha sem ser token inválido (ex.: Python demorou) — tenta de novo em 30s.
    if (tentativa < 5) {
      aviso(`[${userId}] Nova tentativa de login em 30s (${tentativa + 1}/5).`);
      setTimeout(() => iniciarSelfbot(userId, tentativa + 1), 30000);
    }
  });
  selfbots.set(userId, sb);
  tentativasLoginSelfbot.set(userId, tentativa);
  if (!livre) setTimeout(() => {
    if (selfbots.get(userId) !== sb || sb.user) return;
    aviso(`[${userId}] Preso em "Conectando" há 90s — derrubando e tentando de novo (${tentativa + 1}/5).`);
    selfbots.delete(userId);
    try { sb.destroy(); } catch {}
    pararPollerGmail(userId);
    if (tentativa < 5) setTimeout(() => iniciarSelfbot(userId, tentativa + 1), 5000);
  }, 90000);
}
async function atualizar(interacao, p) {
  const deMensagem = typeof interacao.isFromMessage === 'function' ? interacao.isFromMessage() : !!interacao.message;
  if (deMensagem && typeof interacao.update === 'function') return interacao.update(p);
  return interacao.reply(opcoesResposta(p, true));
}
async function adiar(interacao) {
  const deMensagem = typeof interacao.isFromMessage === 'function' ? interacao.isFromMessage() : !!interacao.message;
  if (deMensagem && typeof interacao.deferUpdate === 'function') return interacao.deferUpdate();
  return interacao.deferReply(EFEMERO);
}
async function responderTexto(interacao, conteudo) {
  return interacao.reply({ content: conteudo, ...EFEMERO });
}
function valorModalNumero(n) {
  const v = Number(n) || 0;
  return v > 0 ? valorApenas(v) : '';
}

async function tratarInteracao(interacao) {
  const isCmd = (typeof interacao.isChatInputCommand === 'function' && interacao.isChatInputCommand()) ||
                (typeof interacao.isCommand === 'function' && interacao.isCommand());
  const isBtn = typeof interacao.isButton === 'function' && interacao.isButton();
  const isModal = typeof interacao.isModalSubmit === 'function' && interacao.isModalSubmit();
  const isSelect = (typeof interacao.isStringSelectMenu === 'function' && interacao.isStringSelectMenu()) ||
                   (typeof interacao.isSelectMenu === 'function' && interacao.isSelectMenu());
  const userId = interacao.user.id;
  await atualizarLiberado(userId);
  // Botão público do drop: qualquer pessoa pode resgatar (não exige key nem liberação).
  if (await dropInterceptar(interacao)) return;
  if (typeof interacao.isChannelSelectMenu === 'function' && interacao.isChannelSelectMenu() && interacao.customId === 'mc_canal') {
    await medTratarSelect(interacao);
    return;
  }

  if (isCmd) {
    if (!ehMeuId(userId) && !ehLiberado(userId)) { await responderTexto(interacao, '⛔ Você não tem permissão para usar este comando.'); return; }
    if (!ehLiberado(userId) && servidorExterno(interacao)) {
      if (interacao.commandName !== 'central' && interacao.commandName !== 'central-antiban' && (!CMDS_LIBERADOS_EXTERNOS.has(interacao.commandName) || !externoPodeGerenciar(interacao))) {
        await responderTexto(interacao, '⛔ Você não tem permissão para usar este comando.');
        return;
      }
    }
    if (interacao.commandName === 'enviardrop') { await dropComando(interacao); return; }
    if (interacao.commandName === 'link-bot') { await linkBotComando(interacao); return; }
    if (interacao.commandName === 'antiban') {
      if (!ehLiberado(userId)) { await responderTexto(interacao, '⛔ Apenas o dono pode usar este comando.'); return; }
      await interacao.reply(opcoesResposta(telaAntibanAdmin(), true));
      return;
    }
    if (interacao.commandName === 'server-ativar') { await serverAtivarComando(interacao); return; }
    if (interacao.commandName === 'historico') { await historicoComando(interacao); return; }
    if (interacao.commandName === 'extratosalas') {
      await interacao.reply(opcoesResposta(extMontar('all'), true));
      return;
    }
    if (interacao.commandName === 'ranking') {
      await interacao.reply({ ...rkMontar('7'), allowedMentions: { parse: [] } });
      try {
        const msgRk = await interacao.fetchReply();
        rkRegistrar(msgRk.id, interacao.channelId, '7');
      } catch (e) { aviso(`/ranking: não consegui registrar a mensagem para atualização (${e.message}).`); }
      return;
    }
    if (interacao.commandName === 'teste') {
      if (!ehLiberado(userId)) { await responderTexto(interacao, '⛔ Apenas o dono pode usar este comando.'); return; }
      await testeAutomedComando(interacao);
      return;
    }
    if (interacao.commandName === 'gerarpix') {
      if (!ehLiberado(userId)) { await responderTexto(interacao, '⛔ Apenas o dono pode usar este comando.'); return; }
      await interacao.showModal(modalCampos('gpix_mdl', 'Gerar PIX', [
        { id: 'campo_valor', label: 'Valor da cobrança (R$)', placeholder: 'Ex.: 25,00', obrigatorio: true, max: 12 }
      ]));
      return;
    }
    if (interacao.commandName === 'central-antiban') {
      await interacao.reply(opcoesResposta(telaInicioAb(), false));
      return;
    }
    if (interacao.commandName === 'central') {
      await interacao.reply(opcoesResposta(telaInicio(), false));
      return;
    }
    if (interacao.commandName === 'admin') {
      if (!ehLiberado(userId)) { await responderTexto(interacao, '⛔ Apenas o dono pode usar este comando.'); return; }
      await interacao.reply(opcoesResposta(telaAdmin(), true));
      return;
    }
    if (interacao.commandName === 'auto-mensagem') {
      if (!ehLiberado(userId)) { await responderTexto(interacao, '⛔ Apenas o dono pode usar este comando.'); return; }
      await interacao.reply(opcoesResposta(amTelaPrincipal(), true));
      return;
    }
    if (interacao.commandName === 'criar-cupom' || interacao.commandName === 'codigo-promocional') {
      if (!ehLiberado(userId)) { await responderTexto(interacao, '⛔ Apenas o dono pode usar este comando.'); return; }
      await interacao.reply(opcoesResposta(cupTelaPrincipal(interacao.commandName === 'criar-cupom' ? 'cupom' : 'codigo'), true));
      return;
    }
    if (interacao.commandName === 'painel-revenda') {
      await interacao.reply(opcoesResposta(rvTelaPainel(), false));
      return;
    }
    if (interacao.commandName === 'canal-mediacoes') { await medComando(interacao); return; }
    if (interacao.commandName === 'valorsala') {
      if (!ehMeuId(userId)) { await responderTexto(interacao, '⛔ Apenas o dono pode usar este comando.'); return; }
      if (!interacao.guildId) { await responderTexto(interacao, '⛔ Use este comando dentro de um servidor.'); return; }
      await interacao.showModal(modalCampos(`mdl_valorsala:${interacao.guildId}`, 'Valor das salas do AutoMed', [
        { id: 'campo_valor', label: 'Valor por sala (R$) — 0 = padrão', placeholder: 'Ex.: 0,03', valor: valorApenas(cpPrecoSala(interacao.guildId)), obrigatorio: true, max: 12 }
      ]));
      return;
    }
    if (interacao.commandName === 'mudar') {
      if (!ehLiberado(userId) && !servidorExterno(interacao)) { await responderTexto(interacao, '⛔ Apenas o dono pode usar este comando.'); return; }
      await interacao.reply(opcoesResposta(gwTela(), true));
      return;
    }
    if (interacao.commandName === 'criar-logs') { await criarLogsComando(interacao); return; }
    if (interacao.commandName === 'excluir-logs') { await excluirLogsComando(interacao); return; }
    if (interacao.commandName === 'personalizar') { await personalizarComando(interacao); return; }
    if (interacao.commandName === 'perfil') { await interacao.reply(opcoesResposta(telaPerfil(userId), true)); return; }
    if (interacao.commandName === 'keys') {
      if (!ehLiberado(userId)) { await responderTexto(interacao, '⛔ Apenas o dono pode usar este comando.'); return; }
      await interacao.reply(opcoesResposta(telaKeys(), true));
      return;
    }
    if (interacao.commandName === 'variaveis') {
      if (!varPodeGerenciar(interacao)) { await responderTexto(interacao, '⛔ Você não tem permissão para usar este comando.'); return; }
      await interacao.reply(opcoesResposta(telaVariaveis(), true));
      return;
    }
    if (interacao.commandName === 'painel-compra') {
      await interacao.reply(opcoesResposta(telaPainelCompra(), false));
      return;
    }
    return;
  }
  if (!isBtn && !isModal && !isSelect) return;
  let id = String(interacao.customId || '');
  let valor = isSelect && Array.isArray(interacao.values) ? String(interacao.values[0] || '') : '';

  // ---------- Personalizar (/personalizar) ----------
  if (id === 'pz_avatar' || id === 'pz_banner' || id === 'pz_nome' || id === 'pz_avatar_mdl' || id === 'pz_banner_mdl' || id === 'pz_nome_mdl') {
    if (!interacao.guildId) { await responderTexto(interacao, '⛔ Use isso dentro de um servidor.'); return; }
    if (!pzEhAdmin(interacao)) { await responderTexto(interacao, '⛔ Apenas administradores do servidor podem usar isso.'); return; }
    if (isBtn) {
      if (id === 'pz_avatar') {
        await interacao.showModal(modalCampos('pz_avatar_mdl', 'Mudar avatar do bot', [
          { id: 'url', label: 'Link da foto (avatar)', obrigatorio: true, max: 500, placeholder: 'https://exemplo.com/foto.png' }
        ]));
        return;
      }
      if (id === 'pz_banner') {
        await interacao.showModal(modalCampos('pz_banner_mdl', 'Mudar banner do bot', [
          { id: 'url', label: 'Link do banner', obrigatorio: true, max: 500, placeholder: 'https://exemplo.com/banner.png' }
        ]));
        return;
      }
      if (id === 'pz_nome') {
        await interacao.showModal(modalCampos('pz_nome_mdl', 'Mudar nome do bot', [
          { id: 'nome', label: 'Nome do bot neste servidor', obrigatorio: true, max: 32, placeholder: 'Ex: Zeroun Mediador' }
        ]));
        return;
      }
    }
    if (isModal) { await pzAplicar(interacao, id); return; }
    return;
  }
  // ---------- Revenda / indicação ----------
  if (isBtn && id === 'rv_gerar') {
    const d = rvGarantirDono(userId);
    await responderTexto(interacao, [
      `${RV_EMO.gerar} **Seu código de convite**`,
      `Compartilhe o código **\`${d.codigo}\`**.`,
      '',
      `${RV_EMO.info1} A cada compra confirmada de plano, você ganha **30%** do valor.`,
      `${RV_EMO.info2} Compras de salas não entram na contagem.`
    ].join('\n'));
    return;
  }
  if (isBtn && id === 'rv_indic') {
    const d = rvDono(userId);
    if (!d) { await responderTexto(interacao, `${RV_EMO.indicacoes} Você ainda não tem um código. Clique em **gerar codigo** primeiro.`); return; }
    await responderTexto(interacao, [
      '**Minhas indicações**',
      `**${RV_EMO.validas} Compras válidas:** ${d.compras || 0}`,
      `${RV_EMO.indicacoes}`,
      `Seu codigo de convite: **\`${d.codigo}\`**`,
      `${RV_EMO.sacar} Saldo disponível: **${apMoeda(d.saldoCents || 0)}**`
    ].join('\n'));
    return;
  }
  if ((id === 'rv_sacar' || id === 'rv_sacar_mdl') && !ehLiberado(userId) && servidorExterno(interacao)) {
    await responderTexto(interacao, '⛔ O saque só pode ser feito no servidor oficial.');
    return;
  }
  if (isBtn && id === 'rv_sacar') {
    await interacao.showModal(modalCampos('rv_sacar_mdl', 'Sacar saldo de revenda', [
      { id: 'chave', label: 'Chave PIX', obrigatorio: true, max: 100, placeholder: 'CPF, e-mail, telefone ou chave aleatória' },
      { id: 'valor', label: 'Valor (R$)', obrigatorio: true, max: 12, placeholder: 'Ex: 10,00' }
    ]));
    return;
  }
  if (isModal && id === 'rv_sacar_mdl') { await rvProcessarSaque(interacao, userId); return; }
  if (id === 'rv_codigo' || id === 'rv_codigo_mdl') {
    const p = carrinhos.get(interacao.channelId);
    if (!p) { await responderTexto(interacao, '❌ Compra não encontrada (tópico inválido).'); return; }
    if (userId !== p.userId) { await responderTexto(interacao, '❌ Esse carrinho não é seu.'); return; }
    if (p.tipo !== 'var') { await responderTexto(interacao, '❌ Compras de salas não entram na revenda.'); return; }
    if (p.revendaCodigo) { await responderTexto(interacao, `ℹ️ Este carrinho já tem o código **${p.revendaCodigo}**.`); return; }
    if (isBtn) {
      await interacao.showModal(modalCampos('rv_codigo_mdl', 'Inserir código de convite', [
        { id: 'codigo', label: 'Código de convite', obrigatorio: true, max: 20, placeholder: 'Ex: AUTO0DE93AE2' }
      ]));
      return;
    }
    const r = rvBuscarCodigo(interacao.fields.getTextInputValue('codigo'));
    if (!r) { await responderTexto(interacao, '❌ Código de convite inválido.'); return; }
    if (r.donoId === userId) { await responderTexto(interacao, '❌ Você não pode usar o seu próprio código.'); return; }
    const jaUsou = rvDb().usos[userId];
    if (jaUsou && jaUsou !== r.donoId) { await responderTexto(interacao, '❌ Você já usou outro código de convite. Cada pessoa pode usar apenas um código.'); return; }
    p.revendaCodigo = r.codigo;
    p.revendaDono = r.donoId;
    cpSalvar();
    sucesso(`🤝 Código ${r.codigo} inserido por ${userId} no carrinho`);
    if (typeof interacao.isFromMessage === 'function' && interacao.isFromMessage()) await interacao.deferUpdate().catch(logErro);
    else await interacao.deferReply(EFEMERO).catch(logErro);
    await interacao.editReply({ content: '', embeds: [cpEmbedConfirmacaoDe(p)], components: [cpLinhaConfirmacao(p)] }).catch(logErro);
    return;
  }
  // ---------- Gateway (/mudar) ----------
  if (isBtn && (id === 'gw_mp' || id === 'gw_turbofy')) {
    const ehDono = ehLiberado(userId);
    if (!ehDono && !(servidorExterno(interacao) && externoPodeGerenciar(interacao))) { await responderTexto(interacao, '⛔ Você não tem permissão para usar isso.'); return; }
    if (id === 'gw_mp') {
      if (!gwMpToken()) { await responderTexto(interacao, ehDono ? '❌ Defina `MP_ACCESS_TOKEN=APP_USR-...` no `.env`, reinicie o bot e tente de novo.' : '❌ Esse gateway não está disponível no momento.'); return; }
      gwDefinir('mp');
    } else {
      if (!apConfigurado()) { await responderTexto(interacao, ehDono ? '❌ `TURBOFY_CLIENT_ID` / `TURBOFY_CLIENT_SECRET` não estão no `.env`.' : '❌ Esse gateway não está disponível no momento.'); return; }
      gwDefinir('turbofy');
    }
    logEmbed('seguranca', '💳 Gateway alterado', [['Servidor', String(interacao.guildId || 'DM'), true], ['Por', `<@${userId}>`, true], ['Novo', id === 'gw_mp' ? 'Mercado Pago' : 'Turbofy', true]], userId).catch(logErro);
    sucesso(`💳 Gateway alterado para ${gwAtual()} por ${userId}`);
    await interacao.update(opcoesResposta(gwTela(`✅ Agora as vendas vão para: **${gwAtual() === 'mp' ? 'Mercado Pago' : 'API da Turbofy'}**.`), true)).catch(logErro);
    return;
  }

  if (id.startsWith('cup_')) {
    if (!ehLiberado(userId)) { await responderTexto(interacao, '⛔ Apenas o dono pode usar isso.').catch(logErro); return; }
    const tipo = id.split(':')[1] === 'codigo' ? 'codigo' : 'cupom';
    const rotulo = tipo === 'codigo' ? 'código promocional' : 'cupom';
    if (isBtn && id.startsWith('cup_criar:')) {
      await interacao.showModal(modalCampos(`cup_mdl:${tipo}`, tipo === 'codigo' ? 'Criar código promocional' : 'Criar cupom', [
        { id: 'nome', label: tipo === 'codigo' ? 'Nome do código' : 'Nome do cupom', obrigatorio: true, max: 20, placeholder: 'Ex: PROMO10' },
        { id: 'pct', label: 'Porcentagem do desconto (1-99)', obrigatorio: true, max: 2, placeholder: 'Ex: 10' }
      ]));
      return;
    }
    if (isModal && id.startsWith('cup_mdl:')) {
      const nome = cupNorm(interacao.fields.getTextInputValue('nome'));
      const pct = Number(String(interacao.fields.getTextInputValue('pct') || '').trim().replace('%', ''));
      if (!/^[A-Z0-9_-]{2,20}$/.test(nome)) { await responderTexto(interacao, '❌ Nome inválido. Use de 2 a 20 caracteres: letras, números, "-" ou "_" (sem espaços).'); return; }
      if (!Number.isInteger(pct) || pct < 1 || pct > 99) { await responderTexto(interacao, '❌ Porcentagem inválida. Use um número inteiro de 1 a 99.'); return; }
      const lista = cupCarregar();
      if (lista.some(c => c.nome === nome)) { await responderTexto(interacao, `❌ Já existe um cupom/código chamado **${nome}**.`); return; }
      lista.push({ nome, tipo, percentual: pct, org: '', criadoEm: Date.now() });
      cupSalvar(lista);
      await interacao.reply(opcoesResposta(painel({ cor: COR.pagamentos, texto: `✅ ${tipo === 'codigo' ? 'Código promocional' : 'Cupom'} **${nome}** criado com **${pct}%** de desconto.${tipo === 'codigo' ? '\nUse **ORG DO CODIGO** para definir o servidor dele.' : ''}`, linhas: [] }), true));
      return;
    }
    if (isBtn && id.startsWith('cup_excluir:')) {
      await interacao.reply(opcoesResposta(cupTelaLista(`cup_del_sel:${tipo}`, `# 🗑️ Excluir\n\nEscolha qual ${rotulo} excluir.`, tipo), true));
      return;
    }
    if (isBtn && id.startsWith('cup_enviar:')) {
      await interacao.reply(opcoesResposta(cupTelaLista(`cup_env_sel:${tipo}`, `# 📨 Enviar\n\nEscolha qual ${rotulo} enviar **neste canal**.`, tipo), true));
      return;
    }
    if (isSelect && id.startsWith('cup_del_sel:')) {
      const lista = cupCarregar();
      const c = lista.find(x => x.nome === valor && x.tipo === tipo);
      if (c) cupSalvar(lista.filter(x => x !== c));
      await interacao.update(painel({ cor: c ? COR.pagamentos : COR.erro, texto: c ? `🗑️ **${c.nome}** excluído. Ele não funciona mais.` : '❌ Não encontrado.', linhas: [] }));
      return;
    }
    if (isSelect && id.startsWith('cup_env_sel:')) {
      const c = cupCarregar().find(x => x.nome === valor && x.tipo === tipo);
      if (!c) { await interacao.update(painel({ cor: COR.erro, texto: '❌ Não encontrado.', linhas: [] })); return; }
      await interacao.deferUpdate().catch(logErro);
      let ok = true;
      try { await interacao.channel.send({ embeds: [cupEmbedAnuncio(c)] }); } catch (e) { ok = false; aviso(`[Cupom] Falha ao enviar "${c.nome}": ${e.message}`); }
      await interacao.editReply(painel({ cor: ok ? COR.pagamentos : COR.erro, texto: ok ? `✅ **${c.nome}** enviado neste canal.` : '❌ Não consegui enviar (confira as permissões do bot neste canal).', linhas: [] })).catch(logErro);
      return;
    }
    if (isBtn && id === 'cup_org:codigo') {
      await interacao.showModal(modalCampos('cup_org_mdl:codigo', 'ORG DO CODIGO', [
        { id: 'nome', label: 'Nome do código promocional', obrigatorio: true, max: 20, placeholder: 'Ex: PROMO10' },
        { id: 'guild', label: 'ID do servidor (0 = remover)', obrigatorio: true, max: 20, placeholder: 'Ex: 123456789012345678' }
      ]));
      return;
    }
    if (isModal && id === 'cup_org_mdl:codigo') {
      const lista = cupCarregar();
      const c = lista.find(x => x.nome === cupNorm(interacao.fields.getTextInputValue('nome')) && x.tipo === 'codigo');
      if (!c) { await responderTexto(interacao, '❌ Código promocional não encontrado. Crie-o antes com **Criar**.'); return; }
      const g = String(interacao.fields.getTextInputValue('guild') || '').trim();
      if (g !== '0' && !/^\d{17,20}$/.test(g)) { await responderTexto(interacao, '❌ ID de servidor inválido. Use só números (17 a 20 dígitos) ou 0 para remover.'); return; }
      c.org = g === '0' ? '' : g;
      cupSalvar(lista);
      await interacao.reply(opcoesResposta(painel({ cor: COR.pagamentos, texto: c.org ? `✅ O código **${c.nome}** agora vincula o automed e o autopay ao servidor \`${c.org}\`.` : `✅ O código **${c.nome}** ficou sem restrição de servidor.`, linhas: [] }), true));
      return;
    }
    return;
  }
  if (id.startsWith('am_')) {
    if (!ehLiberado(userId)) { await responderTexto(interacao, '⛔ Apenas o dono pode usar isso.').catch(logErro); return; }
    if (isBtn && id === 'am_criar') {
      await interacao.showModal(modalCampos('am_mdl', 'Criar auto-mensagem', [
        { id: 'titulo', label: 'Título', obrigatorio: true, max: 256, placeholder: 'Ex: Regras do servidor' },
        { id: 'descricao', label: 'Descrição', paragrafo: true, obrigatorio: true, max: 2000, placeholder: 'Texto do embed' },
        { id: 'thumb', label: 'URL da thumbnail (opcional)', max: 500, placeholder: 'https://...' },
        { id: 'minutos', label: 'Tempo em minutos (apaga e reenvia)', obrigatorio: true, max: 6, placeholder: 'Ex: 5' },
        { id: 'embed', label: 'Enviar em embed? (s/n)', max: 3, placeholder: 's = embed | n = mensagem normal (vazio = s)' }
      ]));
      return;
    }
    if (isModal && id === 'am_mdl') {
      const f = k => String(interacao.fields.getTextInputValue(k) || '').trim();
      const minutos = Math.floor(Number(f('minutos').replace(',', '.')));
      if (!Number.isFinite(minutos) || minutos < 1) { await responderTexto(interacao, '❌ Tempo inválido. Use um número de minutos (mínimo 1).'); return; }
      const rEmb = f('embed').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (rEmb && !['s', 'sim', 'n', 'nao'].includes(rEmb)) { await responderTexto(interacao, '❌ No campo embed use apenas **s** (embed) ou **n** (mensagem normal).'); return; }
      const emEmbed = !rEmb || rEmb === 's' || rEmb === 'sim';
      const thumb = /^https?:\/\/\S+$/i.test(f('thumb')) ? f('thumb') : '';
      const lista = amCarregar();
      lista.push({ id: require('crypto').randomBytes(4).toString('hex'), titulo: f('titulo'), descricao: f('descricao'), thumb, minutos, embed: emEmbed, canalId: '', msgId: '', proximo: 0 });
      amSalvar(lista);
      await interacao.reply(opcoesResposta(painel({ cor: COR.pagamentos, texto: `✅ Auto-mensagem **${f('titulo')}** criada (a cada ${minutos} min, ${emEmbed ? 'em embed' : 'mensagem normal'}).\nUse **Enviar** para ativá-la neste canal.${thumb || !f('thumb') ? '' : '\n⚠️ A URL da thumbnail era inválida e foi ignorada.'}`, linhas: [] }), true));
      return;
    }
    if (isBtn && id === 'am_excluir') {
      await interacao.reply(opcoesResposta(amTelaLista('am_del_sel', '# 🗑️ Excluir\n\nEscolha qual auto-mensagem excluir.'), true));
      return;
    }
    if (isBtn && id === 'am_enviar') {
      await interacao.reply(opcoesResposta(amTelaLista('am_env_sel', '# 📨 Enviar\n\nEscolha qual auto-mensagem enviar **neste canal**.'), true));
      return;
    }
    if (isSelect && id === 'am_del_sel') {
      const lista = amCarregar();
      const it = lista.find(x => x.id === valor);
      if (it) { await amApagar(it); amSalvar(lista.filter(x => x.id !== it.id)); }
      await interacao.update(painel({ cor: it ? COR.pagamentos : COR.erro, texto: it ? `🗑️ **${it.titulo}** excluída. Ela não será mais enviada.` : '❌ Auto-mensagem não encontrada.', linhas: [] }));
      return;
    }
    if (isSelect && id === 'am_env_sel') {
      await interacao.deferUpdate().catch(logErro);
      const ok = await amDisparar(valor, interacao.channelId);
      await interacao.editReply(painel({ cor: ok ? COR.pagamentos : COR.erro, texto: ok ? '✅ Enviada neste canal. Ela será apagada e reenviada no tempo definido.' : '❌ Não consegui enviar (confira se o bot tem permissão de ver e enviar mensagens neste canal).', linhas: [] })).catch(logErro);
      return;
    }
    return;
  }
  // ---------- Ranking público: troca o período editando a MESMA mensagem ----------
  if (isSelect && id === 'rk_per') {
    const perRk = EVT_PERIODOS.some(p => p.v === valor) ? valor : '7';
    await interacao.update(rkMontar(perRk));
    rkRegistrar(interacao.message && interacao.message.id, interacao.channelId, perRk);
    return;
  }
  if (isSelect && id === 'ext_per') {
    const perExt = EXT_PERIODOS.some(p => p.v === valor) ? valor : 'all';
    await interacao.update(extMontar(perExt));
    return;
  }
  if (isSelect && valor === 'busca_vazia') { await interacao.deferUpdate().catch(logErro); return; }
  if (isBtn && id.startsWith('bs_abrir:')) {
    const escopo = id.slice('bs_abrir:'.length);
    if (escopo.startsWith('keys:') && !ehLiberado(userId)) { await responderTexto(interacao, '⛔ Apenas o dono pode fazer isso.'); return; }
    await interacao.showModal(modalCampos(`bs_mdl:${escopo}`, 'Pesquisar', [
      { id: 'campo_busca', label: 'Digite parte do nome', placeholder: 'Deixe vazio para mostrar tudo', valor: buscaTermo(userId, escopo), max: 50 }
    ]));
    return;
  }
  if (isBtn && id.startsWith('bs_limpar:')) {
    const escopo = id.slice('bs_limpar:'.length);
    if (escopo.startsWith('keys:') && !ehLiberado(userId)) { await responderTexto(interacao, '⛔ Apenas o dono pode fazer isso.'); return; }
    buscaDefinir(userId, escopo, '');
    await interacao.update(telaPorEscopo(userId, escopo));
    return;
  }
  if (isModal && id.startsWith('bs_mdl:')) {
    const escopo = id.slice('bs_mdl:'.length);
    if (escopo.startsWith('keys:') && !ehLiberado(userId)) { await responderTexto(interacao, '⛔ Apenas o dono pode fazer isso.'); return; }
    buscaDefinir(userId, escopo, interacao.fields.getTextInputValue('campo_busca'));
    await atualizar(interacao, telaPorEscopo(userId, escopo));
    return;
  }
  if (id === 'cp_comprar') {
    if (!MP_TOKEN) { await responderTexto(interacao, '❌ O Mercado Pago não está configurado (`MP_TOKEN` no `.env`).'); return; }
    await interacao.showModal(modalCampos(`mdl_cp_qtde:${interacao.channelId}`, 'Quantidade de Salas', [
      { id: 'quantidade', label: 'Quantas salas? (mínimo 20)', placeholder: 'Ex: 50', obrigatorio: true, max: 6 }
    ]));
    return;
  }
  if (id.startsWith('mdl_cp_qtde:')) {
    await interacao.deferReply(EFEMERO);
    const canalId = id.split(':')[1];
    const qtd = parseInt(String(interacao.fields.getTextInputValue('quantidade') || '').trim(), 10);
    const qtdMin = CP_MIN_SALAS;
    if (!Number.isFinite(qtd) || qtd < qtdMin || qtd > 100000) {
      await interacao.editReply({ content: `❌ Quantidade inválida. Mínimo: **${qtdMin} salas** (${formatarValor(qtdMin * cpPrecoSala(interacao.guildId))}).` });
      return;
    }
    const r = await cpCriarCarrinho(userId, interacao.user.username, canalId, interacao.guildId, qtd);
    await interacao.editReply({ content: r.ok
      ? `✅ Carrinho criado: <#${r.threadId}>. Confira os dados e clique em **Prosseguir** para gerar o Pix.`
      : `❌ ${r.motivo}` });
    return;
  }
    if (id === 'var_add') {
    if (!varPodeGerenciar(interacao)) { await responderTexto(interacao, '⛔ Você não tem permissão para fazer isso.'); return; }
    await interacao.showModal(modalCampos('mdl_var_add', 'Adicionar variável', [
      { id: 'campo_titulo', label: 'Título (qtd. de dias da key)', placeholder: 'Ex.: 7 dias', obrigatorio: true, max: 45 },
      { id: 'campo_emoji', label: 'Emoji do botão (normal ou id)', placeholder: 'Ex.: 🔥 ou <:nome:123456789>', obrigatorio: true, max: 100 },
      { id: 'campo_desc', label: 'Descrição da opção', placeholder: 'Ex.: Acesso por 7 dias + suporte', obrigatorio: true, max: 100 },
      { id: 'campo_preco', label: 'Preço do botão (R$)', placeholder: 'Ex.: 9,90', obrigatorio: true, max: 10 }
    ]));
    return;
  }
  if (id === 'mdl_var_add') {
    if (!varPodeGerenciar(interacao)) { await responderTexto(interacao, '⛔ Você não tem permissão para fazer isso.'); return; }
    const titulo = String(interacao.fields.getTextInputValue('campo_titulo') || '').trim().slice(0, 45);
    const emoji = String(interacao.fields.getTextInputValue('campo_emoji') || '').trim().slice(0, 100);
    const descricao = String(interacao.fields.getTextInputValue('campo_desc') || '').trim().slice(0, 100);
    const precoTxt = String(interacao.fields.getTextInputValue('campo_preco') || '').trim();
    const dias = parseInt(String(titulo.match(/\d+/)?.[0] || ''), 10);
    const preco = Number(String(precoTxt).replace(/[R$\s]/gi, '').replace(',', '.'));
    if (!Number.isFinite(dias) || dias < 1 || dias > 3650) {
      await interacao.update(opcoesResposta(telaVariaveis('❌ O **título** precisa conter a **quantidade de dias** (ex.: `7 dias`).'), true)).catch(logErro);
      return;
    }
    if (!Number.isFinite(preco) || preco <= 0) {
      await interacao.update(opcoesResposta(telaVariaveis('❌ **Preço** inválido (ex.: `9,90`).'), true)).catch(logErro);
      return;
    }
    const idVar = `var_${Date.now().toString(36)}`;
    const v = carregarVariaveis();
    v[idVar] = { id: idVar, titulo, dias, emoji, descricao, preco: Math.round(preco * 100) / 100, criadaEm: Date.now() };
    salvarVariaveis(v);
    await interacao.update(opcoesResposta(telaVariaveis(`✅ Variável **${titulo}** adicionada — ${dias} dia(s) por ${formatarValor(preco)}.`), true)).catch(logErro);
    return;
  }
  if (id === 'var_edit') {
    if (!varPodeGerenciar(interacao)) { await responderTexto(interacao, '⛔ Você não tem permissão para fazer isso.'); return; }
    if (!listaVariaveis().length) { await responderTexto(interacao, '❌ Nenhuma variável cadastrada para editar.'); return; }
    await interacao.update(opcoesResposta(telaEditarVariaveis(), true)).catch(logErro);
    return;
  }
  if (id === 'sl_var_edit') {
    if (!varPodeGerenciar(interacao)) { await responderTexto(interacao, '⛔ Você não tem permissão para fazer isso.'); return; }
    const vid = Array.isArray(interacao.values) ? String(interacao.values[0] || '') : '';
    const v = carregarVariaveis()[vid];
    if (!v) { await interacao.update(opcoesResposta(telaVariaveis('❌ Variável não encontrada (foi removida?).'), true)).catch(logErro); return; }
    await interacao.showModal(modalCampos(`mdl_var_edit:${vid}`, 'Editar variável', [
      { id: 'campo_titulo', label: 'Título (qtd. de dias da key)', placeholder: 'Ex.: 7 dias', valor: v.titulo, obrigatorio: true, max: 45 },
      { id: 'campo_emoji', label: 'Emoji do botão (normal ou id)', placeholder: 'Ex.: 🔥 ou <:nome:123456789>', valor: v.emoji, obrigatorio: true, max: 100 },
      { id: 'campo_desc', label: 'Descrição da opção', placeholder: 'Ex.: Acesso por 7 dias + suporte', valor: v.descricao, obrigatorio: true, max: 100 },
      { id: 'campo_preco', label: 'Preço do botão (R$)', placeholder: 'Ex.: 9,90', valor: Number(v.preco).toFixed(2).replace('.', ','), obrigatorio: true, max: 10 }
    ]));
    return;
  }
  if (id.startsWith('mdl_var_edit:')) {
    if (!varPodeGerenciar(interacao)) { await responderTexto(interacao, '⛔ Você não tem permissão para fazer isso.'); return; }
    const vid = id.split(':')[1];
    const todas = carregarVariaveis();
    if (!todas[vid]) { await interacao.update(opcoesResposta(telaVariaveis('❌ Variável não encontrada (foi removida?).'), true)).catch(logErro); return; }
    const titulo = String(interacao.fields.getTextInputValue('campo_titulo') || '').trim().slice(0, 45);
    const emoji = String(interacao.fields.getTextInputValue('campo_emoji') || '').trim().slice(0, 100);
    const descricao = String(interacao.fields.getTextInputValue('campo_desc') || '').trim().slice(0, 100);
    const precoTxt = String(interacao.fields.getTextInputValue('campo_preco') || '').trim();
    const dias = parseInt(String(titulo.match(/\d+/)?.[0] || ''), 10);
    const preco = Number(String(precoTxt).replace(/[R$\s]/gi, '').replace(',', '.'));
    if (!Number.isFinite(dias) || dias < 1 || dias > 3650) {
      await interacao.update(opcoesResposta(telaVariaveis('❌ O **título** precisa conter a **quantidade de dias** (ex.: `7 dias`). Nada foi alterado.'), true)).catch(logErro);
      return;
    }
    if (!Number.isFinite(preco) || preco <= 0) {
      await interacao.update(opcoesResposta(telaVariaveis('❌ **Preço** inválido (ex.: `9,90`). Nada foi alterado.'), true)).catch(logErro);
      return;
    }
    todas[vid] = { ...todas[vid], titulo, dias, emoji, descricao, preco: Math.round(preco * 100) / 100, editadaEm: Date.now() };
    salvarVariaveis(todas);
    await interacao.update(opcoesResposta(telaVariaveis(`✅ Variável **${titulo}** atualizada — ${dias} dia(s) por ${formatarValor(preco)}.`), true)).catch(logErro);
    return;
  }
  if (id === 'var_rem') {
    if (!varPodeGerenciar(interacao)) { await responderTexto(interacao, '⛔ Você não tem permissão para fazer isso.'); return; }
    if (!listaVariaveis().length) { await responderTexto(interacao, '❌ Nenhuma variável cadastrada para remover.'); return; }
    await interacao.update(opcoesResposta(telaRemoverVariaveis(), true)).catch(logErro);
    return;
  }
  if (id === 'var_voltar') {
    if (!varPodeGerenciar(interacao)) { await responderTexto(interacao, '⛔ Você não tem permissão para fazer isso.'); return; }
    await interacao.update(opcoesResposta(telaVariaveis(), true)).catch(logErro);
    return;
  }

  if (id === 'sl_var_rem') {
    if (!varPodeGerenciar(interacao)) { await responderTexto(interacao, '⛔ Você não tem permissão para fazer isso.'); return; }
    const escolhidas = Array.isArray(interacao.values) ? interacao.values : [];
    if (!escolhidas.length) { await responderTexto(interacao, '❌ Nenhuma variável selecionada.'); return; }
    const v = carregarVariaveis();
    let removidas = 0;
    for (const vid of escolhidas) { if (v[vid]) { delete v[vid]; removidas++; } }
    if (removidas) salvarVariaveis(v);
    await interacao.update(opcoesResposta(telaVariaveis(`✅ **${removidas}** variável(is) removida(s).`), true)).catch(logErro);
    return;
  }
  if (id === 'sl_compra') {
    const vid = Array.isArray(interacao.values) ? String(interacao.values[0] || '') : '';
    const v = carregarVariaveis()[vid];
    if (!v) { await responderTexto(interacao, '❌ Variável não encontrada (foi removida?).'); return; }
    if (!MP_TOKEN) { await responderTexto(interacao, '❌ Pagamentos não configurados.'); return; }
    await interacao.deferReply(EFEMERO);
    const r = await cpCriarCarrinhoVariavel(userId, interacao.user.username, interacao.channelId, interacao.guildId, v);
    await interacao.editReply({ content: r.ok
      ? `✅ Carrinho criado: <#${r.threadId}>. Confira os dados e clique em **Prosseguir** para gerar o Pix.`
      : `❌ ${r.motivo}` });
    return;
  }
    if (id === 'cp_cupom' || id === 'cp_cupom_mdl') {
      const p = carrinhos.get(interacao.channelId);
      if (!p) { await responderTexto(interacao, '❌ Compra não encontrada (tópico inválido).'); return; }
      if (userId !== p.userId) { await responderTexto(interacao, '❌ Esse carrinho não é seu.'); return; }
      if (p.cupom) { await responderTexto(interacao, `ℹ️ Este carrinho já tem o cupom **${p.cupom}** aplicado.`); return; }
      if (isBtn) {
        await interacao.showModal(modalCampos('cp_cupom_mdl', 'Aplicar cupom', [
          { id: 'codigo', label: 'Cupom ou código promocional', obrigatorio: true, max: 30, placeholder: 'Ex: PROMO10' }
        ]));
        return;
      }
      if (cpGerando.has(interacao.channelId)) { await responderTexto(interacao, '⏳ O pagamento já está sendo criado.'); return; }
      const c = cupBuscar(interacao.fields.getTextInputValue('codigo'));
      if (!c) { await responderTexto(interacao, '❌ Cupom ou código promocional inválido.'); return; }
      const base = Number(p.valorOriginal || p.valor);
      const novo = Number((base * (1 - c.percentual / 100)).toFixed(2));
      if (!(novo >= 0.01)) { await responderTexto(interacao, '❌ Esse desconto deixaria o valor abaixo do mínimo de R$ 0,01.'); return; }
      if (typeof interacao.isFromMessage === 'function' && interacao.isFromMessage()) await interacao.deferUpdate().catch(logErro);
      else await interacao.deferReply(EFEMERO).catch(logErro);
      const pendente = cpPromessas.get(interacao.channelId);
      if (pendente) await pendente.catch(logErro);
      if (p.paymentId) apCbDep.delete(p.paymentId);
      Object.assign(p, {
        valorOriginal: base, valor: novo, cupom: c.nome, desconto: c.percentual, orgGuildId: c.org || null,
        paymentId: null, copiaECola: null, qrBase64: null, expiraEm: null
      });
      cpSalvar();
      const novoPag = cpCriarPagamentoMP(p.userId, p.quantidade, novo);
      novoPag.catch(logErro);
      cpAplicarPagamento(interacao.channelId, novoPag).catch(logErro);
      sucesso(`🎟️ Cupom ${c.nome} (${c.percentual}%) aplicado por ${userId}: ${formatarValor(base)} → ${formatarValor(novo)}`);
      logEmbed('geral', '🎟️ Cupom APLICADO', [
        ['👤 Comprador', `<@${p.userId}>`, true],
        ['🏷️ Cupom', c.nome, true],
        ['📉 Desconto', `${c.percentual}%`, true],
        ['💰 Valor', `${formatarValor(base)} → ${formatarValor(novo)}`, true]
      ], p.userId).catch(logErro);
      await interacao.editReply({ content: '', embeds: [cpEmbedConfirmacaoDe(p)], components: [cpLinhaConfirmacao(p)] }).catch(logErro);
      return;
    }
    if (id === 'cp_prosseguir') {
    const p = carrinhos.get(interacao.channelId);
    if (!p) { await responderTexto(interacao, '❌ Compra não encontrada (tópico inválido).'); return; }
    if (userId !== p.userId) { await responderTexto(interacao, '❌ Esse carrinho não é seu.'); return; }
    if (!MP_TOKEN) { await responderTexto(interacao, '❌ Mercado Pago não configurado.'); return; }
    if (cpGerando.has(interacao.channelId)) { await responderTexto(interacao, '⏳ O pagamento já está sendo criado.'); return; }
    cpGerando.add(interacao.channelId);
    try {
      await interacao.deferUpdate();
      await interacao.editReply({ content: '**GERANDO PAGAMENTO** <a:loading:1554692841412759562>', embeds: [], components: [] }).catch(logErro);
      try {
        info(`[Carrinho] Prosseguir clicado (pagamento já pronto: ${!!p.paymentId})`);
        await Promise.race([
          cpPrepararPagamento(interacao.channelId),
          new Promise((_, rej) => setTimeout(() => rej(new Error('Pix demorou mais de 45s')), 45000))
        ]);
        if (!p.paymentId) throw new Error('Pagamento não foi criado (carrinho inválido).');
        // Embed SEM anexo: instantâneo (upload de QR às vezes trava 75s no proxy).
        await interacao.editReply({ content: '', embeds: [cpEmbedPix(p, true)], components: [cpLinhaPix()] });
        // QR enviado em mensagem separada, sem travar o fluxo (máx 3s de espera).
      } catch (e) {
        erro(`[Carrinho] criar pagamento: ${e.message}`);
        await interacao.editReply({ content: `❌ Erro ao criar pagamento: \`${String(e.message).slice(0, 300)}\`. Clique em Prosseguir para tentar de novo.`, embeds: [cpEmbedConfirmacaoDe(p)], components: [cpLinhaConfirmacao(p)] }).catch(logErro);
      }
    } finally { cpGerando.delete(interacao.channelId); }
    return;
  }
  if (id === 'cp_cancelar') {
    const p = carrinhos.get(interacao.channelId);
    if (p && p.userId !== userId) { await responderTexto(interacao, '❌ Esse carrinho não é seu.'); return; }
    carrinhos.delete(interacao.channelId);
    cpSalvar();
    if (p && p.paymentId) apCbDep.delete(p.paymentId);
    if (p && p.gateway === 'mp' && p.paymentId) cpMp(`/v1/payments/${encodeURIComponent(p.paymentId)}`, { method: 'PUT', body: { status: 'cancelled' } }).catch(logErro);
    if (p) {
      logEmbed('geral', '❌ Compra CANCELADA', [
        ['👤 Comprador', `<@${p.userId}>`, true],
        [p.tipo === 'var' ? '📦 Produto' : '🎮 Quantidade', p.tipo === 'var' ? (p.titulo || '—') : `${p.quantidade} salas`, true],
        ['💰 Valor', formatarValor(p.valor), true]
      ], p.userId).catch(logErro);
    }
    const canalCancel = interacao.channel;
    await interacao.reply({ content: '❌ Compra cancelada. Este tópico será excluído em instantes.', ...EFEMERO });
    setTimeout(() => { canalCancel.delete().catch(logErro); }, 1500);
    return;
  }
    if (id === 'cp_qr') {
    const pQr = carrinhos.get(interacao.channelId);
    if (!pQr || !pQr.copiaECola) { await responderTexto(interacao, '❌ Código ainda não disponível.'); return; }
    const bufQr = await apObterQrBuffer(null, pQr.copiaECola);
    await interacao.reply(bufQr ? { files: [{ attachment: bufQr, name: 'qrcode.png' }], ...EFEMERO } : { content: String(pQr.copiaECola), ...EFEMERO });
    return;
  }
  if (id === 'cp_copiar') {
    const p = carrinhos.get(interacao.channelId);
    if (!p || !p.copiaECola) { await responderTexto(interacao, '❌ Código ainda não disponível.'); return; }
    await responderTexto(interacao, String(p.copiaECola));
    return;
  }
  if (id === 'sd_add' || id === 'sd_rem' || id.startsWith('mdl_sd:')) {
    if (!ehLiberado(userId)) { await responderTexto(interacao, '⛔ Apenas o dono pode fazer isso.'); return; }
    if (id === 'sd_add' || id === 'sd_rem') {
      await interacao.showModal(modalCampos(`mdl_sd:${id === 'sd_add' ? 'add' : 'rem'}`, id === 'sd_add' ? 'Adicionar saldo de salas' : 'Remover saldo de salas', [
        { id: 'campo_key', label: 'Key do usuário', placeholder: 'ZEROUN-AUTOMED-XXXXXX-XXXXXX', obrigatorio: true, max: 40 },
        { id: 'campo_qtd', label: 'Quantidade de salas', placeholder: 'Ex: 10', obrigatorio: true, max: 7 }
      ]));
      return;
    }
    const modo = id.split(':')[1];
    const chaveSd = String(interacao.fields.getTextInputValue('campo_key') || '').trim().toUpperCase();
    const qtdSd = parseInt(String(interacao.fields.getTextInputValue('campo_qtd') || '').trim(), 10);
    if (!Number.isInteger(qtdSd) || qtdSd < 1) { await responderTexto(interacao, '❌ Quantidade inválida. Use um número inteiro maior que 0.'); return; }
    const recSd = carregarKeys()[chaveSd];
    if (!recSd) { await responderTexto(interacao, '❌ Key não encontrada.'); return; }
    if (!recSd.usadaPor) { await responderTexto(interacao, '⚠️ Essa key ainda não foi ativada por ninguém, não há usuário para receber o saldo.'); return; }
    const alvoSd = recSd.usadaPor;
    const atualSd = Number(obterConfigUsuario(alvoSd).salasCompradas) || 0;
    const novoSd = modo === 'add' ? atualSd + qtdSd : Math.max(0, atualSd - qtdSd);
    salvarConfigUsuario(alvoSd, { salasCompradas: novoSd });
    salasBotRegistrarDelta(alvoSd, novoSd - atualSd);
    sucesso(`💰 Admin: saldo de salas de ${alvoSd} ${modo === 'add' ? '+' : '-'}${qtdSd} (agora ${novoSd})`);
    await responderTexto(interacao, `${modo === 'add' ? '✅ Adicionadas' : '✅ Removidas'} **${qtdSd}** sala(s) ${modo === 'add' ? 'para' : 'de'} <@${alvoSd}>.\n🪙 Saldo: \`${atualSd}\` → \`${novoSd}\``);
    return;
  }
  if (id.startsWith('adm_') || id.startsWith('mdl_adm:')) {
    if (!ehLiberado(userId)) { await responderTexto(interacao, '⛔ Apenas o dono pode fazer isso.'); return; }
    if (id.startsWith('mdl_adm:')) {
      const qualM = id.split(':')[1];
      const tM = TIPOS_MENSAGEM[qualM];
      if (!tM) return;
      const textoM = String(interacao.fields.getTextInputValue('campo_texto') || '').trim().slice(0, 1900);
      const patch = { [tM.campo]: textoM };
      if (qualM === 'instr') {
        let img = '';
        try { img = String(interacao.fields.getTextInputValue('campo_img') || '').trim(); } catch {}
        if (img && !/^https?:\/\/\S+$/i.test(img)) { await responderTexto(interacao, '❌ Link da foto inválido. Use http:// ou https://.'); return; }
        patch.imagemInstrucoes = img;
      }
      salvarMsgAdmin(patch);
      sucesso(`👑 Admin: ${tM.rotulo} ${textoM ? 'alterada para TODOS' : 'removida'}`);
      await responderTexto(interacao, textoM
        ? `✅ **${tM.rotulo}** alterada para **TODOS os usuários**.`
        : `⚙️ **${tM.rotulo}** removida (volta ao padrão de cada usuário).`);
      return;
    }
    const qualA = id === 'adm_menu' ? valor.replace(/^adm_/, '') : id.slice('adm_b:'.length);
    const tA = TIPOS_MENSAGEM[qualA];
    if (!tA) return;
    const camposA = [
      { id: 'campo_texto', label: 'Texto para TODOS (vazio = remove)', placeholder: `Use ${tA.placeholders}`, valor: msgAdmin(tA.campo), paragrafo: true, max: 1900 }
    ];
    if (qualA === 'instr') {
      camposA.push({ id: 'campo_img', label: 'Link da foto (opcional)', placeholder: 'https://...', valor: msgAdmin('imagemInstrucoes'), max: 400 });
    }
    await interacao.showModal(modalCampos(`mdl_adm:${qualA}`, `Admin: ${tA.rotulo}`, camposA));
    return;
  }
  if (id.startsWith('k_') || id === 'mdl_gerar') {
    if (!ehLiberado(userId)) { await responderTexto(interacao, '⛔ Apenas o dono pode fazer isso.'); return; }
    if (id === 'k_gerar') {
      await interacao.showModal(modalCampos('mdl_gerar', 'Gerar key', [
        { id: 'campo_dias', label: 'Quantidade de dias', placeholder: 'Ex.: 30', obrigatorio: true, max: 4 }
      ]));
      return;
    }
    if (id === 'mdl_gerar') {
      const dias = parseInt(String(interacao.fields.getTextInputValue('campo_dias') || '').trim(), 10);
      if (!Number.isInteger(dias) || dias < 1 || dias > 3650) {
        await interacao.reply(opcoesResposta(telaErro('Quantidade de dias inválida. Use um número de **1** a **3650**.'), true));
        return;
      }
      const rec = gerarKey(dias, userId);
      sucesso(`🔑 Key gerada: ${rec.chave} (${dias} dia(s))`);
      await interacao.reply(opcoesResposta(painel({
        cor: COR.keys,
        texto: [
          '# Key gerada',
          RODAPE,
          '',
          `\`${rec.chave}\``,
          '',
          `⏳ **Duração:** ${dias} dia(s)`,
          '-# A contagem começa quando o usuário ativar a key. Cada key serve para apenas 1 usuário.'
        ].join('\n')
      }), true));
      return;
    }
    if (id === 'k_ver') { await interacao.reply(opcoesResposta(telaVerKeys(), true)); return; }
    if (id === 'k_ver_refresh') { await interacao.update(telaVerKeys()); return; }
    if (id === 'k_excluir') { await interacao.reply(opcoesResposta(telaExcluirKey(undefined, userId), true)); return; }
    if (id === 'k_addt' || id === 'k_remt') { await interacao.reply(opcoesResposta(telaTempoKey(id === 'k_addt' ? 'add' : 'rem'), true)); return; }
    if (id.startsWith('k_tsel:')) {
      const modo = id.split(':')[1];
      await interacao.showModal(modalCampos(`k_mdl:${modo}:${valor}`, modo === 'add' ? 'Adicionar tempo' : 'Remover tempo', [
        { id: 'campo_horas', label: 'Quantidade de horas', placeholder: 'Ex.: 24', obrigatorio: true, max: 6 }
      ]));
      return;
    }
    if (id.startsWith('k_mdl:')) {
      const [, modo, chaveK] = id.split(':');
      const horas = parseInt(String(interacao.fields.getTextInputValue('campo_horas') || '').trim(), 10);
      if (!Number.isInteger(horas) || horas < 1) { await responderTexto(interacao, '❌ Horas inválidas. Use um número inteiro maior que 0.'); return; }
      const rec = ajustarTempoKey(chaveK, modo === 'add' ? horas : -horas);
      if (!rec) { await responderTexto(interacao, '⚠️ Key não encontrada.'); return; }
      sucesso(`🔑 Key ${chaveK}: ${modo === 'add' ? '+' : '-'}${horas}h`);
      await responderTexto(interacao, `✅ ${modo === 'add' ? 'Adicionadas' : 'Removidas'} **${horas}h** na key \`${chaveK}\`.\n⏳ Restante: **${restanteDaKey(rec)}**`);
      return;
    }
    if (id === 'k_del') {
      const rec = excluirKey(valor);
      let msg;
      if (!rec) msg = '⚠️ Essa key já havia sido excluída.';
      else {
        if (rec.usadaPor) {
          desligarUsuario(rec.usadaPor);
          }
        sucesso(`🗑️ Key ${valor} excluída${rec.usadaPor ? ` — acesso removido de ${rec.usadaPor}` : ''}`);
        msg = `✅ Key \`${valor}\` excluída.${rec.usadaPor ? ` O acesso de <@${rec.usadaPor}> foi removido.` : ''}`;
      }
      await interacao.update(telaExcluirKey(msg, userId));
      return;
    }
    return;
  }

  if (id === 'abg_add' || id === 'abg_rem' || id === 'abg_rem_sel' || id === 'mdl_abg_add') {
    if (!ehLiberado(userId)) { await responderTexto(interacao, '⛔ Apenas o dono pode usar isso.'); return; }
    if (isBtn && id === 'abg_add') {
      await interacao.showModal(modalCampos('mdl_abg_add', 'Servidor antiban', [
        { id: 'gid', label: 'ID do servidor', obrigatorio: true, max: 20, placeholder: '123456789012345678' }
      ]));
      return;
    }
    if (isModal && id === 'mdl_abg_add') {
      const gid = String(interacao.fields.getTextInputValue('gid') || '').trim();
      if (!/^\d{17,20}$/.test(gid)) { await atualizar(interacao, telaAntibanAdmin('❌ ID inválido.')); return; }
      if (!botClient.guilds.cache.has(gid)) { await atualizar(interacao, telaAntibanAdmin('❌ O bot oficial não está nesse servidor. Adicione-o antes.')); return; }
      const lista = antibanLista();
      if (!lista.includes(gid)) antibanSalvar([...lista, gid]);
      sucesso(`🛡️ Servidor ${gid} colocado em ANTIBAN por ${userId}`);
      await atualizar(interacao, telaAntibanAdmin(`✅ **${botClient.guilds.cache.get(gid).name}** agora está em antiban.`));
      return;
    }
    if (isBtn && id === 'abg_rem') {
      const lista = antibanLista().slice(0, 25);
      if (!lista.length) { await interacao.update(telaAntibanAdmin('⚠️ Nenhum servidor em antiban.')); return; }
      await interacao.update(painel({
        cor: COR.sistema,
        texto: '# Remover antiban\n\nEscolha o servidor que sai do modo antiban.',
        linhas: [menu('abg_rem_sel', 'Selecione o servidor...', lista.map(g => ({
          label: String((botClient.guilds.cache.get(g) || {}).name || g).slice(0, 100), value: g, description: g, emoji: emojiUI('🏠')
        })))]
      }));
      return;
    }
    if (isSelect && id === 'abg_rem_sel') {
      antibanSalvar(antibanLista().filter(g => g !== valor));
      for (const [uid, u] of Object.entries(carregarUsuarios())) {
        if (u && u.ligado === true) { ultimaAtividadeValorPorUsuario.set(String(uid), Date.now()); contasDesativadasInatividade.delete(String(uid)); }
      }
      sucesso(`🛡️ Servidor ${valor} removido do ANTIBAN por ${userId}`);
      await interacao.update(telaAntibanAdmin('✅ Removido. As contas com AutoMed ativo voltam a responder pela conta selfbot nesse servidor.'));
      return;
    }
    return;
  }
  const acesso = statusAcesso(userId);
  const liberadoSemKey = ['c_cfg', 'cab_cfg', 'c_inicio', 'mdl_key'].includes(id) || (id === 'p_main' && valor === 'm_key');
  // Key vinculada a um servidor: o /central de QUALQUER servidor abre normalmente, mas tudo que for configurado
  // vale só para o servidor da key (listarServidoresConta devolve apenas ele).
  if (!acesso.ok && !liberadoSemKey) {
    await interacao.reply(opcoesResposta(telaBloqueada(false), true));
    return;
  }
  if (acesso.ok && acesso.congelada) {
    const permitido = liberadoSemKey || id.startsWith('s_') || id === 'p_voltar' || (id === 'p_main' && valor === 'm_sistema');
    if (!permitido) { await interacao.reply(opcoesResposta(telaBloqueada(true), true)); return; }
  }

  await garantirNomesServidores(userId).catch(logErro);
  const regSis = paineisSistema.get(userId);
  if ((id === 'p_main' && valor === 'm_sistema') || id.startsWith('s_')) {
    registrarPainelSistema(userId, interacao);
  } else if (regSis && interacao.message && regSis.interacao.message &&
             interacao.message.id === regSis.interacao.message.id) {
    paineisSistema.delete(userId);
  }
  // Key vinculada: não pede selectmenu de servidor — abre direto as telas do servidor da key.
  {
    const vincPainel = servidorVinculadoDoUsuario(userId);
    if (vincPainel) {
      const ATALHOS_SRV = { ia_cfg: 'ia_srv', bi_cfg: 'bi_srv', on_cfg: 'on_srv' };
      if (isBtn && ATALHOS_SRV[id]) { id = ATALHOS_SRV[id]; valor = vincPainel; }
      else if (isSelect && id === 'a_menu' && valor === 'a_msgs') { id = 'ms_srv'; valor = vincPainel; }
    }
  }
  if (id === 'cab_cfg') {
    const us = carregarUsuarios();
    const u = us[userId] || (us[userId] = {});
    if (u.token) { await interacao.reply(opcoesResposta(telaPrincipal(userId, '⚠️ Você tem token cadastrado no /central. Remova-o em Discord > Token para usar o modo sem token.'), true)); return; }
    if (!u.antibanLivre) u.antibanLivre = { ativo: true, guilds: [] }; else u.antibanLivre.ativo = true;
    salvarUsuarios(us);
    await interacao.reply(opcoesResposta(telaPrincipal(userId), true));
    return;
  }
  if (isSelect && id === 'abl_srv') {
    if (valor === 'busca_vazia') { await interacao.update(telaAbLivre(userId)); return; }
    const us = carregarUsuarios();
    const u = us[userId] || (us[userId] = {});
    if (u.token) { await interacao.update(telaAbLivre(userId, '⚠️ Remova o token do /central primeiro.')); return; }
    if (!u.antibanLivre) u.antibanLivre = { ativo: true, guilds: [] };
    const ls = new Set((u.antibanLivre.guilds || []).map(String));
    let msg;
    if (ls.has(String(valor))) { ls.delete(String(valor)); msg = '✅ Servidor desativado.'; }
    else if (antibanLista().includes(String(valor))) { ls.add(String(valor)); msg = '✅ Servidor ativado.'; }
    else msg = '⚠️ Esse servidor não tem antiban ativo.';
    u.antibanLivre.ativo = true; u.antibanLivre.guilds = Array.from(ls);
    if (ls.size) u.ligado = true;
    salvarUsuarios(us);
    if (ls.size) iniciarSelfbot(userId); else pararSelfbot(userId, 'antiban livre sem servidores');
    await interacao.update(telaAbLivre(userId, msg));
    return;
  }
  if (id === 'c_cfg') { await interacao.reply(opcoesResposta(telaPrincipal(userId), true)); return; }
  if (id === 'c_inicio') { await interacao.update(telaInicio()); return; }
  if (id === 'p_voltar') { await interacao.update(telaPrincipal(userId)); return; }
  if (id === 'v_discord') { const uV = carregarUsuarios()[userId]; await interacao.update(abLivreCfg(uV) && !(uV || {}).token ? telaAbLivre(userId) : telaDiscord(userId)); return; }
  if (id === 'v_automed') { await interacao.update(telaAutomed(userId)); return; }
  if (id === 'v_salas') { await interacao.update(telaSalas(userId)); return; }
  if (id === 'v_msgs') { await interacao.update(telaMensagens(userId)); return; }

  if (id === 'p_main') {
    if (valor === 'm_discord') { const uD = carregarUsuarios()[userId]; await interacao.update(abLivreCfg(uD) && !(uD || {}).token ? telaAbLivre(userId) : telaDiscord(userId)); return; }
    if (valor === 'm_gmail') { await interacao.update(telaGmail(userId)); return; }
    if (valor === 'm_autopay') { await interacao.update(telaAutoPay(userId)); return; }
    if (valor === 'm_sistema') { await interacao.update(telaSistema(userId)); return; }
    if (valor === 'm_ia') { await interacao.update(telaIA(userId)); return; }
    if (valor === 'm_stats') { await interacao.update(telaEstatisticas(userId)); return; }
    if (valor === 'm_hist') { histEstados.delete(String(userId)); await interacao.update(telaHistorico(userId)); return; }
    if (valor === 'm_key') {
      await interacao.showModal(modalCampos('mdl_key', 'Adicionar key', [
        { id: 'campo_key', label: 'Sua key de acesso', placeholder: 'ZEROUN-AUTOMED-XXXXXX-XXXXXX', obrigatorio: true, max: 40 }
      ]));
      return;
    }
    return;
  }
  // ---------------- Estatísticas / Histórico ----------------
  if (isSelect && id === 'est_per') {
    estPeriodoUsuario.set(String(userId), EVT_PERIODOS.some(p => p.v === valor) ? valor : '7');
    await interacao.update(telaEstatisticas(userId));
    return;
  }
  if (isSelect && id === 'hs_per') {
    const stH = histEstado(userId);
    stH.periodo = EVT_PERIODOS.some(p => p.v === valor) ? valor : '7';
    stH.pag = 0;
    await interacao.update(telaHistorico(userId));
    return;
  }
  if (isBtn && (id === 'hs_prev' || id === 'hs_next')) {
    const stH = histEstado(userId);
    stH.pag += id === 'hs_next' ? 1 : -1;
    await interacao.update(telaHistorico(userId));
    return;
  }
  if (isBtn && id === 'hs_busca') {
    await interacao.showModal(modalCampos('mdl_hs_busca', 'Pesquisar pagador', [
      { id: 'campo_busca', label: 'Nome do pagador', placeholder: 'Deixe vazio para mostrar tudo', valor: histEstado(userId).busca, max: 50 }
    ]));
    return;
  }
  if (isBtn && id === 'hs_limpar') {
    const stH = histEstado(userId);
    stH.busca = '';
    stH.pag = 0;
    await interacao.update(telaHistorico(userId));
    return;
  }
  if (isModal && id === 'mdl_hs_busca') {
    const stH = histEstado(userId);
    stH.busca = String(interacao.fields.getTextInputValue('campo_busca') || '').trim().slice(0, 50);
    stH.pag = 0;
    await atualizar(interacao, telaHistorico(userId));
    return;
  }
  if (id === 'mdl_key') {
    const r = resgatarKey(userId, interacao.fields.getTextInputValue('campo_key'));
    await atualizar(interacao, telaPrincipal(userId, r.msg));
    return;
  }

  if (id.startsWith('pf_') || id.startsWith('mdl_pf_')) {
    if (id.split(':')[1] !== userId) { await responderTexto(interacao, '⛔ Só quem usou o comando pode usar esses botões.'); return; }
    const cfgPf = obterConfigUsuario(userId);
    if (id.startsWith('pf_senha:')) {
      await interacao.showModal(modalCampos(`mdl_pf_senha:${userId}`, 'Senha fixa', [
        { id: 'campo_senha', label: 'Senha da sala (vazio = aleatória)', placeholder: 'Ex.: 1234', valor: String(cfgPf.senhaFixa || ''), max: 12 }
      ]));
      return;
    }
    if (id.startsWith('pf_go:')) {
      await interacao.showModal(modalCampos(`mdl_pf_go:${userId}`, 'Tempo de go', [
        { id: 'campo_min', label: 'Minutos até a sala iniciar sozinha (1-60)', placeholder: 'Padrão: 3', valor: String(cfgPf.tempoGo || ''), max: 2 }
      ]));
      return;
    }
    if (id.startsWith('mdl_pf_senha:')) {
      const s = String(interacao.fields.getTextInputValue('campo_senha') || '').trim();
      if (s && !/^[A-Za-z0-9]{3,12}$/.test(s)) { await atualizar(interacao, telaPerfil(userId, '❌ Senha inválida. Use de 3 a 12 letras/números.')); return; }
      salvarConfigUsuario(userId, { senhaFixa: s });
      await atualizar(interacao, telaPerfil(userId, s ? '✅ **Senha fixa** definida.' : '⚙️ Senha voltou a ser aleatória.'));
      return;
    }
    if (id.startsWith('mdl_pf_go:')) {
      const bruto = String(interacao.fields.getTextInputValue('campo_min') || '').trim();
      const n = bruto ? parseInt(bruto, 10) : 3;
      if (!Number.isInteger(n) || n < 1 || n > 60) { await atualizar(interacao, telaPerfil(userId, '❌ Use um número de 1 a 60.')); return; }
      salvarConfigUsuario(userId, { tempoGo: n });
      await atualizar(interacao, telaPerfil(userId, `✅ **Tempo de go:** ${n} min.`));
      return;
    }
    return;
  }
  // ---------------- AutoPay ----------------
  if (id === 'ap_menu') {
    if (valor === 'ap_dep') {
      await interacao.showModal(modalCampos('mdl_ap_dep', 'Depositar', [
        { id: 'campo_valor', label: 'Valor do depósito (R$)', placeholder: `Ex.: 25,00 (mínimo ${valorApenas(AP_MIN_CENTS / 100)})`, obrigatorio: true, max: 12 }
      ]));
      return;
    }
    if (valor === 'ap_saq') {
      await interacao.showModal(modalCampos('mdl_ap_saq', 'Sacar', [
        { id: 'campo_chave', label: 'Chave PIX que vai receber', placeholder: 'CPF, CNPJ, e-mail, telefone ou chave aleatória', obrigatorio: true, max: 100 },
        { id: 'campo_valor', label: 'Valor do saque (R$)', placeholder: `Ex.: 10,00 (mínimo ${valorApenas(AP_MIN_SAQUE_CENTS / 100)})`, obrigatorio: true, max: 12 }
      ]));
      return;
    }
    return;
  }
  if (id === 'ap_refresh') {
    await adiar(interacao);
    try { await apVerificarPendentesUsuario(userId); } catch (e) { aviso(`[AutoPay] atualizar [${userId}]: ${e.message}`); }
    await interacao.editReply(telaAutoPay(userId));
    return;
  }
  if (id.startsWith('ap_copy:')) {
    const dep = apUsuario(userId).depositos[id.slice('ap_copy:'.length)];
    if (!dep) { await interacao.reply(opcoesResposta(apEmbedMsg('# Depósito não encontrado\nGere um novo depósito pelo painel.', COR.erro), true)); return; }
    await interacao.reply({ content: dep.copiaCola, ...EFEMERO });
    return;
  }
  if (id.startsWith('ap_qr:')) {
    const dep = apUsuario(userId).depositos[id.slice('ap_qr:'.length)];
    if (!dep) { await interacao.reply(opcoesResposta(apEmbedMsg('# Depósito não encontrado\nGere um novo depósito pelo painel.', COR.erro), true)); return; }
    const bufQrDep = await apObterQrBuffer(null, dep.copiaCola);
    await interacao.reply(bufQrDep ? { files: [{ attachment: bufQrDep, name: 'qrcode.png' }], ...EFEMERO } : { content: String(dep.copiaCola), ...EFEMERO });
    return;
  }
  if (isModal && id.startsWith('mdl_valorsala:')) {
    if (!ehMeuId(userId)) { await responderTexto(interacao, '⛔ Apenas o dono pode usar este comando.'); return; }
    const g = id.slice('mdl_valorsala:'.length);
    if (!interacao.guildId || String(interacao.guildId) !== g) { await responderTexto(interacao, '⛔ Servidor inválido. Rode /valorsala de novo.'); return; }
    const num = normalizarNumero(interacao.fields.getTextInputValue('campo_valor'));
    if (num === null || num < 0) { await responderTexto(interacao, '❌ Valor inválido. Use um número como `0,03`.'); return; }
    if (num === 0) {
      cpPrecoSalaSalvar(g, null);
      sucesso(`[${userId}] Valor da sala • servidor ${g} voltou ao padrão (${formatarValor(CP_PRECO_SALA)})`);
      await responderTexto(interacao, `✅ Valor da sala neste servidor voltou ao padrão: **${formatarValor(CP_PRECO_SALA)}**.`);
      return;
    }
    cpPrecoSalaSalvar(g, num);
    sucesso(`[${userId}] Valor da sala • servidor ${g} = ${formatarValor(num)}`);
    await responderTexto(interacao, `✅ Valor da sala do AutoMed **neste servidor** definido para **${formatarValor(num)}** por sala. Outros servidores não foram alterados.`);
    return;
  }
  if (id === 'gpix_mdl') {
    await interacao.deferReply(EFEMERO);
    const cents = apParseValor(interacao.fields.getTextInputValue('campo_valor'));
    if (!cents || cents < AP_MIN_CENTS || cents > AP_MAX_CENTS) {
      await interacao.editReply(apEmbedMsg(`# Operação não concluída\nValor inválido. O depósito mínimo é ${apMoeda(AP_MIN_CENTS)} (máximo ${apMoeda(AP_MAX_CENTS)}).`, COR.erro));
      return;
    }
    const r = await apCriarDeposito(userId, cents);
    if (!r.ok) {
      const motivos = {
        offline: 'AutoPay offline no momento. Tente novamente em instantes.',
        minimo: `O depósito mínimo é ${apMoeda(AP_MIN_CENTS)}.`,
        limite: `Você já tem ${AP_MAX_DEP_PENDENTES} depósitos pendentes. Pague ou aguarde expirar antes de gerar outro.`,
        rapido: 'Aguarde alguns segundos antes de gerar outro depósito.',
        chave_recebedor: 'O sistema de pagamentos está com a chave PIX do recebedor incorreta. O dono precisa corrigir a chave no painel Turbofy.',
        api: 'Não foi possível gerar o QR Code agora. Tente novamente em instantes.'
      };
      await interacao.editReply(apEmbedMsg(`# Operação não concluída\n${motivos[r.motivo] || motivos.api}`, COR.erro));
      return;
    }
    logEmbed('autopay', '💳 /gerarpix: cobrança criada', [['Conta', `<@${userId}>`], ['Valor', apMoeda(r.dep.valorCents)], ['Crédito', apMoeda(r.dep.creditoCents)], ['ID', r.dep.id]], userId).catch(logErro);
    try {
      gpixCanais.set(r.dep.id, interacao.channel.id);
      await interacao.channel.send(apMensagemDeposito(r.dep, null));
      await interacao.editReply(apEmbedMsg('✅ Cobrança PIX enviada neste canal. O pagamento será confirmado automaticamente.', COR.pagamentos));
    } catch (e) {
      aviso(`[/gerarpix] Falha ao enviar cobrança no canal: ${e.message}`);
      gpixCanais.delete(r.dep.id);
      await interacao.editReply(apEmbedMsg('❌ Não consegui enviar a cobrança neste canal (confira as permissões do bot aqui).', COR.erro));
    }
    return;
  }
  if (id === 'mdl_ap_dep') {
    const t0 = Date.now();
    await interacao.deferReply(EFEMERO);
    const t1 = Date.now();
    const cents = apParseValor(interacao.fields.getTextInputValue('campo_valor'));
    if (!cents || cents < AP_MIN_CENTS || cents > AP_MAX_CENTS) {
      await interacao.editReply(apEmbedMsg(`# Operação não concluída\nValor inválido. O depósito mínimo é ${apMoeda(AP_MIN_CENTS)} (máximo ${apMoeda(AP_MAX_CENTS)}).`, COR.erro));
      return;
    }
    const r = await apCriarDeposito(userId, cents);
    const t2 = Date.now();
    if (!r.ok) {
      const motivos = {
        offline: 'AutoPay offline no momento. Tente novamente em instantes.',
        minimo: `O depósito mínimo é ${apMoeda(AP_MIN_CENTS)}.`,
        limite: `Você já tem ${AP_MAX_DEP_PENDENTES} depósitos pendentes. Pague ou aguarde expirar antes de gerar outro.`,
        rapido: 'Aguarde alguns segundos antes de gerar outro depósito.',
        chave_recebedor: 'O sistema de pagamentos está com a chave PIX do recebedor incorreta. O dono precisa corrigir a chave no painel Turbofy (a chave deve pertencer à conta que recebe o dinheiro).',
        api: 'Não foi possível gerar o QR Code agora. Tente novamente em instantes.'
      };
      await interacao.editReply(apEmbedMsg(`# Operação não concluída\n${motivos[r.motivo] || motivos.api}`, COR.erro));
      return;
    }
    apNotifDep.set(r.dep.id, interacao);
    logEmbed('autopay', '🏦 Depósito criado (painel)', [['Conta', `<@${userId}>`], ['Valor', apMoeda(r.dep.valorCents)], ['Crédito', apMoeda(r.dep.creditoCents)], ['ID', r.dep.id]], userId).catch(logErro);
    await interacao.editReply(apMensagemDeposito(r.dep, null));
    const t3 = Date.now();
    const enviouQr = false;
    info(`[AutoPay] depósito ${apMoeda(cents)} (crédito ${apMoeda(r.dep.creditoCents)}) • discord(defer) ${t1 - t0}ms • Turbofy ${t2 - t1}ms • 1ª resposta ${t3 - t2}ms • QR ${Date.now() - t3}ms${enviouQr ? '' : ' • sem imagem'}`);
    return;
  }
  if (id === 'mdl_ap_saq') {
    await interacao.deferReply(EFEMERO);
    const chave = interacao.fields.getTextInputValue('campo_chave');
    const cents = apParseValor(interacao.fields.getTextInputValue('campo_valor'));
    const cor = res => (res.ok ? COR.pagamentos : COR.erro);
    const notificar = async res => { await interacao.editReply(apEmbedMsg(apTextoSaque(res), cor(res))); await apEnviarComprovante(res, o => interacao.followUp({ ...o, ...EFEMERO })); };
    const r = cents
      ? await apSerial(userId, () => apExecutarSaque(userId, chave, cents, notificar))
      : { ok: false, codigo: 'valor_invalido' };
    logEmbed('autopay', '💸 Saque via painel', [['Conta', `<@${userId}>`], ['Valor', apMoeda(cents)], ['Resultado', r.codigo || '?'], ['Chave', apMascarar(chave)]], userId).catch(logErro);
    await interacao.editReply(apEmbedMsg(apTextoSaque(r), cor(r)));
    await apEnviarComprovante(r, o => interacao.followUp({ ...o, ...EFEMERO }));
    return;
  }

  // ---------------- Discord ----------------
  if (id === 'd_menu') {
    if (valor === 'd_token') {
      await interacao.showModal(modalCampos('mdl_token', 'Token do selfbot', [
        { id: 'campo_token', label: 'Token da conta do Discord', placeholder: 'Cole o token da conta que verifica os pagamentos', obrigatorio: true, max: 200 }
      ]));
      return;
    }
    if (valor === 'd_automed') { await interacao.update(telaAutomed(userId)); return; }
    return;
  }
  if (id === 'mdl_token') {
    const tokenBruto = interacao.fields.getTextInputValue('campo_token');
    await adiar(interacao);
    const v = await validarTokenDiscord(tokenBruto);
    if (!v.ok) {
      aviso(`Token recusado (enviado por ${userId}) — motivo: ${v.motivo}${v.status ? ` • HTTP ${v.status}` : ''}${v.detalhe ? ` • ${v.detalhe}` : ''}${v.tamanho ? ` • tamanho: ${v.tamanho}` : ''}`);
      await interacao.editReply(telaDiscord(userId, mensagemErroToken(v)));
      return;
    }
    const usuarios = carregarUsuarios();
    const outro = Object.entries(usuarios).find(([uid, u]) => uid !== userId && u && u.contaId === v.id);
    if (outro) {
      await interacao.editReply(telaDiscord(userId, '❌ Essa conta do Discord já está vinculada a outro usuário.'));
      return;
    }
    usuarios[userId] = {
      ...(usuarios[userId] || {}),
      token: v.token, nomeConta: v.nome, contaId: v.id, userIdDetectado: v.id,
      adicionadoEm: Date.now(), adicionadoPor: userId
    };
    salvarUsuarios(usuarios);
    sucesso(`Token salvo — ${v.nome} (${v.id}) por ${userId}`);
    if (selfbots.has(userId)) {
      pararSelfbot(userId);
      await esperar(800);
      iniciarSelfbot(userId);
    }
    await interacao.editReply(telaDiscord(userId, `✅ **Token salvo!** Conta: **${v.nome}** · \`${v.id}\``));
    return;
  }

  if (id === 'a_menu') {
    if (valor === 'a_pag') { await interacao.update(telaPagamentos(userId)); return; }
    if (valor === 'a_salas') { await interacao.update(telaSalas(userId)); return; }
    if (valor === 'a_msgs') { await interacao.update(telaMensagens(userId)); return; }
    return;
  }

  if (id === 'pg_menu') {
    const cfg = obterConfigUsuario(userId);
    if (valor === 'pg_ganho') {
      await interacao.showModal(modalCampos('mdl_pg_ganho', 'Ganho por fila', [
        { id: 'campo_valor', label: 'Valor ganho a cada fila (R$)', placeholder: 'Ex.: 0,50 (vazio = 0)', valor: valorModalNumero(cfg.ganhoFila), max: 12 }
      ]));
      return;
    }
    if (valor === 'pg_tol') {
      await interacao.showModal(modalCampos('mdl_pg_tol', 'Tolerância', [
        { id: 'campo_valor', label: 'Diferença aceita no pagamento (R$)', placeholder: 'Ex.: 0,10 (vazio = 0)', valor: valorModalNumero(cfg.tolerancia), max: 12 }
      ]));
      return;
    }
    return;
  }
  if (id === 'mdl_pg_ganho' || id === 'mdl_pg_tol') {
    const bruto = String(interacao.fields.getTextInputValue('campo_valor') || '').trim();
    const num = bruto ? normalizarNumero(bruto) : 0;
    if (num === null || num < 0) {
      await atualizar(interacao, telaPagamentos(userId, '❌ Valor inválido. Use um número como `0,50`.'));
      return;
    }
    const chave = id === 'mdl_pg_ganho' ? 'ganhoFila' : 'tolerancia';
    salvarConfigUsuario(userId, { [chave]: num });
    sucesso(`[${userId}] ${chave} = ${formatarValor(num)}`);
    await atualizar(interacao, telaPagamentos(userId, `✅ **${chave === 'ganhoFila' ? 'Ganho/fila' : 'Tolerância'}** definido para **${formatarValor(num)}**.`));
    return;
  }

  if (id === 'ia_voltar') { await interacao.update(telaIA(userId)); return; }
  if (id === 'ia_cfg') { await interacao.update(telaIAServidores(userId)); return; }
  if (id === 'ia_srv') {
    if (!listarServidoresConta(userId).some(s => s.id === valor)) {
      await interacao.update(telaIAServidores(userId, '⚠️ Servidor não encontrado. A conta ainda está nele?'));
      return;
    }
    await interacao.update(telaIACanais(userId, valor, 0));
    return;
  }
  if (id.startsWith('ia_pg:')) {
    const [, g, p] = id.split(':');
    await interacao.update(telaIACanais(userId, g, p));
    return;
  }
  if (id.startsWith('ia_sel:')) {
    const [, g, p] = id.split(':');
    const idsPag = ondePagina(userId, g, 'can', p, `can:ia:${g}`).itens.map(c => c.id);
    const atual = iaConfig(userId, g);
    const novo = [...new Set([...atual.filter(x => !idsPag.includes(x)), ...(interacao.values || [])])];
    if (novo.length > IA_MAX_CANAIS) {
      await interacao.update(telaIACanais(userId, g, p, `⚠️ Máximo de **${IA_MAX_CANAIS}** canais. Nada foi alterado, desmarque algum antes.`));
      return;
    }
    salvarIaCanais(userId, g, novo);
    sucesso(`[${userId}] IA • ${nomeDoServidor(userId, g)}: ${novo.length} canal(is).`);
    await interacao.update(telaIACanais(userId, g, p, `✅ Salvo: **${novo.length}/${IA_MAX_CANAIS}** canais.`));
    return;
  }
  if (id === 'bi_cfg') { await interacao.update(telaBuscaServidores(userId)); return; }
  if (id === 'bi_srv') {
    if (!listarServidoresConta(userId).some(s => s.id === valor)) {
      await interacao.update(telaBuscaServidores(userId, '⚠️ Servidor não encontrado. A conta ainda está nele?'));
      return;
    }
    await interacao.showModal(modalCampos(`mdl_bi:${valor}`, 'Busca instruções', [
      { id: 'campo_modelo', label: 'Modelo ({Valor} e {Taxa})', placeholder: 'Cole como a mensagem chega e troque os números por {Valor} e {Taxa}', valor: modeloDoServidor(userId, valor), paragrafo: true, max: 1500 }
    ]));
    return;
  }
  if (id.startsWith('mdl_bi:')) {
    const guildId = id.split(':')[1];
    const modelo = String(interacao.fields.getTextInputValue('campo_modelo') || '').trim();
    if (modelo && !/\{valor\}/i.test(modelo)) {
      await atualizar(interacao, telaBuscaServidores(userId, '❌ O modelo precisa ter `{Valor}` no lugar do valor a pagar.'));
      return;
    }
    salvarModeloServidor(userId, guildId, modelo);
    sucesso(`[${userId}] ${nomeDoServidor(userId, guildId)} • Busca instruções: ${modelo ? 'modelo salvo' : 'removido'}`);
    await atualizar(interacao, telaBuscaServidores(userId, modelo
      ? `✅ Modelo salvo para **${nomeDoServidor(userId, guildId)}**.`
      : `⚙️ Modelo removido de **${nomeDoServidor(userId, guildId)}**.`));
    return;
  }
  if (id === 'on_cfg') { await interacao.update(telaOndeServidores(userId)); return; }
  if (id === 'on_srv') {
    if (!listarServidoresConta(userId).some(s => s.id === valor)) {
      await interacao.update(telaOndeServidores(userId, '⚠️ Servidor não encontrado. A conta ainda está nele?'));
      return;
    }
    await interacao.update(telaOndeModo(userId, valor));
    return;
  }
  if (id.startsWith('on_voltar:')) { await interacao.update(telaOndeModo(userId, id.split(':')[1])); return; }
  if (id.startsWith('on_cat:') || id.startsWith('on_can:')) {
    const [pref, guildId] = id.split(':');
    await interacao.update(telaOndeLista(userId, guildId, pref === 'on_cat' ? 'cat' : 'can', 0));
    return;
  }
  if (id.startsWith('on_pg:')) {
    const [, guildId, tipo, pag] = id.split(':');
    await interacao.update(telaOndeLista(userId, guildId, tipo, pag));
    return;
  }
  if (id.startsWith('on_off:')) {
    const guildId = id.split(':')[1];
    const novo = !ondeConfig(userId, guildId).desativado;
    salvarOndeDesativado(userId, guildId, novo);
    sucesso(`[${userId}] ${nomeDoServidor(userId, guildId)} • mensagens ${novo ? 'DESATIVADAS' : 'ativadas'}.`);
    await interacao.update(telaOndeModo(userId, guildId, novo
      ? '🔇 **Mensagens desativadas.** O bot não responde mais neste servidor.'
      : '🔊 **Mensagens ativadas.** O bot voltou a responder neste servidor.'));
    return;
  }
  if (id.startsWith('on_limpar:')) {
    const guildId = id.split(':')[1];
    salvarOnde(userId, guildId, 'cat', []);
    salvarOnde(userId, guildId, 'can', []);
    sucesso(`[${userId}] ${nomeDoServidor(userId, guildId)} • responde em todo o servidor.`);
    await interacao.update(telaOndeModo(userId, guildId, '🌐 Configuração removida. O bot responde em **todo o servidor**.'));
    return;
  }
  if (id.startsWith('on_sel:')) {
    const [, guildId, tipo, pagTxt] = id.split(':');
    const campo = tipo === 'cat' ? 'categorias' : 'canais';
    const idsPagina = ondePagina(userId, guildId, tipo, pagTxt, `can:on:${guildId}:${tipo}`).itens.map(c => c.id);
    const atual = ondeConfig(userId, guildId)[campo];
    const novo = [...new Set([...atual.filter(x => !idsPagina.includes(x)), ...(interacao.values || [])])];
    if (novo.length > ONDE_MAX) {
      await interacao.update(telaOndeLista(userId, guildId, tipo, pagTxt, `⚠️ Máximo de **${ONDE_MAX}**. Nada foi alterado, desmarque algum antes.`));
      return;
    }
    salvarOnde(userId, guildId, tipo, novo);
    sucesso(`[${userId}] ${nomeDoServidor(userId, guildId)} • ${campo}: ${novo.length} selecionado(s).`);
    await interacao.update(telaOndeLista(userId, guildId, tipo, pagTxt, `✅ Salvo: **${novo.length}/${ONDE_MAX}**.`));
    return;
  }
  if (id === 'sl_modo') { await interacao.update(telaSalasAutomed(userId)); return; }
  if (id === 'sl_auto_sel') {
    if (!PROVEDORES_SALA.length) { await interacao.update(telaSalasAutomed(userId, '⚠️ Nenhuma API de salas configurada: defina `CUPULA_API_KEY`, `NIX_API_KEY` ou `RX_API_KEY` no `.env` do bot.')); return; }
    const todosIds = listarServidoresConta(userId).map(x => x.id);
    const mostrados = buscaFiltrar(listarServidoresConta(userId), buscaTermo(userId, 'srv:sl_auto'), x => x.nome).slice(0, 25).map(x => x.id);
    const cfgA = obterConfigUsuario(userId);
    const atuais = cfgA.salasAutomed === true ? todosIds : (Array.isArray(cfgA.salasAutomedServidores) ? cfgA.salasAutomedServidores : []);
    const novo = [...new Set([...atuais.filter(x => !mostrados.includes(x)), ...(interacao.values || [])])];
    salvarConfigUsuario(userId, { salasAutomed: null, salasAutomedServidores: novo });
    sucesso(`[${userId}] Salas automed ativas em ${novo.length} servidor(es).`);
    await interacao.update(telaSalasAutomed(userId, novo.length
      ? `🤖 Salas automed ativas em **${novo.length}** servidor(es).`
      : '🏠 Salas automed **desativadas** em todos. Vale o comando do servidor.'));
    return;
  }
  if (id === 'sl_srv' && valor === 'sl_telador') {
    await interacao.showModal(modalCampos('mdl_meet', 'Chamar telador', [
      { id: 'campo_cmd', label: 'Comando enviado quando falarem "tela"', placeholder: 'Padrão: .tela', valor: String((carregarConfigs()[userId] || {}).comandoMeet || ''), max: 200 }
    ]));
    return;
  }
  if (id === 'sl_srv') {
    if (!listarServidoresConta(userId).some(s => s.id === valor)) {
      await interacao.update(telaSalas(userId, '⚠️ Servidor não encontrado. A conta ainda está nele?'));
      return;
    }
    await interacao.update(telaSalasServidor(userId, valor));
    return;
  }
  if (id.startsWith('sl_menu:')) {
    const guildId = id.split(':')[1];
    const tipo = valor.replace(/^sl_/, '');
    if (!guildId) return;
    if (!TIPOS_SALA[tipo]) return;
    const atual = comandoSalaDoServidor(userId, guildId, tipo);
    const camposSala = [
      { id: 'campo_cmd', label: 'Comando (use / para slash)', placeholder: `Padrão: ${DEFAULT_COMANDOS_SALA[tipo]}`, valor: atual, obrigatorio: true, max: 200 }
    ];
    await interacao.showModal(modalCampos(`mdl_sala:${guildId}:${tipo}`, `Comando: ${TIPOS_SALA[tipo].rotulo}`, camposSala));
    return;
  }
  if (id.startsWith('mdl_sala:')) {
    const [, guildId, tipo] = id.split(':');
    if (!guildId || !TIPOS_SALA[tipo]) { await atualizar(interacao, telaSalas(userId, '❌ Opção inválida.')); return; }
    const cmd = String(interacao.fields.getTextInputValue('campo_cmd') || '').trim().slice(0, 200);
    let argSala = '';
    try { argSala = String(interacao.fields.getTextInputValue('campo_arg') || '').trim().slice(0, 200); } catch {}
    salvarComandoSalaServidor(userId, guildId, tipo, cmd);
    salvarArgSalaServidor(userId, guildId, tipo, argSala);
    sucesso(`[${userId}] ${nomeDoServidor(userId, guildId)} • ${TIPOS_SALA[tipo].rotulo}: ${cmd || `padrão (${DEFAULT_COMANDOS_SALA[tipo]})`}`);
    await atualizar(interacao, telaSalasServidor(userId, guildId, cmd
      ? `✅ **${TIPOS_SALA[tipo].rotulo}** agora envia \`${cmd}\` neste servidor.`
      : `⚙️ **${TIPOS_SALA[tipo].rotulo}** voltou ao padrão (\`${DEFAULT_COMANDOS_SALA[tipo]}\`).`));
    return;
  }

  if (id === 'sl_meet') {
    await interacao.showModal(modalCampos('mdl_meet', 'MEET', [
      { id: 'campo_cmd', label: 'Comando enviado quando falarem "tela"', placeholder: 'Padrão: .tela', valor: String((carregarConfigs()[userId] || {}).comandoMeet || ''), max: 200 }
    ]));
    return;
  }
  if (id === 'mdl_meet') {
    const cmd = String(interacao.fields.getTextInputValue('campo_cmd') || '').trim().slice(0, 200);
    salvarConfigUsuario(userId, { comandoMeet: cmd });
    sucesso(`[${userId}] MEET: ${cmd || 'padrão (.tela)'}`);
    await atualizar(interacao, telaSalas(userId, cmd ? `✅ **MEET** agora envia \`${cmd}\`.` : '⚙️ **MEET** voltou ao padrão (`.tela`).'));
    return;
  }
  if (isBtn && id === 'ms_var') {
    await interacao.showModal(modalCampos('mdl_var', 'Configurar variável', [
      { id: 'gatilho', label: 'Gatilho (o que aciona a mensagem)', placeholder: 'Ex: pix', obrigatorio: true, max: 100 },
      { id: 'mensagem', label: 'Mensagem que o bot envia', placeholder: 'Ex: Minha chave pix é ...', obrigatorio: true, paragrafo: true, max: 1900 }
    ]));
    return;
  }
  if (isModal && id === 'mdl_var') {
    const gatilho = String(interacao.fields.getTextInputValue('gatilho') || '').trim().slice(0, 100);
    const mensagemVar = String(interacao.fields.getTextInputValue('mensagem') || '').trim().slice(0, 1900);
    if (!normalizarGatilho(gatilho) || !mensagemVar) {
      await atualizar(interacao, telaMensagens(userId, '❌ Preencha o **gatilho** (com letras ou números) e a **mensagem**.'));
      return;
    }
    const lista = variaveisMsg(userId);
    const chave = normalizarGatilho(gatilho);
    const existente = lista.find(v => normalizarGatilho(v.gatilho) === chave);
    if (existente) {
      existente.gatilho = gatilho;
      existente.mensagem = mensagemVar;
    } else if (lista.length >= 25) {
      await atualizar(interacao, telaMensagens(userId, '❌ Limite de **25 variáveis**. Exclua alguma antes de criar outra.'));
      return;
    } else {
      lista.push({ id: crypto.randomBytes(4).toString('hex'), gatilho, mensagem: mensagemVar });
    }
    salvarConfigUsuario(userId, { variaveisMsg: lista });
    sucesso(`[${userId}] Variável ${existente ? 'atualizada' : 'criada'}: ${gatilho}`);
    await atualizar(interacao, telaMensagens(userId, `✅ Variável **${existente ? 'atualizada' : 'criada'}**: \`${gatilho}\``));
    return;
  }
  if (isBtn && id === 'ms_var_del') {
    await interacao.update(telaVariaveisExcluir(userId));
    return;
  }
  if (isSelect && id === 'ms_var_del_sel') {
    const ids = new Set(interacao.values || []);
    const lista = variaveisMsg(userId);
    const restantes = lista.filter(v => !ids.has(v.id));
    salvarConfigUsuario(userId, { variaveisMsg: restantes });
    sucesso(`[${userId}] ${lista.length - restantes.length} variável(is) excluída(s).`);
    await interacao.update(telaMensagens(userId, `🗑️ **${lista.length - restantes.length}** variável(is) excluída(s).`));
    return;
  }
  if (id === 'ms_win') {
    await interacao.showModal(modalCampos('mdl_win', 'Mensagem de WIN', [
      { id: 'campo_texto', label: 'Texto (vazio = padrão)', placeholder: 'Use {nome}', valor: String((carregarConfigs()[userId] || {}).msgWin || ''), paragrafo: true, max: 1900 }
    ]));
    return;
  }
  if (id === 'mdl_win') {
    const texto = String(interacao.fields.getTextInputValue('campo_texto') || '').trim().slice(0, 1900);
    salvarConfigUsuario(userId, { msgWin: texto });
    sucesso(`[${userId}] Mensagem WIN ${texto ? 'personalizada' : 'padrão'}`);
    await atualizar(interacao, telaMensagens(userId, texto ? '✅ **Mensagem de WIN** atualizada.' : '⚙️ **Mensagem de WIN** voltou ao padrão.'));
    return;
  }
  if (id === 'ms_fantasma') {
    const novo = !modoSilencioso(userId);
    salvarConfigUsuario(userId, { modoSilencioso: novo ? true : null });
    sucesso(`[${userId}] Modo fantasma ${novo ? 'ATIVADO' : 'desativado'}.`);
    await interacao.update(telaMensagens(userId, novo
      ? '👻 **Modo fantasma ativado.** O bot só reage com ✅/❌ e envia o comando de sala.'
      : '⚙️ **Modo fantasma desativado.** O bot volta a enviar as mensagens normais.'));
    return;
  }
  if (id === 'ms_global') {
    if (mensagemGlobalAtiva(userId)) {
      salvarConfigUsuario(userId, { msgsGlobal: null });
      sucesso(`[${userId}] Mensagens globais desativadas.`);
      await interacao.update(telaMensagens(userId, '⚙️ **Global desativado.** Agora configure servidor por servidor.'));
      return;
    }
    await interacao.update(telaMensagensGlobal(userId));
    return;
  }
  if (id === 'mg_menu') {
    const qual = valor.replace(/^mg_/, '');
    const t = TIPOS_MENSAGEM[qual];
    if (!t) return;
    const campos = [
      { id: 'campo_texto', label: 'Texto global (vazio = padrão)', placeholder: `Use ${t.placeholders}`, valor: textoModalGlobal(userId, t.campo), paragrafo: true, max: 1900 }
    ];
    if (qual === 'instr') {
      campos.push({ id: 'campo_img', label: 'Link da foto (opcional)', placeholder: 'https://... (vazio = não enviar foto)', valor: textoModalGlobal(userId, 'imagemInstrucoes'), max: 400 });
    }
    await interacao.showModal(modalCampos(`mdl_msgg:${qual}`, `Global: ${t.rotulo}`, campos));
    return;
  }
  if (id.startsWith('mdl_msgg:')) {
    const qual = id.split(':')[1];
    const t = TIPOS_MENSAGEM[qual];
    if (!t) { await atualizar(interacao, telaMensagens(userId, '❌ Opção inválida.')); return; }
    const texto = String(interacao.fields.getTextInputValue('campo_texto') || '').trim().slice(0, 1900);
    if (qual === 'instr') {
      let img = '';
      try { img = String(interacao.fields.getTextInputValue('campo_img') || '').trim(); } catch {}
      if (img && !/^https?:\/\/\S+$/i.test(img)) {
        await atualizar(interacao, telaMensagensGlobal(userId, '❌ Link da foto inválido. Use um link que comece com `http://` ou `https://`.'));
        return;
      }
      salvarMensagemGlobal(userId, { msgInstrucoes: texto, imagemInstrucoes: img });
      sucesso(`[${userId}] Global • instruções ${texto ? 'personalizada' : 'padrão'}${img ? ' + foto' : ''}`);
      await atualizar(interacao, telaMensagensGlobal(userId, texto || img
        ? `✅ **${t.rotulo}** configurada para **todos os servidores**.`
        : `⚙️ **${t.rotulo}** global removida (volta ao padrão).`));
      return;
    }
    salvarMensagemGlobal(userId, { [t.campo]: texto });
    sucesso(`[${userId}] Global • ${t.rotulo}: ${texto ? 'personalizada' : 'padrão'}`);
    await atualizar(interacao, telaMensagensGlobal(userId, texto
      ? `✅ **${t.rotulo}** configurada para **todos os servidores**.`
      : `⚙️ **${t.rotulo}** global removida (volta ao padrão).`));
    return;
  }
  if (id === 'ms_srv') {
    if (!listarServidoresConta(userId).some(s => s.id === valor)) {
      await interacao.update(telaMensagens(userId, '⚠️ Servidor não encontrado. A conta ainda está nele?'));
      return;
    }
    await interacao.update(telaMensagensServidor(userId, valor));
    return;
  }
  if (id.startsWith('ms_menu:')) {
    const guildId = id.split(':')[1];
    const qual = valor.replace(/^ms_/, '');
    const t = TIPOS_MENSAGEM[qual];
    if (!guildId || !t) return;
    const campos = [
      { id: 'campo_texto', label: 'Texto (vazio = padrão)', placeholder: `Use ${t.placeholders}`, valor: textoModalServidor(userId, guildId, t.campo), paragrafo: true, max: 1900 }
    ];
    if (qual === 'instr') {
      campos.push({ id: 'campo_img', label: 'Link da foto (opcional)', placeholder: 'https://... (vazio = não enviar foto)', valor: textoModalServidor(userId, guildId, 'imagemInstrucoes'), max: 400 });
    }
    await interacao.showModal(modalCampos(`mdl_msg:${guildId}:${qual}`, t.rotulo, campos));
    return;
  }
  if (id.startsWith('mdl_msg:')) {
    const [, guildId, qual] = id.split(':');
    const t = TIPOS_MENSAGEM[qual];
    if (!guildId || !t) { await atualizar(interacao, telaMensagens(userId, '❌ Opção inválida.')); return; }
    const texto = String(interacao.fields.getTextInputValue('campo_texto') || '').trim().slice(0, 1900);
    if (qual === 'instr') {
      let img = '';
      try { img = String(interacao.fields.getTextInputValue('campo_img') || '').trim(); } catch {}
      if (img && !/^https?:\/\/\S+$/i.test(img)) {
        await atualizar(interacao, telaMensagensServidor(userId, guildId, '❌ Link da foto inválido. Use um link que comece com `http://` ou `https://`.'));
        return;
      }
      salvarMensagemServidor(userId, guildId, { msgInstrucoes: texto, imagemInstrucoes: img });
      sucesso(`[${userId}] ${nomeDoServidor(userId, guildId)} • instruções ${texto ? 'personalizada' : 'padrão'}${img ? ' + foto' : ''}`);
      await atualizar(interacao, telaMensagensServidor(userId, guildId, texto || img
        ? `✅ **${t.rotulo}** atualizada neste servidor.`
        : `⚙️ **${t.rotulo}** voltou ao padrão.`));
      return;
    }
    salvarMensagemServidor(userId, guildId, { [t.campo]: texto });
    sucesso(`[${userId}] ${nomeDoServidor(userId, guildId)} • ${t.rotulo}: ${texto ? 'personalizada' : 'padrão'}`);
    await atualizar(interacao, telaMensagensServidor(userId, guildId, texto
      ? `✅ **${t.rotulo}** atualizada neste servidor.`
      : `⚙️ **${t.rotulo}** voltou ao padrão.`));
    return;
  }

  // ---------------- Gmail ----------------
  if (id === 'g_reconectar') {
    iniciarServidorOAuth();
    if (!servidorOAuth) {
      await interacao.reply(opcoesResposta(telaErro(`Não foi possível abrir o servidor automático na porta ${OAUTH_PORT}. No .env defina OAUTH_PORT (outra porta) e, se usar VPS, OAUTH_REDIRECT_URI=http://SEU_IP:${OAUTH_PORT}/oauth2callback, liberando a porta no firewall.`), true));
      return;
    }
    let url;
    try { ({ url } = gerarUrlOAuthUsuario(userId, interacao)); }
    catch (e) {
      erro(`OAuth: ${e.message}`);
      await interacao.reply(opcoesResposta(telaErro(`Não foi possível gerar o link: ${e.message}`), true));
      return;
    }
    info(`<:1002682623:1556633508246589470> OAuth gerado para ${userId}`);
    abrirNavegador(url);
    await interacao.reply({
      content: '**1.** Clique em **Conectar Gmail** e autorize.\n**2.** Quando aparecer **"EMAIL CONFIGURADO COM SUCESSO"**, volte ao painel e configure seu AutoMed.',
      components: [linhaBotoes(
        new ButtonBuilder().setLabel('Conectar Gmail').setStyle(ButtonStyle.Link).setURL(url).setEmoji('<:1002682623:1556633508246589470>')
      )],
      ...EFEMERO
    });
    return;
  }
  if (id === 'g_pix') {
    const atual = String(obterConfigUsuario(userId).chavePix || '').trim();
    if (atual) {
      salvarConfigUsuario(userId, { chavePix: null });
      sucesso(`💠 [${userId}] PIX desativado.`);
      await atualizar(interacao, telaGmail(userId, '🔴 **Chave PIX desativada.** A detecção pela chave PIX foi desligada.'));
      return;
    }
    await interacao.showModal(modalCampos('mdl_pix', 'Ativar chave PIX', [
      { id: 'campo_pix', label: 'Texto do PIX enviado nas instruções', placeholder: 'Cole aqui exatamente o que o bot deve enviar', obrigatorio: true, paragrafo: true, max: 1000 }
    ]));
    return;
  }
  if (id === 'mdl_pix') {
    const chave = String(interacao.fields.getTextInputValue('campo_pix') || '').trim();
    if (!chave) {
      await atualizar(interacao, telaGmail(userId, '❌ Informe o texto do PIX.'));
      return;
    }
    salvarConfigUsuario(userId, { chavePix: chave });
    sucesso(`💠 [${userId}] PIX ativado (${mascararChavePix(chave)}).`);
    await atualizar(interacao, telaGmail(userId, '🟢 **Chave PIX ativada.** O texto será enviado exatamente como você digitou, junto das instruções.'));
    return;
  }

  // ---------------- Configurar taxa por servidor ----------------
  if (id === 'g_bancoprob') {
    await interacao.showModal(modalCampos('mdl_bancoprob', 'Banco proibido', [
      { id: 'campo_bp', label: 'Valor extra em R$ (Inter/PicPay/MP)', placeholder: 'Ex.: 0,10 (0 = desativar)', valor: valorModalNumero(valorBancoProibido(userId)), max: 12 }
    ]));
    return;
  }
  if (id === 'mdl_bancoprob') {
    const bruto = String(interacao.fields.getTextInputValue('campo_bp') || '').trim();
    const num = bruto ? normalizarNumero(bruto) : 0.10;
    if (num === null || num < 0 || num > 100) {
      await atualizar(interacao, telaGmail(userId, '❌ Valor inválido. Use um número como `0,10`.'));
      return;
    }
    salvarConfigUsuario(userId, { valorBancoProibido: num });
    sucesso(`[${userId}] Banco proibido = ${formatarValor(num)}`);
    await atualizar(interacao, telaGmail(userId, num > 0
      ? `✅ Quem pagar com **Inter, PicPay ou Mercado Pago** vai pagar mais **${formatarValor(num)}**.`
      : '✅ Banco proibido **desativado** (R$ 0,00).'));
    return;
  }
  if (id === 'appn_gmail' || id === 'appn_pag') {
    const novo = !appNotifAtivo(userId);
    salvarConfigUsuario(userId, { appNotif: novo ? true : null });
    sucesso(`📱 [${userId}] Notificações do app ${novo ? 'ATIVADAS' : 'desativadas'}.`);
    const msgApp = novo ? '🟢 **Notificações do app ativadas.** O bot lê os Pix pelo celular **e também pelo Gmail** (se a conta tiver Gmail conectado).' : '🔴 **Notificações do app desativadas.** O bot volta a ler pelo Gmail e ignora o que o celular enviar.';
    await atualizar(interacao, id === 'appn_pag' ? telaPagamentos(userId, msgApp) : telaGmail(userId, msgApp));
    return;
  }
  if (id === 'g_pauto') {
    const novo = obterConfigUsuario(userId).pagAuto !== true;
    salvarConfigUsuario(userId, { pagAuto: novo ? true : null });
    sucesso(`💳 [${userId}] Turbofy ${novo ? 'ATIVADA' : 'desativada'}.`);
    await atualizar(interacao, telaGmail(userId, novo
      ? '🟢 **Turbofy ativada.** Ao achar 2 jogadores no embed, o bot gera 2 Pix pela Turbofy com o valor da sala na sua carteira AutoPay.'
      : '🔴 **Turbofy desativada.**'));
    return;
  }
  if (id === 'g_desconectar') {
    const usuarios = carregarUsuarios();
    const u = usuarios[userId];
    if (!u || !u.gmailToken) { await interacao.update(telaGmail(userId, '⚠️ Nenhum Gmail conectado.')); return; }
    const tokenGoogle = u.gmailToken;
    pararSelfbot(userId);
    delete u.gmailToken;
    delete u.email;
    delete u.autorizadoEm;
    u.ligado = false;
    salvarUsuarios(usuarios);
    estadosGmail.delete(userId);
    cacheEmailsPorUsuario.delete(userId);
    emailsProcessadosPorUsuario.delete(userId);
    emailsEmUsoPorUsuario.delete(userId);
    emailsEmAnalisePorUsuario.delete(userId);
    emailsNaFilaDeExclusaoPorUsuario.delete(userId);
    try {
      const cred = carregarCredenciaisOAuth();
      const auth = new google.auth.OAuth2(cred.client_id, cred.client_secret);
      auth.setCredentials(tokenGoogle);
      await auth.revokeToken(tokenGoogle.refresh_token || tokenGoogle.access_token);
    } catch {}
    sucesso(`<:1002682622:1556633148178305056> Gmail desconectado: ${userId}`);
    await interacao.update(telaGmail(userId, '✅ **Gmail desconectado** e removido do bot. O sistema foi parado.'));
    return;
  }
  // ---------------- Gerenciar sistema ----------------
  if (id === 's_ativar') {
    const u = carregarUsuarios()[userId] || {};
    let msg;
    const ativarLivre = !u.token && !!abLivreCfg(u);
    if (!u.token && !ativarLivre) msg = '⚠️ Configure o **token** em *Discord → Token* antes de ativar.';
    else if (ativarLivre && !abLivreGuilds(userId).length) msg = '⚠️ Escolha ao menos um **servidor antiban** em *Discord → Servidores antiban* antes de ativar.';
    else {
      // Reativação manual (inclusive de conta desativada por inatividade).
      registrarAtividadeValor(userId);
      contasDesativadasInatividade.delete(String(userId));
      definirLigado(userId, true);
      iniciarSelfbot(userId);
      msg = '▶️ **Sistema ativado!** O bot de verificação de pagamentos está conectando.';
      sucesso(`▶️ Instância ativada por ${userId}`);
    }
    await interacao.update(telaSistema(userId, msg));
    return;
  }
  if (id === 's_reiniciar') {
    pararSelfbot(userId);
    definirLigado(userId, true);
    const esperaReinicio = Math.max(0, Number(process.env.RESTART_DELAY_MS ?? 8000));
    setTimeout(() => {
      try { iniciarSelfbot(userId); sucesso(`🔄 Instância reiniciada por ${userId}`); }
      catch (e) { erro(`Reiniciar [${userId}]: ${e.message}`); }
    }, esperaReinicio);
    await interacao.update(telaSistema(userId, '🔄 **Reiniciando...** a instância voltará em instantes.'));
    return;
  }
  if (id === 's_parar') {
    desligarUsuario(userId);
    sucesso(`⏹️ Instância parada por ${userId} (a key continua valendo)`);
    await interacao.update(telaSistema(userId, '⏹️ **Instância parada.** Sua key continua valendo normalmente.'));
    return;
  }
  if (id === 's_menu') {
    if (valor === 's_copiar') {
      const rec = statusAcesso(userId).key;
      await interacao.update(telaSistema(userId));
      if (rec) await interacao.followUp({ content: `\`${rec.chave}\``, ...EFEMERO });
      return;
    }
    if (valor === 's_congelar') {
      const rec = alternarCongelamentoKey(userId);
      if (rec && rec.limite) {
        await interacao.update(telaSistema(userId, rec.limite === 'congelar'
          ? '**  > <a:cancel:1553640762946756648> O congelamento dessa key ja foi usado!**'
          : '**  > <a:cancel:1553640762946756648> O descongelamento dessa key ja foi usado!**'));
        return;
      }
      if (rec) logKey(rec.congeladaEm ? 'Key CONGELADA' : 'Key DESCONGELADA', rec);
      let msg = '⚠️ Nenhuma key ativa.';
      if (rec && rec.congeladaEm) {
        desligarUsuario(userId);
        msg = '🧊 **Key congelada.** O tempo restante foi pausado e a instância foi parada.';
      } else if (rec) {
        const u = carregarUsuarios()[userId] || {};
        if ((u.token || (abLivreCfg(u) && abLivreGuilds(userId).length)) && u.gmailToken) {
          definirLigado(userId, true);
          iniciarSelfbot(userId);
          msg = '🔥 **Key descongelada.** O tempo voltou a correr e o sistema foi ligado automaticamente.';
        } else {
          msg = '?? **Key descongelada.** O tempo voltou a correr. Configure o token e o Gmail e clique em **Ativar**.';
        }
      }
      await interacao.update(telaSistema(userId, msg));
      return;
    }
    return;
  }
}

botClient.on('interactionCreate', interacao => {
  Promise.resolve().then(() => varCtx.run({ guildId: interacao.guildId || null }, () => tratarInteracao(interacao))).catch(e => {
    const msgErr = String((e && (e.message || e)) || '');
    const statusErr = Number((e && (e.httpStatus || e.status || (e.response && e.response.status))) || 0);
    if (statusErr === 404 || /unknown interaction/i.test(msgErr)) {
      aviso(`Interação [${interacao.customId || interacao.commandName || '?'}] sem resposta (404): ${msgErr.slice(0, 120)}`);
      return;
    }
    erro(`Interação [${interacao.customId || interacao.commandName || '?'}]: ${e.message}`);
    erro(`Stack: ${String(e.stack || '').split('\n').slice(0, 4).join(' | ')}`);
    try {
      if (interacao.replied || interacao.deferred) {
        interacao.editReply(telaErro(e.message)).catch(logErro);
      } else {
        interacao.reply(opcoesResposta(telaErro(e.message), true)).catch(logErro);
      }
    } catch {}
  });
});
botClient.once('ready', () => {
  iniciarTerminal();
  sucesso(`Bot online: ${botClient.user.username} (${botClient.user.id})`);
  if (!V2_OK) aviso('discord.js sem Components V2 (precisa de >= 14.19): usando embeds com os menus abaixo. Rode: npm install discord.js@latest');
  registrarComandos().then(() => registrarPersonalizarGuilds()).catch(logErro);
  limparPaineisAdminAntigos().catch(logErro);
  E.sincronizar(botClient).catch(logErro);   // sobe os emojis novos da pasta emojis/ em segundo plano
  iniciarDropAuto();                          // drops automáticos (/enviardrop automatico)
  iniciarSalasBot();                          // sincroniza as salas de cada usuário com o bot de salas (/salasbotzeroun)
  // Liberação automática pelo servidor antigo (INVITE_LIBERADO) desativada a pedido — não libera mais ninguém sozinho.
  SbRemoto.configurar({
    // dados da conta que o Python busca (token nunca vai no pedido de iniciar)
    obterConta: uid => {
      const u = carregarUsuarios()[uid];
      return u ? { token: u.token, proxy: typeof u.proxy === 'string' ? u.proxy : null } : null;
    },
    // o que os selfbots (Python) leem do bot oficial
    snapshotOficial: () => ({
      canaisBloqueados: Array.from(CANAIS_BLOQUEADOS),
      pausadas: Object.fromEntries(contasPausadasAte),
      valorPorCanal: Object.fromEntries(valorEsperadoPorCanal)
    }),
    aviso: m => aviso(m),
    erro: m => erro(m)
  });
  SbRemoto.iniciarEspelho();
  iniciarServidorOAuth();
  iniciarAutoPay();
  iniciarPollCarrinhos();
  if (!global.__amIniciado) { global.__amIniciado = true; iniciarAutoMensagens(); }
  varrerKeys();
  setInterval(varrerKeys, 20000);
  setInterval(() => {
    try {
      const us = carregarUsuarios();
      for (const id of Object.keys(us)) {
        const u = us[id];
        if (!u || u.ligado !== true || selfbots.has(id) || contaPausada(id) || !usuarioPodeRodar(id)) continue;
        aviso(`[${id}] Estava ligada mas sem instância — religando.`);
        iniciarSelfbot(id);
      }
    } catch (e) { aviso(`Varredura de instâncias: ${e.message}`); }
  }, 120000);
  setInterval(logKeysDiario, 3600000);
  setTimeout(logKeysDiario, 20000);
  try { obterOCRWorkerDoPool().promise.catch(logErro); } catch {}
  // ATIVAÇÃO AUTOMÁTICA: todas as contas com token ligam no boot.
  // (Inatividade de 60 min continua desligando sozinha durante a execução.)
  try {
    const usuarios = carregarUsuarios();
    let religadas = 0;
    for (const id of Object.keys(usuarios)) {
      const u = usuarios[id];
      if (!u || (!u.token && !(abLivreCfg(u) && abLivreGuilds(id).length))) continue;
      if (u.ligado !== true) { u.ligado = true; religadas++; }
      iniciarSelfbot(id);
    }
    if (religadas) salvarUsuarios(usuarios);
    sucesso(`▶️ Ativação automática: ${religadas} conta(s) religada(s) no boot.`);
  } catch (e) { erro(`Ativação automática: ${e.message}`); }
  recuperarSalas().catch(e => aviso(`Recuperar salas: ${e.message}`));
});
botClient.on('messageCreate', mensagem => {
  Promise.resolve().then(async () => {
    try { abLivreDespachar(mensagem); } catch (e) { aviso(`Antiban livre: ${e.message}`); }
    if (!mensagem.author || mensagem.author.bot) return;
    const uid = String(mensagem.author.id);
    const t = String(mensagem.content || '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
    if (/^\.personalizar\s*$/i.test(t)) {
      if (!mensagem.guild || !ehMeuId(uid)) return;
      await mensagem.reply({ ...opcoesResposta(pzTela(), false), allowedMentions: { repliedUser: false } });
      return;
    }
    if (/^\.perm\s*$/i.test(t)) {
      if (!mensagem.guild || !ehMeuId(uid)) return;
      await comandoPermCargos(mensagem);
      return;
    }
    const m = t.match(/^\.(saldoall|addsaldo|remsaldoall|remsaldo|semanaladd|semanalrem|semanal)(?:\s+([\s\S]+))?$/i);
    if (!m) return;
    if (!ehMeuId(uid)) {
      logEmbed('seguranca', `🚨 .${m[1].toLowerCase()} BLOQUEADO (não é o dono)`, [['Tentou', `<@${uid}>`]], uid).catch(logErro);
      return;
    }
    const cmd = m[1].toLowerCase();
    const args = m[2] || '';
    if (cmd === 'saldoall') await apComandoSaldoAll(mensagem, uid);
    else if (cmd === 'addsaldo') await apComandoAddSaldo(mensagem, uid, args);
    else if (cmd === 'remsaldo') await apComandoRemSaldo(mensagem, uid, args);
    else if (cmd === 'remsaldoall') await apComandoRemSaldoAll(mensagem, uid, args);
    else if (cmd === 'semanaladd') await apComandoSemanalAdd(mensagem, uid, args);
    else if (cmd === 'semanalrem') await apComandoSemanalRem(mensagem, uid, args);
    else if (cmd === 'semanal') await apComandoSemanal(mensagem, uid, args);
  }).catch(e => erro(`Comando do bot: ${e.message}`));
});
botClient.on('error', e => erro(`Bot: ${e.message}`));
botClient.on('warn', e => aviso(`Bot: ${e}`));
botClient.on('guildCreate', g => { registrarPersonalizarGuilds([g]).catch(logErro); });
}
// ============================================================
// SÓ BOT_TOKEN É OBRIGATÓRIO NO .env
// ============================================================
if (!BOT_TOKEN) {
  erro('BOT_TOKEN não encontrado. No .env: BOT_TOKEN=seu_token_do_bot');
  process.exit(1);
}
if (!fs.existsSync(CREDENTIALS_PATH)) {
  aviso('credentials.json não encontrado. A conexão do Gmail não funcionará sem ele.');
}
async function conectarBot() {
  if (USANDO_DISCORD_JS_REAL) {
    const c = new Client({ intents: INTENTS_BOT, rest: { timeout: 60000 } });
    configurarBot(c);
    await c.login(BOT_TOKEN);
    return;
  }
  const forcarIntents = c => {
    try {
      const GUILDS = 1;
      if (c.options) c.options.intents = GUILDS;
      if (c.ws && c.ws.options) c.ws.options.intents = GUILDS;
      if (c.ws && c.ws.shards) {
        for (const shard of c.ws.shards.values()) {
          try { if (shard.options) shard.options.intents = GUILDS; } catch {}
        }
      }
    } catch {}
  };
  const tentativas = [
    { intents: ['GUILDS'] }, { intents: 1 }, { intents: [1] }, { intents: 32767 },
    { intents: 65535 }, { intents: 131071 }, { intents: [] }, { intents: 0 }, {}
  ];
  for (const opts of tentativas) {
    const c = new Client(opts);
    forcarIntents(c);
    configurarBot(c);
    try {
      await c.login(BOT_TOKEN);
      sucesso(`Bot conectado! (config: ${JSON.stringify(opts)})`);
      return;
    } catch (e) {
      try { c.destroy(); } catch {}
      if (!/invalid intent/i.test(e.message)) throw e;
      aviso(`Intent ${JSON.stringify(opts)} inválido, tentando próximo...`);
    }
  }
  throw new Error(
    'Nenhuma config de intent funcionou com discord.js-selfbot-v13. ' +
    'Instale o discord.js real: npm install discord.js@latest ' +
    '— o bot de comandos usa BOT_TOKEN e funciona 100% com o discord.js real. ' +
    'Os selfbots (user token) continuarão usando o selfbot-v13 automaticamente.'
  );
}

info(`📚 Bot principal: ${USANDO_DISCORD_JS_REAL ? 'discord.js REAL (v14/v13)' : 'selfbot-v13 (fallback)'}${SelfbotClient ? ' • selfbot-v13 carregado para os selfbots' : ' (sem selfbot-v13)'}`);

info('🔌 Conectando bot de comandos...');

conectarBot().catch(e => {
    console.error('Erro ao conectar bot:', e);
});