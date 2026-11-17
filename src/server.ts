// Web server: lobby to configure a roster, live game pages for human players,
// and an observer (researcher) view that sees everything including AI notes.
//
//   npm run dev          -> http://localhost:8787
//   HOST=0.0.0.0 npm start   to let people on your network join

import "dotenv/config";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import { ALIASES, compositionClass, hasAnthropicCredentials, hasOpenAICredentials, parseSeat } from "./models.js";
import type { HumanRequestKind } from "./players/human.js";
import { Session } from "./session.js";
import { TSession } from "./tethered/session.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(here, "../public");
const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? "127.0.0.1";

const DATA = path.resolve(here, "../data/games");
type AnySession = Session | TSession;
const sessions = new Map<string, AnySession>();
const PAGE: Record<AnySession["game"], string> = { outpost: "/play.html", tethered: "/tethered.html" };

// Lobby, observer links and replays expose every player's data, so they are only served
// to this machine. Remote human players only need play.html + their WebSocket.
function isLocal(req: IncomingMessage) {
  const a = req.socket.remoteAddress ?? "";
  return a === "127.0.0.1" || a === "::1" || a === "::ffff:127.0.0.1";
}
const started = new Set<string>();

function start(session: AnySession) {
  if (started.has(session.id)) return;
  started.add(session.id);
  console.log(`[${session.id}] starting: ${session.opts.seats.map((s) => s.label).join(", ")}`);
  (session.run() as Promise<{ rescued?: boolean; won?: boolean }>).then(
    (s) => console.log(`[${session.id}] finished: ${s.rescued || s.won ? "WON" : "LOST"}`),
    (e) => console.error(`[${session.id}] crashed`, e),
  );
}

const MIME: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };

async function readBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith("/api/") && !isLocal(req)) return json(res, 403, { error: "lobby APIs are only available on the host machine" });
    if (url.pathname === "/api/games") {
      const files = (await readdir(DATA).catch(() => [] as string[])).filter((f) => f.endsWith(".summary.json"));
      const games = await Promise.all(files.map(async (f) => JSON.parse(await readFile(path.join(DATA, f), "utf8"))));
      return json(res, 200, games
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .map((g) => ({
          id: g.sessionId,
          game: g.game ?? "outpost",
          createdAt: g.createdAt,
          condition: g.condition,
          composition: g.compositionKey,
          cls: g.compositionClass,
          won: g.game === "tethered" ? g.won : g.rescued,
          result: g.game === "tethered" ? `${g.summited}/${g.nPlayers} summited, ${g.injuries} injuries` : `${g.survivors}/${g.nPlayers} survived`,
          replay: g.game === "tethered" ? `/tethered.html?replay=${g.sessionId}` : null,
        })));
    }
    const replay = url.pathname.match(/^\/api\/replay\/([\w-]+)$/);
    if (replay) {
      const raw = await readFile(path.join(DATA, `${replay[1]}.jsonl`), "utf8");
      const keep = new Set(["session_start", "chat", "action", "day_resolved", "round_resolved", "game_over", "survey", "summary"]);
      return json(res, 200, raw.split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((e) => keep.has(e.type)));
    }
    if (url.pathname === "/api/presets") {
      return json(res, 200, { aliases: Object.keys(ALIASES), keys: { anthropic: hasAnthropicCredentials(), openai: hasOpenAICredentials() } });
    }
    if (url.pathname === "/api/sessions" && req.method === "GET") {
      return json(res, 200, [...sessions.values()].map((s) => ({
        id: s.id,
        game: s.game,
        phase: s.phase.name,
        day: s.progress(),
        seats: s.opts.seats.map((x) => x.label),
        composition: compositionClass(s.opts.seats),
        condition: s.opts.condition ?? null,
        reveal: s.opts.revealIdentities,
        observer: `${PAGE[s.game]}?s=${s.id}&o=${s.observerToken}`,
      })));
    }
    if (url.pathname === "/api/sessions" && req.method === "POST") {
      const body = await readBody(req);
      const seats = (body.seats as string[]).map(parseSeat);
      const common = { seats, revealIdentities: Boolean(body.reveal), condition: body.condition || undefined, seed: body.seed ? Number(body.seed) : undefined };
      const session: AnySession =
        body.game === "outpost"
          ? new Session({
              ...common,
              game: { ...(body.days ? { days: Number(body.days) } : {}), ...(body.rounds ? { discussionRounds: Number(body.rounds) } : {}) },
            })
          : new TSession({
              ...common,
              game: { ...(body.days ? { rounds: Number(body.days) } : {}), ...(body.rounds ? { chatRounds: Number(body.rounds) } : {}) },
            });
      sessions.set(session.id, session);
      if (!session.humans().length) start(session);
      return json(res, 200, {
        id: session.id,
        game: session.game,
        observer: `${PAGE[session.game]}?s=${session.id}&o=${session.observerToken}`,
        join: [...session.humanTokens.entries()].map(([t, pid]) => ({ name: session.name(pid), url: `${PAGE[session.game]}?s=${session.id}&t=${t}` })),
      });
    }
    // Static files.
    const file = path.normalize(path.join(PUBLIC, url.pathname === "/" ? "index.html" : url.pathname));
    if (!file.startsWith(PUBLIC)) return json(res, 403, { error: "forbidden" });
    const data = await readFile(file);
    res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
    res.end(data);
  } catch (e: any) {
    if (e?.code === "ENOENT") return json(res, 404, { error: "not found" });
    console.error(e);
    json(res, 400, { error: e?.message ?? String(e) });
  }
});

// ---------------------------------------------------------------------------
// WebSocket: /ws?s=<session>&t=<player token>  or  &o=<observer token>

const wss = new WebSocketServer({ server, path: "/ws" });
wss.on("connection", (ws: WebSocket, req) => {
  const url = new URL(req.url ?? "", "http://x");
  const session = sessions.get(url.searchParams.get("s") ?? "");
  if (!session) return ws.close(4004, "no such session");
  const token = url.searchParams.get("t");
  const obs = url.searchParams.get("o");
  let pid: string | null = null;
  if (token) {
    pid = session.humanTokens.get(token) ?? null;
    if (!pid) return ws.close(4003, "bad token");
  } else if (obs !== session.observerToken) {
    return ws.close(4003, "bad observer token");
  }
  const human = pid ? session.humanFor(pid) : null;
  if (human) human.connected++;

  // Coalesce bursts of updates into one snapshot per tick.
  let queued = false;
  const push = () => {
    if (queued) return;
    queued = true;
    setImmediate(() => {
      queued = false;
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: "snapshot", data: session.snapshotFor(pid) }));
    });
  };
  session.on("update", push);
  push();
  session.emit("update"); // let others see connection status

  // Auto-start once every human seat has connected at least once.
  if (session.humans().every((h) => h.connected > 0)) start(session);

  ws.on("message", (raw) => {
    let msg: any;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (msg.type === "submit" && human) human.submit(msg.kind as HumanRequestKind, msg.payload);
    if (msg.type === "start" && !pid) start(session);
  });
  ws.on("close", () => {
    session.off("update", push);
    if (human) human.connected--;
    session.emit("update");
  });
});

server.listen(PORT, HOST, () => {
  console.log(`HybridGame lobby: http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`);
  if (!hasAnthropicCredentials()) console.log("  note: no Claude credentials (run `ant auth login` or set ANTHROPIC_API_KEY) — Claude seats will fall back to a default move.");
  if (!process.env.OPENAI_API_KEY) console.log("  note: OPENAI_API_KEY not set — OpenAI seats will fail and fall back to a default move.");
});
