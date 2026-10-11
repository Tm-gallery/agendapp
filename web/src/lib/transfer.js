// Device-to-device transfer without a server: the state is compressed into a text code
// "PAMX1:…", split into several QR codes if needed, then merged on arrival (newest change wins,
// deletions are respected) or used as a replacement.
import { deviceSettings, normalizeState } from "./model.js";
import { t } from "../i18n/index.js";

// Historical prefix, kept so that codes stay compatible between versions.
const TRANSFER_PREFIX = "PAMX1";

const base64url = {
  enc(bytes) {
    let bin = "";
    for (let i = 0; i < bytes.length; i += 32768) {
      bin += String.fromCharCode(...bytes.subarray(i, i + 32768));
    }
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  },
  dec(text) {
    const bin = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      bytes[i] = bin.charCodeAt(i);
    }
    return bytes;
  },
};

async function pipeThrough(bytes, transform) {
  const res = new Response(new Blob([bytes]).stream().pipeThrough(transform));
  return new Uint8Array(await res.arrayBuffer());
}

const canCompress = () => typeof CompressionStream !== "undefined" && typeof DecompressionStream !== "undefined";

/** Data to send: everything, or only events from `since` onwards. */
export function transferPayload(state, { since = null } = {}) {
  const events = since ? state.events.filter((ev) => ev.date >= since) : state.events;
  const gone = state.gone || {};
  return { ...state, events, gone };
}

/** Text code for `data`, deflate-compressed when the browser supports it. */
export async function encodeTransfer(data) {
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  if (canCompress()) {
    const packed = await pipeThrough(bytes, new CompressionStream("deflate-raw"));
    return `${TRANSFER_PREFIX}:d:${base64url.enc(packed)}`;
  }
  return `${TRANSFER_PREFIX}:r:${base64url.enc(bytes)}`;
}

/** State decoded from a text code. Throws a readable error if the code is invalid. */
export async function decodeTransfer(code) {
  const match = String(code || "")
    .trim()
    .replace(/\s+/g, "")
    .match(/^PAMX1:([dr]):([A-Za-z0-9_-]+)$/);
  if (!match) {
    throw new Error(t("transfer.error.unknownCode"));
  }
  let bytes = base64url.dec(match[2]);
  if (match[1] === "d") {
    if (!canCompress()) {
      throw new Error(t("transfer.error.noDecompression"));
    }
    bytes = await pipeThrough(bytes, new DecompressionStream("deflate-raw"));
  }
  const data = JSON.parse(new TextDecoder().decode(bytes));
  if (!data || typeof data != "object") {
    throw new Error(t("transfer.error.unreadable"));
  }
  return normalizeState(data);
}

const shortId = () => Math.random().toString(36).slice(2, 6);

/** Splits a code into QR-sized chunks "PAMX|id|index|count|data". */
export function splitIntoChunks(code, size = 260) {
  const id = shortId();
  const count = Math.max(1, Math.ceil(code.length / size));
  return Array.from(
    { length: count },
    (_, i) => `PAMX|${id}|${i + 1}|${count}|${code.slice(i * size, (i + 1) * size)}`,
  );
}

function parseChunk(text) {
  const match = String(text).match(/^PAMX\|([a-z0-9]+)\|(\d+)\|(\d+)\|(.+)$/s);
  return match ? { id: match[1], i: +match[2], n: +match[3], data: match[4] } : null;
}

/** Collects scanned chunks in any order until the code is complete. */
export function chunkCollector() {
  let currentId = null;
  let total = 0;
  const parts = new Map();
  return {
    add(text) {
      const chunk = parseChunk(text);
      if (!chunk) {
        return { ok: false };
      }
      if (chunk.id !== currentId) {
        currentId = chunk.id;
        total = chunk.n;
        parts.clear();
      }
      const isNew = !parts.has(chunk.i);
      parts.set(chunk.i, chunk.data);
      return {
        ok: true,
        isNew,
        got: parts.size,
        total,
        done: parts.size === total,
      };
    },
    code() {
      if (!total || parts.size !== total) {
        return null;
      }
      let code = "";
      for (let i = 1; i <= total; i++) {
        code += parts.get(i);
      }
      return code;
    },
    progress: () => ({ got: parts.size, total }),
    reset() {
      currentId = null;
      total = 0;
      parts.clear();
    },
  };
}

const changedAt = (ev) => ev.at || ev.createdAt || 0;

/** What a merge would change: counts of new, newer, identical and deleted events. */
export function compareStates(state, incoming) {
  const local = new Map(state.events.map((ev) => [ev.id, ev]));
  const goneHere = state.gone || {};
  const goneThere = incoming.gone || {};
  let added = 0;
  let newer = 0;
  let same = 0;
  let removedHere = 0;
  for (const ev of incoming.events) {
    const mine = local.get(ev.id);
    if (mine) {
      if (changedAt(ev) > changedAt(mine)) {
        newer++;
      } else {
        same++;
      }
    } else {
      if ((goneHere[ev.id] || 0) >= changedAt(ev)) {
        continue;
      }
      added++;
    }
  }
  for (const ev of state.events) {
    if (goneThere[ev.id] && goneThere[ev.id] > changedAt(ev)) {
      removedHere++;
    }
  }
  const configNewer = (incoming.rev || 0) > (state.rev || 0);
  return {
    added,
    newer,
    same,
    removedHere,
    configNewer,
    incomingEvents: incoming.events.length,
    localEvents: state.events.length,
  };
}

/**
 * Merges received data into the local state: events are united (the most recently changed copy
 * wins), deletions from either side are applied, the newest configuration is kept, and device
 * settings (theme, language…) stay local.
 */
export function mergeStates(state, incoming) {
  const newest = (incoming.rev || 0) > (state.rev || 0) ? incoming : state;
  const goneHere = state.gone || {};
  const goneThere = incoming.gone || {};
  const gone = { ...goneHere };
  for (const [id, time] of Object.entries(goneThere)) {
    gone[id] = Math.max(gone[id] || 0, time);
  }
  const cutoff = Date.now() - 366 * 86_400_000;
  for (const ev of Object.keys(gone)) {
    if (gone[ev] < cutoff) {
      delete gone[ev];
    }
  }
  const byId = new Map();
  for (const ev of [...state.events, ...incoming.events]) {
    const seen = byId.get(ev.id);
    if (!seen) {
      byId.set(ev.id, ev);
      continue;
    }
    const [winner, loser] = changedAt(ev) > changedAt(seen) ? [ev, seen] : [seen, ev];
    let merged = winner;
    if (
      loser.status === "exported" &&
      winner.status !== "exported" &&
      (loser.exportedAt || 0) >= changedAt(winner)
    ) {
      merged = {
        ...winner,
        status: "exported",
        exportedAt: loser.exportedAt,
        gcalId: loser.gcalId ?? winner.gcalId,
        seq: Math.max(winner.seq || 0, loser.seq || 0),
      };
    } else if (!winner.gcalId && loser.gcalId) {
      merged = { ...winner, gcalId: loser.gcalId };
    }
    byId.set(ev.id, merged);
  }
  const events = [...byId.values()].filter((ev) => !(gone[ev.id] && gone[ev.id] >= changedAt(ev)));
  const people = { ...state.people };
  for (const [name, entry] of Object.entries(incoming.people || {})) {
    const key = Object.keys(people).find((k) => k.toLowerCase() === name.toLowerCase()) || name;
    const mine = people[key];
    people[key] = mine ? { n: Math.max(mine.n, entry.n), t: Math.max(mine.t, entry.t) } : entry;
  }
  const usage = { ...state.usage };
  for (const [key, value] of Object.entries(incoming.usage || {})) {
    usage[key] = Math.max(usage[key] || 0, value);
  }
  return {
    ...newest,
    settings: { ...newest.settings, ...deviceSettings(state.settings) },
    events,
    people,
    usage,
    gone,
  };
}
