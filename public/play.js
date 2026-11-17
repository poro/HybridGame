// Game page for human players (?s=&t=) and the researcher observer (?s=&o=).
const qs = new URLSearchParams(location.search);
const S = qs.get("s"), T = qs.get("t"), O = qs.get("o");
let snap = null;
let composeKey = null;
let ws;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws?s=${encodeURIComponent(S)}&${T ? `t=${encodeURIComponent(T)}` : `o=${encodeURIComponent(O)}`}`);
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.type === "snapshot") { snap = m.data; render(); }
  };
  ws.onclose = (e) => {
    $("phase").textContent = e.reason ? `Disconnected: ${e.reason}` : "Disconnected — reconnecting…";
    if (!e.reason) setTimeout(connect, 1500);
  };
}
connect();

function send(kind, payload) {
  ws.send(JSON.stringify({ type: "submit", kind, payload }));
}

$("rulesBtn").onclick = () => { const r = $("rules"); r.style.display = r.style.display === "none" ? "block" : "none"; };

// ---------------------------------------------------------------------------

function nameOf(id) { return snap.players.find((p) => p.id === id)?.name ?? id; }
function playerMeta(id) { return snap.players.find((p) => p.id === id); }

function pledgeLabel(p) {
  if (!p) return "";
  if (p.type === "salvage") return `salvage @ ${p.site}`;
  if (p.type === "heal") return `heal ${nameOf(p.target)}`;
  return p.type;
}

function phaseText() {
  const ph = snap.phase;
  const waiting = ph.waitingOn.map(nameOf).join(", ");
  switch (ph.name) {
    case "lobby": {
      const missing = snap.players.filter((p) => p.connected === false).map((p) => p.name);
      return missing.length && snap.observer ? `Waiting for humans to join: ${missing.join(", ")}` : "Waiting for all players to join…";
    }
    case "discuss": return `Day ${ph.day} · discussion round ${ph.round} · ${ph.waitingOn.includes(snap.you) ? "your turn to talk" : `waiting on ${waiting}`}`;
    case "act": return `Day ${ph.day} · secret actions · waiting on ${waiting || "—"}`;
    case "survey": return `Game over · debrief${waiting ? ` · waiting on ${waiting}` : ""}`;
    case "finished": return "Game over";
  }
}

function render() {
  $("title").textContent = `Outpost · Day ${snap.day} of ${snap.config.days}`;
  $("phase").textContent = phaseText();
  $("rules").textContent = snap.rules + (snap.identityBrief ? `\n\n${snap.identityBrief}` : "");
  $("game").className = snap.observer ? "game observer" : "game";
  if (snap.outcome) {
    const o = snap.outcome;
    $("banner").innerHTML = `<div class="banner ${o.rescued ? "win" : "lose"}">${o.rescued ? "Rescued!" : "Not rescued."} ${esc(o.reason)} Survivors: ${o.survivors.map(nameOf).join(", ") || "none"}.</div>`;
  } else $("banner").innerHTML = "";
  renderLeft();
  renderFeed();
  renderCompose();
  if (snap.observer) renderSide();
}

function stat(label, value, max) {
  return `<div class="stat"><span class="muted small">${label}</span><b>${value}${max ? `<span class="muted small">/${max}</span>` : ""}</b>${max ? `<div class="bar"><i style="width:${Math.min(100, (100 * value) / max)}%"></i></div>` : ""}</div>`;
}

function renderLeft() {
  const v = snap.view;
  const x = snap.observerExtra;
  const camp = v ? v.campFood : x.campFood, shelter = v ? v.shelter : x.shelter, parts = v ? v.parts : x.parts;
  let html = `<div class="panel"><div class="stats">${stat("Camp food", camp)}${stat("Shelter", shelter, 10)}${stat("Beacon", parts, snap.config.beaconParts)}</div>`;
  const pledges = snap.todaysPledges || {};
  if (v) {
    const me = v.you;
    html += `<div class="card me ${me.alive ? "" : "dead"}"><div class="row" style="justify-content:space-between"><b>${esc(me.name)} (you)</b><span class="chip">${me.role}</span></div>
      <div class="small">Health <b>${me.health}</b>/10 · Pouch <b>${me.pouch}</b> food${me.alive ? "" : " · <b>DEAD</b>"}</div>
      <div class="small muted" style="margin-top:4px">${esc(me.roleInfo)}</div>
      ${v.privateIntel.map((i) => `<div class="intel">🔒 ${esc(i)}</div>`).join("")}
      ${pledges[me.id] ? `<div class="small" style="margin-top:4px">Your pledge: <span class="chip">${pledgeLabel(pledges[me.id])}</span></div>` : ""}</div>`;
    for (const t of v.teammates) {
      const meta = playerMeta(t.id);
      html += `<div class="card ${t.alive ? "" : "dead"}"><div class="row" style="justify-content:space-between"><b>${esc(t.name)}</b><span class="chip">${t.role}</span></div>
        <div class="small">${t.alive ? (t.health !== null ? `Health <b>${t.health}</b>/10` : t.healthBand) : "<b>DEAD</b>"}${t.pouch !== null && t.alive ? ` · Pouch <b>${t.pouch}</b>` : ""}</div>
        ${meta?.label ? `<div class="small muted">${meta.kind === "human" ? "human" : esc(meta.label)}</div>` : ""}
        ${pledges[t.id] ? `<div class="small">Pledged: <span class="chip">${pledgeLabel(pledges[t.id])}</span></div>` : ""}</div>`;
    }
    html += `<div class="small muted">${esc(snap.identityBrief)}</div>`;
  } else {
    for (const p of snap.players) {
      html += `<div class="card ${p.alive ? "" : "dead"}"><div class="row" style="justify-content:space-between"><b>${esc(p.name)}</b><span class="chip">${p.role}</span></div>
        <div class="small">${esc(p.label)}${p.connected === null ? "" : p.connected ? ' · <span class="chip ok">online</span>' : ' · <span class="chip bad">offline</span>'}</div>
        <div class="small">Health <b>${p.health}</b> · Pouch <b>${p.pouch}</b>${p.alive ? "" : " · DEAD"}</div>
        ${pledges[p.id] ? `<div class="small">Pledged: <span class="chip">${pledgeLabel(pledges[p.id])}</span></div>` : ""}</div>`;
    }
  }
  $("left").innerHTML = html + "</div>";
}

function renderFeed() {
  const feed = $("feed");
  const atBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 40;
  let html = "";
  const lastDay = Math.max(snap.day, ...snap.chat.map((m) => m.day), 1);
  for (let d = 1; d <= lastDay; d++) {
    const msgs = snap.chat.filter((m) => m.day === d);
    const hist = snap.history.find((h) => h.day === d);
    if (!msgs.length && !hist && d !== snap.day) continue;
    html += `<div class="dayhead">Day ${d}</div>`;
    for (const m of msgs) {
      const meta = playerMeta(m.from);
      const tag = meta?.label ? ` <span class="muted small">(${meta.kind === "human" ? "human" : esc(meta.label)})</span>` : "";
      html += `<div class="msg ${m.from === snap.you ? "mine" : ""}"><span class="who">${esc(m.fromName)}</span>${tag}: ${m.text ? esc(m.text) : '<span class="muted">(no message)</span>'}
        ${m.pledge ? ` <span class="chip">pledge: ${pledgeLabel(m.pledge)}</span>` : ""}</div>`;
    }
    if (hist) html += `<div class="narr">${hist.narrative.map(esc).join(" ")}</div>`;
  }
  if (snap.phase.name === "lobby") html = `<div class="muted">The game starts once every human player has opened their link.</div>`;
  feed.innerHTML = html;
  if (atBottom) feed.scrollTop = feed.scrollHeight;
}

// ---------------------------------------------------------------------------
// Compose area. Only rebuilt when the pending request changes, so typing isn't lost.

function renderCompose() {
  const el = $("compose");
  const p = snap.pending;
  const key = p ? `${p.kind}:${snap.day}:${p.round}` : `none:${snap.phase.name}:${snap.surveyDone}`;
  if (key === composeKey) return;
  composeKey = key;
  if (snap.observer) {
    el.innerHTML = snap.phase.name === "lobby" ? `<button class="primary" id="forceStart">Start now (don't wait for humans)</button>` : `<span class="muted small">Observer view — you see everything, players don't.</span>`;
    const b = $("forceStart");
    if (b) b.onclick = () => ws.send(JSON.stringify({ type: "start" }));
    return;
  }
  if (!p) {
    el.innerHTML = `<span class="muted small">${snap.view && !snap.view.you.alive ? "You died — you can keep watching." : snap.surveyDone ? "Thanks — your debrief is recorded." : "Waiting for teammates…"}</span>`;
    return;
  }
  const v = snap.view;
  const mates = v.teammates.filter((t) => t.alive);
  if (p.kind === "discuss") {
    const mine = snap.todaysPledges[v.you.id];
    const opts = [["none", "no pledge"], ["forage", "forage"], ["salvage:wreck", "salvage @ wreck"], ["salvage:ridge", "salvage @ ridge"], ["repair", "repair"], ["rest", "rest"], ...mates.map((t) => [`heal:${t.id}`, `heal ${t.name}`])];
    const cur = mine ? (mine.type === "salvage" ? `salvage:${mine.site}` : mine.type === "heal" ? `heal:${mine.target}` : mine.type) : "none";
    el.innerHTML = `<div class="small" style="margin-bottom:6px"><b>Your turn to talk</b> (round ${p.round}). Say something to the team, or stay silent.</div>
      <textarea id="msg" maxlength="600" placeholder="e.g. I'm the engineer — parts are at the wreck today. Who's with me?"></textarea>
      <div class="row" style="margin-top:6px">
        <label class="small">Pledge for today <select id="pledge">${opts.map(([v2, l]) => `<option value="${v2}" ${v2 === cur ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label>
        <button class="primary" id="sendMsg">Send</button><button id="silent">Stay silent</button>
      </div>`;
    const pledgeVal = () => {
      const [type, arg] = $("pledge").value.split(":");
      if (type === "none") return null;
      return { type, site: type === "salvage" ? arg : null, target: type === "heal" ? arg : null };
    };
    $("msg").focus();
    $("msg").onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("sendMsg").click(); } };
    $("sendMsg").onclick = () => send("discuss", { message: $("msg").value, pledge: pledgeVal() });
    $("silent").onclick = () => send("discuss", { message: "", pledge: pledgeVal() });
  } else if (p.kind === "act") {
    const mine = snap.todaysPledges[v.you.id];
    const pre = mine ? (mine.type === "salvage" ? `salvage:${mine.site}` : mine.type) : "";
    const choices = [["forage", "🌿 Forage"], ["salvage:wreck", "✈️ Salvage wreck"], ["salvage:ridge", "⛰️ Salvage ridge"], ["repair", "🔨 Repair"], ["rest", "💤 Rest"], ["heal", "➕ Heal"]];
    el.innerHTML = `<div class="small"><b>Choose your action for day ${snap.day}</b> — secret until everyone has chosen.</div>
      <div class="actions-grid">${choices.map(([v2, l]) => `<label><input type="radio" name="act" value="${v2}" ${v2 === pre ? "checked" : ""} ${v2 === "heal" && !mates.length ? "disabled" : ""}/>${l}</label>`).join("")}</div>
      <div class="row small" style="margin-bottom:6px">
        <label>Heal who <select id="healT">${mates.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join("")}</select></label>
      </div>
      <div class="row small" style="margin-bottom:8px">
        <label>Deposit to camp <input id="dep" type="number" min="0" max="${v.you.pouch}" value="0" style="width:64px" /></label>
        <label>Give <input id="giveN" type="number" min="0" max="${v.you.pouch}" value="0" style="width:64px" /> food to <select id="giveT"><option value="">nobody</option>${mates.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join("")}</select></label>
        <span class="muted">You have ${v.you.pouch} food.</span>
      </div>
      <button class="primary" id="submitAct">Lock in action</button>`;
    $("submitAct").onclick = () => {
      const sel = document.querySelector('input[name="act"]:checked');
      if (!sel) return alert("Pick an action first.");
      const [type, site] = sel.value.split(":");
      send("act", {
        action: {
          type,
          site: site ?? null,
          target: type === "heal" ? $("healT").value : null,
          deposit: Number($("dep").value) || 0,
          giveTo: $("giveT").value || null,
          giveAmount: Number($("giveN").value) || 0,
        },
      });
    };
  } else if (p.kind === "survey") {
    el.innerHTML = `<div class="small" style="margin-bottom:8px"><b>Debrief.</b> For each teammate: how much did you trust them, and do you think they were a human or an AI?</div>
      ${v.teammates.map((t) => `<div class="survey-row small"><b>${esc(t.name)}</b>
        <label>Trust <select data-trust="${t.id}">${[1, 2, 3, 4, 5, 6, 7].map((n) => `<option ${n === 4 ? "selected" : ""}>${n}</option>`).join("")}</select> <span class="muted">1–7</span></label>
        <select data-guess="${t.id}"><option value="unsure">unsure</option><option value="human">human</option><option value="ai">AI</option></select></div>`).join("")}
      <textarea id="reflect" placeholder="How did your team cooperate? What worked, what didn't?"></textarea>
      <button class="primary" id="submitSurvey" style="margin-top:6px">Submit debrief</button>`;
    $("submitSurvey").onclick = () => send("survey", {
      ratings: v.teammates.map((t) => ({
        playerId: t.id,
        trust: Number(document.querySelector(`[data-trust="${t.id}"]`).value),
        guess: document.querySelector(`[data-guess="${t.id}"]`).value,
      })),
      reflection: $("reflect").value,
    });
  }
}

function renderSide() {
  const x = snap.observerExtra;
  const side = $("side");
  side.style.display = "block";
  const tokens = x.usage.reduce((a, u) => a + u.inputTokens + u.outputTokens, 0);
  let html = `<div class="panel" style="margin-bottom:12px"><h2>Hidden state</h2>
    <div class="small">Parts today: <b>${x.partsSiteToday ?? "—"}</b> · Tonight: <b>${x.eventTonight ?? "—"}</b></div>
    <div class="small">Model calls: ${x.usage.length} · tokens: ${tokens.toLocaleString()} · timeouts/errors: ${x.events.length}</div>
    ${x.joinLinks.length ? `<div class="small" style="margin-top:6px">Join links:${x.joinLinks.map((j) => `<div class="mono">${esc(j.name)}: <a href="/play.html?s=${snap.sessionId}&t=${j.token}" target="_blank">open</a></div>`).join("")}</div>` : ""}
    </div>`;
  html += `<div class="panel" style="margin-bottom:12px"><h2>AI private notes</h2><div class="notes">${x.notes.slice().reverse().map((n) => `<div><b>${esc(nameOf(n.playerId))}</b> <span class="muted">d${n.day} ${esc(n.phase)}</span><br>${esc(n.note)}</div>`).join("") || '<span class="muted small">none yet</span>'}</div></div>`;
  if (x.events.length) html += `<div class="panel" style="margin-bottom:12px"><h2>Timeouts / errors</h2><div class="notes">${x.events.map((e) => `<div>${esc(e.type)} · ${esc(nameOf(e.playerId))} · ${esc(e.detail)}</div>`).join("")}</div></div>`;
  if (x.summary) {
    html += `<div class="panel"><h2>Summary</h2><table><thead><tr><th>Player</th><th>Kept</th><th>Shared</th><th>Joint</th><th>Trust rcvd</th></tr></thead><tbody>
      ${x.summary.players.map((p) => `<tr><td>${esc(p.name)}<div class="muted small">${esc(p.label)}</div></td>
        <td>${p.pledges ? `${p.pledgesKept}/${p.pledges}` : "—"}</td>
        <td>${p.shareRate === null ? "—" : Math.round(p.shareRate * 100) + "%"}</td>
        <td>${p.jointActions}</td>
        <td>${p.trustReceivedAvg === null ? "—" : p.trustReceivedAvg.toFixed(1)}</td></tr>`).join("")}
      </tbody></table>
      ${Object.entries(x.surveys).map(([pid, s]) => s.reflection ? `<p class="small"><b>${esc(nameOf(pid))}:</b> ${esc(s.reflection)}</p>` : "").join("")}</div>`;
  }
  side.innerHTML = html;
}

// Countdown ticker.
setInterval(() => {
  if (!snap) return;
  const dl = snap.pending?.deadlineMs ?? snap.phase.deadlineMs;
  const el = $("countdown");
  if (!dl || ["finished", "lobby"].includes(snap.phase.name)) { el.style.display = "none"; return; }
  el.style.display = "";
  const s = Math.max(0, Math.round((dl - Date.now()) / 1000));
  el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}, 500);
