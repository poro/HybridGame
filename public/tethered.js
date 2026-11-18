// Tethered — animated cliff view.
//   live player:   /tethered.html?s=<session>&t=<token>
//   live observer: /tethered.html?s=<session>&o=<token>
//   replay:        /tethered.html?replay=<sessionId>
"use strict";

const Q = new URLSearchParams(location.search);
const MODE = Q.get("replay") ? "replay" : "live";
const W = 7, H = 12, CELL = 60, OX = 34, OY = 78;
const VB_W = OX + W * CELL + 16, VB_H = OY + H * CELL + 34;
const COLS = "ABCDEFG";
const DIRV = { N: [0, 1], NE: [1, 1], NW: [-1, 1], E: [1, 0], W: [-1, 0], S: [0, -1], SE: [1, -1], SW: [-1, -1] };
const KIND_COLOR = { human: "#f2a93b", anthropic: "#d97757", openai: "#19a07a", bot: "#8b93a1" };
const PALETTE = ["#5b8def", "#e05d8a", "#8f6be8", "#2fb5c4", "#c9a227"];
const NS = "http://www.w3.org/2000/svg";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tileName = (x, y) => `${COLS[x]}${y + 1}`;
const parseTile = (n) => ({ x: COLS.indexOf(n[0]), y: Number(n.slice(1)) - 1 });
const center = (x, y) => [OX + x * CELL + CELL / 2, OY + (H - 1 - y) * CELL + CELL / 2];
function el(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

// ---------------------------------------------------------------------------
// Model shown on screen (lags the server slightly while animations play).

const M = {
  terrain: null, // [y][x]
  players: [], // {id,name,ropeIndex,kind,label,color}
  loose: new Set(),
  anchored: new Set(),
  summit: new Set(),
  round: 0,
  rounds: 20,
  injuries: 0,
  maxInjuries: 3,
  pos: {}, // id -> {x,y} svg coords (animated)
  tween: {}, // id -> {fx,fy,tx,ty,t0,dur,ease}
  tile: {}, // id -> {x,y} grid tile
  ropeFlash: null, // {color, until}
};
let speed = 1;
let paused = false;
let snap = null; // latest live snapshot
let showThoughts = true;

const svg = $("svg");
svg.setAttribute("viewBox", `0 0 ${VB_W} ${VB_H}`);
$("stage").style.setProperty("--ar", `${VB_W} / ${VB_H}`);
// Keep the whole cliff on screen: limit width so height fits the viewport.
$("stage").style.maxWidth = `calc((100vh - 190px) * ${(VB_W / VB_H).toFixed(4)})`;
$("stage").style.margin = "0 auto";
let gTiles, gLoose, gTargets, gRope, gClimbers, gFx, skyStorm, rain;

// Body colour identifies the climber; helmet colour shows what they are (when known).
function color(p, i) {
  return PALETTE[i % PALETTE.length];
}
function helmet(p) {
  return p.kind ? KIND_COLOR[p.kind] : p.color;
}

// ---------------------------------------------------------------------------
// Static scene.

function buildScene() {
  svg.innerHTML = "";
  const defs = el("defs", {}, svg);
  defs.innerHTML = `
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7fb3e0"/><stop offset="1" stop-color="#cfe4f5"/></linearGradient>
    <linearGradient id="storm" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b2133"/><stop offset="1" stop-color="#4b556e"/></linearGradient>
    <linearGradient id="rock" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8a7b6a"/><stop offset="1" stop-color="#6e604f"/></linearGradient>
    <linearGradient id="slab" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#b8b2a8"/><stop offset="1" stop-color="#9d968b"/></linearGradient>
    <linearGradient id="ledge" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9aa86a"/><stop offset=".35" stop-color="#8a7b6a"/><stop offset="1" stop-color="#76685a"/></linearGradient>
    <radialGradient id="glow"><stop offset="0" stop-color="#fff6a8" stop-opacity=".9"/><stop offset="1" stop-color="#fff6a8" stop-opacity="0"/></radialGradient>`;
  el("rect", { x: 0, y: 0, width: VB_W, height: VB_H, fill: "url(#sky)" }, svg);
  skyStorm = el("rect", { x: 0, y: 0, width: VB_W, height: VB_H, fill: "url(#storm)", opacity: 0 }, svg);
  // distant peaks
  el("path", { d: `M0 ${OY + 40} L60 ${OY - 20} L120 ${OY + 30} L190 ${OY - 45} L260 ${OY + 20} L330 ${OY - 10} L420 ${OY + 35} L${VB_W} ${OY - 15} L${VB_W} ${OY + 80} L0 ${OY + 80}Z`, fill: "#a9c1d6", opacity: 0.7 }, svg);
  // clouds
  const clouds = el("g", { opacity: 0.85 }, svg);
  for (const [cx, cy, s] of [[90, 30, 1], [300, 22, 1.3], [470, 44, 0.9]]) {
    el("ellipse", { cx, cy, rx: 34 * s, ry: 12 * s, fill: "#fff" }, clouds);
    el("ellipse", { cx: cx + 18 * s, cy: cy - 7 * s, rx: 20 * s, ry: 11 * s, fill: "#fff" }, clouds);
  }
  gTiles = el("g", {}, svg);
  gLoose = el("g", {}, svg);
  gTargets = el("g", {}, svg);
  gRope = el("g", {}, svg);
  gClimbers = el("g", {}, svg);
  gFx = el("g", {}, svg);
  rain = el("g", { opacity: 0 }, svg);
  for (let i = 0; i < 70; i++) {
    const x = Math.random() * VB_W, y = Math.random() * VB_H;
    el("line", { x1: x, y1: y, x2: x - 6, y2: y + 16, stroke: "#dfe8ff", "stroke-width": 1.2, opacity: 0.6, class: "drop" }, rain);
  }
  drawTiles();
}

function drawTiles() {
  gTiles.innerHTML = "";
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const t = M.terrain[y][x];
      const [cx, cy] = center(x, y);
      const x0 = cx - CELL / 2, y0 = cy - CELL / 2;
      const g = el("g", {}, gTiles);
      if (t === "summit") {
        el("rect", { x: x0, y: y0, width: CELL, height: CELL, fill: "#eef3f7" }, g);
        el("path", { d: `M${x0} ${y0 + CELL} Q${cx} ${y0 + 18} ${x0 + CELL} ${y0 + CELL}Z`, fill: "#dfe8ef" }, g);
      } else if (t === "ground") {
        el("rect", { x: x0, y: y0, width: CELL, height: CELL, fill: "#7fa257" }, g);
        el("rect", { x: x0, y: y0, width: CELL, height: 8, fill: "#93b86a" }, g);
        for (let i = 0; i < 3; i++) el("path", { d: `M${x0 + 10 + i * 18} ${y0 + 14} l3 -7 l3 7`, stroke: "#5f7f3e", fill: "none", "stroke-width": 1.5 }, g);
      } else if (t === "slab") {
        el("rect", { x: x0, y: y0, width: CELL, height: CELL, fill: "url(#slab)" }, g);
        el("path", { d: `M${x0 + 8} ${y0 + CELL - 10} L${x0 + CELL - 12} ${y0 + 8}`, stroke: "#d2cdc4", "stroke-width": 3, opacity: 0.6 }, g);
      } else if (t === "ledge") {
        el("rect", { x: x0, y: y0, width: CELL, height: CELL, fill: "url(#ledge)" }, g);
        el("rect", { x: x0 - 1, y: y0 + CELL * 0.55, width: CELL + 2, height: 9, rx: 3, fill: "#5d5245" }, g);
        el("rect", { x: x0 - 1, y: y0 + CELL * 0.55 - 5, width: CELL + 2, height: 6, rx: 3, fill: "#a7b77a" }, g);
      } else {
        el("rect", { x: x0, y: y0, width: CELL, height: CELL, fill: "url(#rock)" }, g);
        el("ellipse", { cx: cx - 8, cy: cy + 4, rx: 9, ry: 5, fill: "#4e4336" }, g);
        el("ellipse", { cx: cx + 10, cy: cy - 10, rx: 6, ry: 4, fill: "#4e4336" }, g);
      }
      el("rect", { x: x0, y: y0, width: CELL, height: CELL, fill: "none", stroke: "rgba(0,0,0,.12)" }, g);
    }
  // summit flag
  const [fx, fy] = center(3, H - 1);
  el("line", { x1: fx, y1: fy + 18, x2: fx, y2: fy - 26, stroke: "#333", "stroke-width": 2 }, gTiles);
  el("path", { d: `M${fx} ${fy - 26} l20 6 l-20 6z`, fill: "#d64541", class: "flag" }, gTiles);
  // axis labels
  for (let x = 0; x < W; x++) {
    const [cx] = center(x, 0);
    el("text", { x: cx, y: OY + H * CELL + 22, "text-anchor": "middle", "font-size": 13, fill: "#2b3340", "font-weight": 600 }, gTiles).textContent = COLS[x];
  }
  for (let y = 0; y < H; y++) {
    const [, cy] = center(0, y);
    el("text", { x: OX - 10, y: cy + 4, "text-anchor": "middle", "font-size": 12, fill: "#2b3340" }, gTiles).textContent = y + 1;
  }
}

function drawLoose() {
  gLoose.innerHTML = "";
  for (const n of M.loose) {
    const { x, y } = parseTile(n);
    const [cx, cy] = center(x, y);
    const g = el("g", { opacity: 0.95 }, gLoose);
    el("path", { d: `M${cx - 12} ${cy - 14} l6 9 l-4 6 l8 10 M${cx + 6} ${cy - 16} l-3 10 l7 5`, stroke: "#2a1e14", "stroke-width": 2, fill: "none" }, g);
    el("circle", { cx: cx + 17, cy: cy - 17, r: 8, fill: "#c0392b" }, g);
    el("text", { x: cx + 17, y: cy - 13, "text-anchor": "middle", "font-size": 12, "font-weight": 800, fill: "#fff" }, g).textContent = "!";
  }
}

// ---------------------------------------------------------------------------
// Climbers + rope (redrawn every animation frame).

const climberEls = {};
function buildClimbers() {
  gClimbers.innerHTML = "";
  M.players.forEach((p, i) => {
    const g = el("g", {}, gClimbers);
    const c = p.color;
    el("circle", { r: 21, fill: "none", stroke: "#fff", "stroke-width": 3, "stroke-dasharray": "5 4", class: "anchorRing", opacity: 0 }, g);
    el("rect", { x: -9, y: -2, width: 18, height: 20, rx: 6, fill: c, stroke: "#222", "stroke-width": 1.2 }, g); // body
    el("rect", { x: -9, y: 7, width: 18, height: 4, fill: "#222", opacity: 0.6 }, g); // harness
    el("circle", { cx: 0, cy: -10, r: 10, fill: "#f3d6b3", stroke: "#222", "stroke-width": 1.2 }, g); // head
    el("path", { d: "M-11 -11 A11 11 0 0 1 11 -11 L11 -9 L-11 -9Z", fill: helmet(p), stroke: "#222", "stroke-width": 1.2 }, g); // helmet
    el("text", { y: -12, "text-anchor": "middle", "font-size": 9, "font-weight": 800, fill: "#fff" }, g).textContent = p.name[0];
    const label = el("text", { y: 32, "text-anchor": "middle", "font-size": 11, "font-weight": 700, fill: "#fff", stroke: "#000", "stroke-width": 3, "paint-order": "stroke" }, g);
    label.textContent = p.name;
    const anc = el("text", { x: 14, y: 2, "font-size": 14, opacity: 0 }, g);
    anc.textContent = "⚓";
    climberEls[p.id] = { g, ring: g.querySelector(".anchorRing"), anc, label };
  });
}

function offsetFor(id) {
  // Spread climbers sharing a tile.
  const t = M.tile[id];
  const same = M.players.filter((p) => M.tile[p.id] && M.tile[p.id].x === t.x && M.tile[p.id].y === t.y);
  if (same.length < 2) return [0, 0];
  const k = same.findIndex((p) => p.id === id);
  return [(k - (same.length - 1) / 2) * 20, 0];
}

function placeInstant(id, tile) {
  M.tile[id] = tile;
  for (const p of M.players) if (M.tile[p.id]) {
    const [cx, cy] = center(M.tile[p.id].x, M.tile[p.id].y);
    const [ox, oy] = offsetFor(p.id);
    M.pos[p.id] = { x: cx + ox, y: cy + oy };
    delete M.tween[p.id];
  }
}

function moveTo(id, tile, dur, ease = "inout") {
  M.tile[id] = tile;
  const [cx, cy] = center(tile.x, tile.y);
  const [ox, oy] = offsetFor(id);
  const from = M.pos[id] ?? { x: cx, y: cy };
  M.tween[id] = { fx: from.x, fy: from.y, tx: cx + ox, ty: cy + oy, t0: performance.now(), dur: dur / speed, ease };
}

const EASE = {
  inout: (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
  fall: (t) => t * t,
  bounce: (t) => { const n = 7.5625, d = 2.75; if (t < 1 / d) return n * t * t; if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75; if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375; return n * (t -= 2.625 / d) * t + 0.984375; },
};

function frame(now) {
  for (const [id, tw] of Object.entries(M.tween)) {
    const t = Math.min(1, (now - tw.t0) / tw.dur);
    const e = EASE[tw.ease](t);
    M.pos[id] = { x: tw.fx + (tw.tx - tw.fx) * e, y: tw.fy + (tw.ty - tw.fy) * e };
    if (t >= 1) delete M.tween[id];
  }
  for (const p of M.players) {
    const pos = M.pos[p.id];
    const e = climberEls[p.id];
    if (!pos || !e) continue;
    const bob = M.summit.has(p.id) ? Math.sin(now / 300 + p.ropeIndex) * 2 : 0;
    e.g.setAttribute("transform", `translate(${pos.x.toFixed(1)} ${(pos.y + bob).toFixed(1)})`);
    // Stagger name labels when climbers share a tile so they stay readable.
    const t = M.tile[p.id];
    const k = M.players.filter((q) => M.tile[q.id] && M.tile[q.id].x === t.x && M.tile[q.id].y === t.y).findIndex((q) => q.id === p.id);
    e.label.setAttribute("y", 32 + (k > 0 ? 13 * k : 0));
    const a = M.anchored.has(p.id);
    e.ring.setAttribute("opacity", a ? 0.9 : 0);
    e.anc.setAttribute("opacity", a ? 1 : 0);
  }
  if (gRope) drawRope(now);
  positionBubbles();
  requestAnimationFrame(frame);
}

function drawRope(now) {
  gRope.innerHTML = "";
  const order = [...M.players].sort((a, b) => a.ropeIndex - b.ropeIndex).filter((p) => M.pos[p.id]);
  const flash = M.ropeFlash && M.ropeFlash.until > now ? M.ropeFlash.color : null;
  for (let i = 0; i + 1 < order.length; i++) {
    const a = M.pos[order[i].id], b = M.pos[order[i + 1].id];
    const ta = M.tile[order[i].id], tb = M.tile[order[i + 1].id];
    const used = Math.max(Math.abs(ta.x - tb.x), Math.abs(ta.y - tb.y)); // 0..2+
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const sag = Math.max(0, (2.6 - used) * 16) + (len < 10 ? 12 : 0);
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2 + sag;
    const taut = used >= 2;
    const d = `M${a.x} ${a.y + 8} Q${mx} ${my + 8} ${b.x} ${b.y + 8}`;
    el("path", { d, stroke: "#3b2a14", "stroke-width": 5, fill: "none", "stroke-linecap": "round", opacity: 0.5 }, gRope);
    el("path", { d, stroke: flash ?? (taut ? "#e8b04a" : "#f1d38a"), "stroke-width": 3, fill: "none", "stroke-linecap": "round", "stroke-dasharray": taut ? "none" : "7 3" }, gRope);
  }
}

// ---------------------------------------------------------------------------
// Bubbles + effects.

const bubbles = {}; // id -> [{el, kind}]
function positionBubbles() {
  for (const [id, list] of Object.entries(bubbles)) {
    const p = M.pos[id];
    if (!p) continue;
    for (const b of list) {
      b.el.style.left = `${(p.x / VB_W) * 100}%`;
      b.el.style.top = `${(p.y / VB_H) * 100}%`;
    }
  }
}

function bubble(id, html, ms, kind = "say") {
  const div = document.createElement("div");
  div.className = `bubble ${kind === "say" ? "" : kind}`;
  div.innerHTML = html;
  $("bubbles").appendChild(div);
  // one bubble of each kind per climber
  bubbles[id] = (bubbles[id] ?? []).filter((b) => (b.kind === kind ? (b.el.remove(), false) : true));
  bubbles[id].push({ el: div, kind });
  positionBubbles();
  if (ms) setTimeout(() => clearBubble(id, div), ms / speed);
  return div;
}
function clearBubble(id, div) {
  div.classList.add("fade");
  setTimeout(() => {
    div.remove();
    if (bubbles[id]) bubbles[id] = bubbles[id].filter((b) => b.el !== div);
  }, 400);
}
function clearSayBubbles() {
  for (const [id, list] of Object.entries(bubbles)) for (const b of list) if (b.kind === "say") clearBubble(id, b.el);
}
function shortText(text, name = "", max = 90) {
  let t = String(text).trim();
  // Drop a leading "Name:" / "Name here." — the bubble already shows who is talking.
  if (name) t = t.replace(new RegExp(`^${name}( here)?\\s*[:.,!-]\\s*`, "i"), "");
  const sentences = t.split(/(?<=[.!?])\s+/).filter(Boolean);
  // Skip greetings and short openers so the bubble carries the actual point.
  let s = sentences.shift() ?? "";
  while (s.length < 30 && sentences.length) s = /^(hi|hey|ok|okay|copy|thanks|nice|great|good)\b/i.test(s) ? sentences.shift() : `${s} ${sentences.shift()}`;
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  return cut.slice(0, Math.max(cut.lastIndexOf(" "), 40)).replace(/[,;:\s]+$/, "") + "…";
}
function clearThinking() {
  for (const [id, list] of Object.entries(bubbles)) for (const b of list) if (b.kind === "thinking") clearBubble(id, b.el);
}

function floatText(x, y, text, fill) {
  const t = el("text", { x, y, "text-anchor": "middle", "font-size": 15, "font-weight": 800, fill, stroke: "#000", "stroke-width": 3, "paint-order": "stroke" }, gFx);
  t.textContent = text;
  const t0 = performance.now();
  (function rise(now) {
    const k = (now - t0) / (1400 / speed);
    t.setAttribute("y", y - k * 30);
    t.setAttribute("opacity", Math.max(0, 1 - k));
    if (k < 1) requestAnimationFrame(rise);
    else t.remove();
  })(t0);
}

function debris(tile) {
  const [cx, cy] = center(tile.x, tile.y);
  for (let i = 0; i < 9; i++) {
    const r = el("circle", { cx: cx + (Math.random() - 0.5) * 30, cy, r: 2 + Math.random() * 4, fill: "#5a4b3b" }, gFx);
    const vx = (Math.random() - 0.5) * 60, t0 = performance.now();
    (function drop(now) {
      const k = (now - t0) / (1100 / speed);
      r.setAttribute("transform", `translate(${vx * k} ${260 * k * k})`);
      r.setAttribute("opacity", Math.max(0, 1 - k));
      if (k < 1) requestAnimationFrame(drop);
      else r.remove();
    })(t0);
  }
}

function burst(tile) {
  const [cx, cy] = center(tile.x, tile.y);
  const g = el("circle", { cx, cy, r: 10, fill: "url(#glow)" }, gFx);
  const t0 = performance.now();
  (function grow(now) {
    const k = (now - t0) / (1200 / speed);
    g.setAttribute("r", 10 + k * 50);
    g.setAttribute("opacity", Math.max(0, 1 - k));
    if (k < 1) requestAnimationFrame(grow);
    else g.remove();
  })(t0);
}

// ---------------------------------------------------------------------------
// HUD + transcript.

function nameOf(id) {
  return M.players.find((p) => p.id === id)?.name ?? id;
}
function playerById(id) {
  return M.players.find((p) => p.id === id);
}

function renderHud() {
  $("roundChip").textContent = `Round ${Math.max(1, M.round)} / ${M.rounds}`;
  $("hearts").textContent = "❤️".repeat(Math.max(0, M.maxInjuries - M.injuries)) + "🖤".repeat(Math.min(M.maxInjuries, M.injuries));
  const storm = Math.min(1, (M.round - 1) / Math.max(1, M.rounds - 1));
  $("stormBar").style.width = `${storm * 100}%`;
  skyStorm.setAttribute("opacity", (storm * 0.75).toFixed(2));
  rain.setAttribute("opacity", storm > 0.6 ? ((storm - 0.6) * 2).toFixed(2) : 0);
}

function renderTeam() {
  $("team").innerHTML = [...M.players]
    .sort((a, b) => a.ropeIndex - b.ropeIndex)
    .map((p) => {
      const tile = M.tile[p.id];
      return `<div><span class="dot" style="background:${p.color}; box-shadow: inset 0 4px 0 ${helmet(p)}"></span><b>${esc(p.name)}</b> #${p.ropeIndex + 1}${p.id === snap?.you ? " (you)" : ""}
        ${p.label ? `<span class="muted">· ${esc(p.kind === "human" ? "human" : p.label)}</span>` : ""}
        <span class="muted">· ${tile ? tileName(tile.x, tile.y) : ""}${M.summit.has(p.id) ? " · 🏁 summit" : ""}</span></div>`;
    })
    .join("");
}

let trRound = 0;
function trAppend(html) {
  const t = $("transcript");
  const atBottom = t.scrollHeight - t.scrollTop - t.clientHeight < 60;
  t.insertAdjacentHTML("beforeend", html);
  if (atBottom) t.scrollTop = t.scrollHeight;
}
function trRoundHeader(r) {
  if (r > trRound) {
    trRound = r;
    trAppend(`<div class="tr-round">Round ${r}</div>`);
  }
}

// ---------------------------------------------------------------------------
// Steps: the same player drives live games and replays.
//   {type:"chat", round, playerId, text, note}
//   {type:"round", round, frames, actions, narrative, injuries, notes:[{playerId,note}]}
//   {type:"end", outcome}

const queue = [];
let wake = null;
function push(step) {
  queue.push(step);
  if (wake) wake();
}

async function runQueue() {
  for (;;) {
    while (paused) await sleep(100);
    if (!queue.length) {
      if (MODE === "live") showThinking();
      await new Promise((r) => (wake = r));
      wake = null;
      continue;
    }
    clearThinking();
    // Live games with bots can outrun the animation; speed up when behind.
    if (MODE === "live") speed = queue.length > 8 ? 4 : queue.length > 3 ? 2 : 1;
    await play(queue.shift());
  }
}

async function play(step) {
  if (step.type === "chat") {
    M.round = Math.max(M.round, step.round);
    renderHud();
    trRoundHeader(step.round);
    const p = playerById(step.playerId);
    trAppend(`<div class="tr-msg"><span class="dot" style="background:${p?.color}"></span><b>${esc(nameOf(step.playerId))}</b>: ${esc(step.text)}</div>` +
      (step.note && showThoughts ? `<div class="tr-note">💭 ${esc(step.note)}</div>` : ""));
    // On the cliff: one short bubble at a time (first sentence, trimmed). The full message and
    // the AI's thoughts stay in the radio log, which keeps the scene readable.
    const short = shortText(step.text, nameOf(step.playerId));
    const ms = Math.min(4500, 1600 + short.length * 40);
    clearSayBubbles();
    bubble(step.playerId, `<b>${esc(nameOf(step.playerId))}</b>${esc(short)}`, ms);
    await sleep((ms * 0.6) / speed);
  } else if (step.type === "round") {
    await playRound(step);
  } else if (step.type === "end") {
    const o = step.outcome;
    const fresh = !$("banner").innerHTML;
    $("banner").innerHTML = `<div class="banner ${o.won ? "win" : "lose"}">${o.won ? "🏔️ Summit! " : ""}${esc(o.reason)}</div>`;
    if (o.won && fresh) for (const p of M.players) floatText(M.pos[p.id].x, M.pos[p.id].y - 30, "🎉", "#fff");
    if (step.reveal) {
      for (const r of step.reveal) {
        const p = playerById(r.id);
        if (p) Object.assign(p, { kind: r.kind, label: r.label, color: color(r, M.players.indexOf(p)) });
      }
      buildClimbers();
      renderTeam();
    }
    if (step.loose) {
      M.loose = new Set(step.loose);
      drawLoose();
    }
  }
}

async function playRound(step) {
  M.round = step.round;
  renderHud();
  trRoundHeader(step.round);
  const [moves, settle] = step.frames;
  // Show intent: anchors light up, then everybody moves at once.
  M.anchored = new Set(moves.anchored);
  if (step.notes && showThoughts) {
    for (const n of step.notes) trAppend(`<div class="tr-note">💭 ${esc(nameOf(n.playerId))} (move): ${esc(n.note)}</div>`);
  }
  await sleep(350 / speed);
  for (const c of moves.climbers) {
    const cur = M.tile[c.id];
    if (!cur || cur.x !== c.x || cur.y !== c.y) moveTo(c.id, { x: c.x, y: c.y }, 700);
  }
  for (const e of moves.effects) {
    const p = M.pos[e.climber];
    if (e.kind === "taut" && p) {
      floatText(p.x, p.y - 34, "rope taut!", "#ffd166");
      M.ropeFlash = { color: "#ff6b4a", until: performance.now() + 700 / speed };
    }
    if (e.kind === "invalid" && p) floatText(p.x, p.y - 34, "can't go there", "#ddd");
  }
  await sleep(800 / speed);

  for (const e of settle.effects) {
    if (e.kind === "crumble") {
      const t = parseTile(e.to);
      debris(t);
      M.loose.delete(e.to);
      drawLoose();
      const p = M.pos[e.climber];
      if (p) floatText(p.x, p.y - 34, "loose rock!", "#ff8a65");
    }
  }
  if (settle.effects.some((e) => e.kind === "crumble")) await sleep(450 / speed);
  for (const e of settle.effects) {
    const t = e.to ? parseTile(e.to) : null;
    if (e.kind === "caught") {
      moveTo(e.climber, t, 450, "bounce");
      M.ropeFlash = { color: "#6be08a", until: performance.now() + 900 / speed };
      const [x, y] = center(t.x, t.y);
      floatText(x, y - 36, `caught by ${nameOf(e.by)}!`, "#8ef0a5");
    } else if (e.kind === "fall") {
      moveTo(e.climber, t, 650, "bounce");
      M.ropeFlash = { color: "#ff4a4a", until: performance.now() + 1100 / speed };
      const [x, y] = center(t.x, t.y);
      floatText(x, y - 36, "FELL! -1 ❤️", "#ff6b6b");
      $("stage").animate([{ transform: "translateX(0)" }, { transform: "translateX(-6px)" }, { transform: "translateX(6px)" }, { transform: "translateX(0)" }], { duration: 300 });
    } else if (e.kind === "dragged") {
      moveTo(e.climber, t, 600, "fall");
      const [x, y] = center(t.x, t.y);
      floatText(x, y - 36, "dragged down", "#ffb199");
    } else if (e.kind === "summit") {
      M.summit.add(e.climber);
      burst(t);
      const [x, y] = center(t.x, t.y);
      floatText(x, y - 40, "SUMMIT!", "#fff27a");
    }
  }
  for (const c of settle.climbers) if (!M.tween[c.id]) placeInstant(c.id, { x: c.x, y: c.y });
  if (settle.loose) {
    M.loose = new Set(settle.loose);
    drawLoose();
  }
  M.injuries = step.injuries;
  renderHud();
  renderTeam();
  if (step.narrative.length) trAppend(`<div class="tr-narr">${step.narrative.map(esc).join(" ")}</div>`);
  await sleep((settle.effects.length ? 1100 : 500) / speed);
  M.anchored = new Set([...M.summit]);
}

// ---------------------------------------------------------------------------
// Setup helpers.

function initPlayers(players) {
  M.players = players.map((p, i) => ({ ...p, color: color(p, i) }));
  const n = players.length;
  const start = Math.floor((W - n) / 2);
  for (const p of M.players) placeInstant(p.id, { x: start + p.ropeIndex, y: 0 });
  buildClimbers();
  renderTeam();
}

// ---------------------------------------------------------------------------
// REPLAY mode.

async function startReplay(id) {
  const events = await fetch(`/api/replay/${encodeURIComponent(id)}`).then((r) => r.json());
  if (!Array.isArray(events)) {
    $("phase").textContent = events.error ?? "Could not load replay";
    return;
  }
  const start = events.find((e) => e.type === "session_start");
  $("replayControls").style.display = "";
  $("title").textContent = "Tethered · replay";
  $("phase").textContent = `${start.players.map((p) => `${p.name} (${p.seat.kind === "human" ? "human" : p.seat.label})`).join(" — ")}${start.condition ? ` · ${start.condition}` : ""}`;
  const build = () => {
    M.terrain = start.terrain;
    M.rounds = start.config.rounds;
    M.maxInjuries = start.config.maxInjuries;
    M.round = 0;
    M.injuries = 0;
    M.summit = new Set();
    M.anchored = new Set();
    M.loose = new Set(start.loose.flatMap((row, y) => row.flatMap((l, x) => (l ? [tileName(x, y)] : []))));
    buildScene();
    drawLoose();
    initPlayers(start.players.map((p) => ({ id: p.id, name: p.name, ropeIndex: p.ropeIndex, kind: p.seat.kind, label: p.seat.label })));
    renderHud();
    $("transcript").innerHTML = "";
    $("banner").innerHTML = "";
    trRound = 0;
    queue.length = 0;
    const notesByRound = {};
    for (const e of events) if (e.type === "action" && e.note) (notesByRound[e.round] ??= []).push({ playerId: e.playerId, note: e.note });
    for (const e of events) {
      if (e.type === "chat" && e.text) push({ type: "chat", round: e.round, playerId: e.playerId, text: e.text, note: e.note });
      if (e.type === "round_resolved") push({ type: "round", ...e.result, injuries: e.injuries, notes: notesByRound[e.result.round] });
      if (e.type === "game_over") push({ type: "end", outcome: e.outcome });
    }
    const summary = events.find((e) => e.type === "summary")?.summary;
    if (summary) renderSummary(summary, Object.fromEntries(events.filter((e) => e.type === "survey").map((e) => [e.playerId, e.reply])));
  };
  build();
  $("playPause").onclick = () => {
    paused = !paused;
    $("playPause").textContent = paused ? "Play" : "Pause";
  };
  $("restart").onclick = () => {
    for (const k of Object.keys(bubbles)) for (const b of bubbles[k]) b.el.remove();
    for (const k of Object.keys(bubbles)) delete bubbles[k];
    build();
  };
  $("speed").onchange = (e) => (speed = Number(e.target.value));
  $("showThoughts").onchange = (e) => (showThoughts = e.target.checked);
  runQueue();
}

function renderSummary(s, surveys) {
  const side = $("side");
  side.style.display = "";
  side.innerHTML = `<h2>Cooperation summary</h2>
    <table><thead><tr><th>Climber</th><th>Support anchors</th><th>Warned</th><th>Caught</th><th>Falls</th><th>Rope taut</th><th>Trust</th></tr></thead><tbody>
    ${s.players.map((p) => `<tr><td>${esc(p.name)}<div class="muted small">${esc(p.kind === "human" ? "human" : p.label)}</div></td>
      <td>${p.supportAnchors}</td><td>${p.holdsFelt ? `${p.holdsWarned}/${p.holdsFelt}` : "—"}</td><td>${p.catches}</td><td>${p.falls}</td><td>${p.ropeBlocked}</td>
      <td>${p.trustReceivedAvg === null ? "—" : p.trustReceivedAvg.toFixed(1)}</td></tr>`).join("")}
    </tbody></table>
    <p class="small muted">Support anchors: anchored while a rope neighbour climbed. Warned: loose holds they called out out of those they could see. Caught: falls they stopped.</p>
    ${Object.entries(surveys ?? {}).map(([pid, r]) => (r?.reflection ? `<p class="small"><b>${esc(s.players.find((p) => p.playerId === pid)?.name)}:</b> ${esc(r.reflection)}</p>` : "")).join("")}`;
}

// ---------------------------------------------------------------------------
// LIVE mode.

let ws;
let queuedChats = 0, queuedRounds = 0, ended = false, initialized = false, revealed = false;

function connect() {
  const S = Q.get("s"), T = Q.get("t"), O = Q.get("o");
  ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws?s=${encodeURIComponent(S)}&${T ? `t=${encodeURIComponent(T)}` : `o=${encodeURIComponent(O)}`}`);
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.type === "snapshot") onSnapshot(m.data);
  };
  ws.onclose = (e) => {
    $("phase").textContent = e.reason ? `Disconnected: ${e.reason}` : "Disconnected — reconnecting…";
    if (!e.reason) setTimeout(connect, 1500);
  };
}

function onSnapshot(s) {
  snap = s;
  if (!initialized) {
    initialized = true;
    M.terrain = s.terrain;
    M.rounds = s.config.rounds;
    M.maxInjuries = s.config.maxInjuries;
    buildScene();
    initPlayers(s.players);
    $("rules").textContent = s.rules + (s.identityBrief ? `\n\n${s.identityBrief}` : "");
    showThoughts = s.observer;
    M.round = s.round;
    renderHud();
    // Joining a game in progress: jump to the current state instead of replaying everything.
    if (s.history.length > 2) {
      const last = s.history[s.history.length - 1];
      for (const c of last.frames[1].climbers) placeInstant(c.id, { x: c.x, y: c.y });
      for (const c of s.climbers) if (c.onSummit) M.summit.add(c.id);
      M.round = s.round;
      M.injuries = s.injuries;
      queuedRounds = s.history.length;
      queuedChats = s.chat.length;
      trAppend(`<div class="muted small">Joined at round ${s.round}.</div>`);
    }
  }
  // Players see what they can spot right now; observers see everything.
  if (s.observer || !s.outcome) {
    M.loose = new Set(s.loose);
    drawLoose();
  }
  // Identity labels can appear later (at the end of a blind game).
  for (const p of s.players) {
    const mp = playerById(p.id);
    if (mp && p.kind && !mp.kind) Object.assign(mp, { kind: p.kind, label: p.label, color: color(p, M.players.indexOf(mp)) }) && buildClimbers();
  }
  // New chat + round results, in game order.
  const items = [];
  for (; queuedChats < s.chat.length; queuedChats++) {
    const m = s.chat[queuedChats];
    const note = s.notes?.find((n) => n.playerId === m.from && n.round === m.round && n.phase === "talk")?.note;
    items.push({ key: m.round * 10, step: { type: "chat", round: m.round, playerId: m.from, text: m.text, note } });
  }
  for (; queuedRounds < s.history.length; queuedRounds++) {
    const h = s.history[queuedRounds];
    const notes = (s.notes ?? []).filter((n) => n.round === h.round && n.phase === "act").map((n) => ({ playerId: n.playerId, note: n.note }));
    items.push({ key: h.round * 10 + 5, step: { type: "round", ...h, injuries: injuriesAfter(s, queuedRounds), notes } });
  }
  if (s.outcome && !ended) {
    ended = true;
    items.push({ key: 1e9, step: { type: "end", outcome: s.outcome, loose: s.loose } });
  }
  items.sort((a, b) => a.key - b.key).forEach((i) => push(i.step));
  if (s.phase.name === "finished" && !revealed && s.players.some((p) => p.kind)) {
    revealed = true;
    push({ type: "end", outcome: s.outcome, reveal: s.players, loose: s.loose });
  }
  renderLiveUi();
  if (s.observer && s.summary) renderSummary(s.summary, s.surveys);
}

function injuriesAfter(s, idx) {
  let n = 0;
  for (let i = 0; i <= idx; i++) for (const e of s.history[i].frames[1].effects) if (e.kind === "fall") n++;
  return n;
}

let thinkingShown = "";
function showThinking() {
  if (!snap || ["finished", "lobby", "survey"].includes(snap.phase.name)) return;
  const key = `${snap.phase.name}:${snap.phase.round}:${snap.phase.waitingOn.join(",")}`;
  if (key === thinkingShown) return;
  thinkingShown = key;
  clearThinking();
  for (const id of snap.phase.waitingOn) if (id !== snap.you) bubble(id, "• • •", 0, "thinking");
}

function phaseText(s) {
  const ph = s.phase;
  const waiting = ph.waitingOn.map(nameOf).join(", ");
  switch (ph.name) {
    case "lobby": return "Waiting for all players to join…";
    case "talk": return `Round ${ph.round} · talking · ${ph.waitingOn.includes(s.you) ? "your turn to talk" : `${waiting} is talking`}`;
    case "act": return `Round ${ph.round} · choosing moves · waiting on ${waiting || "—"}`;
    case "survey": return `Game over · debrief${waiting ? ` · waiting on ${waiting}` : ""}`;
    case "finished": return "Game over";
  }
}

let composeKey = null;
function renderLiveUi() {
  const s = snap;
  $("phase").textContent = phaseText(s);
  if (s.observer) {
    const side = $("side");
    if (!s.summary) {
      side.style.display = "";
      side.innerHTML = `<h2>Observer</h2><div class="small">Model calls: ${s.usage.calls} · tokens: ${s.usage.tokens.toLocaleString()} · timeouts/errors: ${s.events.length}</div>
        ${s.joinLinks.length ? `<div class="small" style="margin-top:6px">Join links: ${s.joinLinks.map((j) => `<a href="/tethered.html?s=${s.sessionId}&t=${j.token}" target="_blank">${esc(j.name)}</a>`).join(" · ")}</div>` : ""}
        ${s.phase.name === "lobby" ? `<button class="primary" id="forceStart" style="margin-top:8px">Start now</button>` : ""}
        ${s.events.slice(-5).map((e) => `<div class="small muted">${esc(e.type)} · ${esc(nameOf(e.playerId))} · ${esc(e.detail)}</div>`).join("")}`;
      const b = $("forceStart");
      if (b) b.onclick = () => ws.send(JSON.stringify({ type: "start" }));
    }
    return;
  }
  // Player panel.
  const me = s.climbers.find((c) => c.id === s.you);
  const you = $("you");
  you.style.display = "";
  you.innerHTML = `<b>You are ${esc(me.name)}</b>, climber #${me.ropeIndex + 1} on the rope, at ${tileName(me.x, me.y)}.
    <div class="small muted" style="margin-top:4px">${esc(s.identityBrief)}</div>
    <div class="small" style="margin-top:4px">Loose holds you can see (2 tiles away): <b>${s.loose.length ? s.loose.join(", ") : "none"}</b>. You can't judge the holds right next to you — listen to your team.</div>`;
  renderCompose();
}

function renderCompose() {
  const s = snap;
  const box = $("compose");
  const p = s.pending;
  const key = p ? `${p.kind}:${s.round}:${p.round}` : `none:${s.phase.name}:${s.surveyDone}`;
  if (key === composeKey) return;
  composeKey = key;
  clearTargets();
  if (!p) {
    box.style.display = s.phase.name === "lobby" ? "none" : "";
    box.innerHTML = `<span class="muted small">${s.surveyDone ? "Thanks — your debrief is recorded." : "Waiting for teammates…"}</span>`;
    return;
  }
  box.style.display = "";
  if (p.kind === "discuss") {
    box.innerHTML = `<div class="small" style="margin-bottom:6px"><b>Your turn to talk.</b> Warn about loose holds, plan who climbs and who anchors.</div>
      <textarea id="msg" maxlength="400" placeholder="e.g. Birch, D6 above you is loose — go NE. I'll anchor."></textarea>
      <div class="row" style="margin-top:6px"><button class="primary" id="send">Send</button><button id="skip">Stay quiet</button></div>`;
    $("msg").focus();
    $("msg").onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("send").click(); } };
    $("send").onclick = () => submit("discuss", { message: $("msg").value });
    $("skip").onclick = () => submit("discuss", { message: "" });
  } else if (p.kind === "act") {
    const me = s.climbers.find((c) => c.id === s.you);
    box.innerHTML = `<div class="small" style="margin-bottom:6px"><b>Choose your move.</b> Click a highlighted hold to climb there, or:</div>
      <div class="row"><button class="primary" id="anchor">⚓ Anchor</button><button id="wait">Wait</button></div>
      <div class="small muted" style="margin-top:6px">Orange = the rope is too short unless a neighbour moves your way.</div>`;
    $("anchor").onclick = () => submit("act", { action: { type: "anchor", dir: null } });
    $("wait").onclick = () => submit("act", { action: { type: "wait", dir: null } });
    if (!me.onSummit) drawTargets(me);
  } else if (p.kind === "survey") {
    const mates = s.players.filter((x) => x.id !== s.you);
    box.innerHTML = `<div class="small" style="margin-bottom:8px"><b>Debrief.</b> How much did you trust each teammate, and were they human or AI?</div>
      ${mates.map((t) => `<div class="survey-row small"><b>${esc(t.name)}</b>
        <label>Trust <select data-trust="${t.id}">${[1, 2, 3, 4, 5, 6, 7].map((n) => `<option ${n === 4 ? "selected" : ""}>${n}</option>`).join("")}</select></label>
        <select data-guess="${t.id}"><option value="unsure">unsure</option><option value="human">human</option><option value="ai">AI</option></select></div>`).join("")}
      <textarea id="reflect" placeholder="How did the rope team work together?"></textarea>
      <button class="primary" id="sv" style="margin-top:6px">Submit debrief</button>`;
    $("sv").onclick = () => submit("survey", {
      ratings: mates.map((t) => ({ playerId: t.id, trust: Number(document.querySelector(`[data-trust="${t.id}"]`).value), guess: document.querySelector(`[data-guess="${t.id}"]`).value })),
      reflection: $("reflect").value,
    });
  }
}

function submit(kind, payload) {
  ws.send(JSON.stringify({ type: "submit", kind, payload }));
  clearTargets();
}

function clearTargets() {
  gTargets && (gTargets.innerHTML = "");
}

function drawTargets(me) {
  clearTargets();
  const nbs = snap.climbers.filter((c) => Math.abs(c.ropeIndex - me.ropeIndex) === 1);
  for (const [dir, [dx, dy]] of Object.entries(DIRV)) {
    const x = me.x + dx, y = me.y + dy;
    if (x < 0 || y < 0 || x >= W || y >= H || M.terrain[y][x] === "slab") continue;
    const dist = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
    const ropeOk = nbs.every((n) => dist({ x, y }, n) <= 2 || dist({ x, y }, n) <= dist(me, n));
    const [cx, cy] = center(x, y);
    const g = el("g", { class: "tile-target" }, gTargets);
    el("rect", { x: cx - CELL / 2 + 3, y: cy - CELL / 2 + 3, width: CELL - 6, height: CELL - 6, rx: 8, fill: ropeOk ? "rgba(120,220,140,.28)" : "rgba(255,170,60,.28)", stroke: ropeOk ? "#7be08f" : "#ffad42", "stroke-width": 2.5 }, g);
    el("text", { x: cx, y: cy + 5, "text-anchor": "middle", "font-size": 13, "font-weight": 800, fill: "#fff", stroke: "#000", "stroke-width": 3, "paint-order": "stroke" }, g).textContent = dir;
    g.addEventListener("click", () => submit("act", { action: { type: "climb", dir } }));
  }
}

$("rulesBtn").onclick = () => { const r = $("rules"); r.style.display = r.style.display === "none" ? "block" : "none"; };

setInterval(() => {
  if (!snap) return;
  const dl = snap.pending?.deadlineMs ?? snap.phase.deadlineMs;
  const c = $("countdown");
  if (!dl || ["finished", "lobby"].includes(snap.phase.name)) { c.style.display = "none"; return; }
  c.style.display = "";
  const sec = Math.max(0, Math.round((dl - Date.now()) / 1000));
  c.textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}, 500);

requestAnimationFrame(frame);
if (MODE === "replay") startReplay(Q.get("replay"));
else {
  $("replayControls").style.display = "none";
  connect();
  runQueue();
}
