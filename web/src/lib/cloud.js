// Online sync, only when the page is hosted by Claude with a storage space
// (window.claude.use("db")). Everywhere else (local file, Android app) it stays inactive.
// Events are stored one document per month, the configuration in a separate document.
import { useReducer, useEffect } from "preact/hooks";
import { deviceSettings, normalizeState } from "./model.js";
import { t } from "../i18n/index.js";
import { getState, rawStorage, replaceState, subscribe } from "./store.js";

const cloudState = { status: "off", last: 0, error: "" };

const cloudListeners = new Set();

const setCloudState = (patch) => {
  Object.assign(cloudState, patch);
  cloudListeners.forEach((listener) => listener());
};

/** Preact hook: sync status { status: off | unavailable | connecting | ok | error, last, error }. */
export function useCloudState() {
  const [, rerender] = useReducer((n) => n + 1, 0);
  useEffect(() => {
    cloudListeners.add(rerender);
    return () => cloudListeners.delete(rerender);
  }, []);
  return cloudState;
}

const hasContent = (state) =>
  state.types.length || state.slots.length || state.events.length || state.fields.length;

let cloudSync = null;

export function syncCloudNow() {
  cloudSync?.push(true);
}

export async function startCloudSync() {
  if (cloudSync || typeof window === "undefined" || !window.claude?.use) {
    return;
  }
  let db = null;
  let user = null;
  try {
    db = await window.claude.use("db");
    user = await window.claude.use("user");
  } catch {}
  let userId = null;
  try {
    userId = user ? await user.id() : null;
  } catch {}
  if (!db || !userId) {
    return setCloudState({ status: "unavailable" });
  }
  const collection = db.collection(`data/users/${userId}`);
  const monthDoc = (date) => `ev_${date.slice(0, 4)}_${date.slice(5, 7)}`;
  let pushedRev = 0;
  let syncedRev = getState().rev || 0;
  const sentDocs = new Map();
  let remoteMonths = new Set();
  let pushing = false;
  let pushAgain = false;
  let timer = null;
  let applying = false;
  async function push() {
    if (pushing) {
      pushAgain = true;
      return;
    }
    pushing = true;
    try {
      const state = getState();
      const rev = state.rev || Date.now();
      const { events, ...config } = state;
      const byMonth = new Map();
      for (const ev of events) {
        const key = monthDoc(ev.date);
        if (!byMonth.has(key)) {
          byMonth.set(key, []);
        }
        byMonth.get(key).push(ev);
      }
      const docs = new Set([...byMonth.keys(), ...remoteMonths]);
      for (const key of docs) {
        const json = JSON.stringify(byMonth.get(key) || []);
        if (sentDocs.get(key) !== json) {
          if (json.length > 230_000) {
            throw new Error(t("cloud.error.monthTooLarge"));
          }
          await collection.doc(key).set({ rev, data: json });
          sentDocs.set(key, json);
        }
      }
      const cfg = JSON.stringify(config);
      if (sentDocs.get("cfg") !== cfg || pushedRev !== rev) {
        await collection.doc("cfg").set({ rev, data: cfg });
        sentDocs.set("cfg", cfg);
      }
      pushedRev = rev;
      syncedRev = rev;
      setCloudState({ status: "ok", last: Date.now(), error: "" });
    } catch (err) {
      setCloudState({ status: "error", error: err?.code || err?.message || "erreur" });
      clearTimeout(timer);
      timer = setTimeout(() => push(), 60_000);
    } finally {
      pushing = false;
      if (pushAgain) {
        pushAgain = false;
        schedule();
      }
    }
  }
  function schedule(now) {
    clearTimeout(timer);
    timer = setTimeout(push, now ? 0 : 1500);
  }
  function onRemote(docs) {
    const cfg = docs.cfg;
    const local = getState();
    if (!cfg || typeof cfg.data != "string") {
      remoteMonths = new Set(Object.keys(docs).filter((id) => id.startsWith("ev_")));
      if (hasContent(local)) {
        schedule(true);
      } else {
        setCloudState({ status: "ok", last: Date.now() });
      }
      return;
    }
    remoteMonths = new Set(Object.keys(docs).filter((id) => id.startsWith("ev_")));
    for (const id of remoteMonths) {
      if (typeof docs[id].data == "string") {
        sentDocs.set(id, docs[id].data);
      }
    }
    sentDocs.set("cfg", cfg.data);
    const remoteRev = cfg.rev || 0;
    const localRev = local.rev || 0;
    if (remoteRev === localRev || remoteRev === pushedRev) {
      return setCloudState({ status: "ok", last: Date.now() });
    }
    if (remoteRev > localRev) {
      const events = [];
      for (const id of remoteMonths) {
        const doc = docs[id];
        if ((doc.rev || 0) > remoteRev) {
          return;
        }
        try {
          events.push(...JSON.parse(doc.data));
        } catch {}
      }
      let next;
      try {
        next = normalizeState({ ...JSON.parse(cfg.data), events, rev: remoteRev });
      } catch {
        return setCloudState({ status: "error", error: t("cloud.error.unreadable") });
      }
      if (localRev > syncedRev && hasContent(local)) {
        rawStorage.set("pam-agenda:backup-local", JSON.stringify(local));
      }
      next.settings = { ...next.settings, ...deviceSettings(local.settings) };
      applying = true;
      replaceState(next);
      applying = false;
      syncedRev = remoteRev;
      setCloudState({ status: "ok", last: Date.now() });
    } else {
      schedule();
    }
  }
  cloudSync = { push: (now) => schedule(now) };
  setCloudState({ status: "connecting" });
  subscribe(() => {
    if (applying) {
      return;
    }
    const rev = getState().rev || 0;
    if (rev !== pushedRev && rev !== syncedRev) {
      schedule();
    }
  });
  try {
    collection.onSnapshot(
      (snap) => {
        const docs = {};
        snap.docs.forEach((doc) => {
          if (doc.exists) {
            docs[doc.id] = doc.data();
          }
        });
        onRemote(docs);
      },
      (err) => setCloudState({ status: "error", error: err?.code || "erreur" }),
    );
  } catch (err) {
    setCloudState({ status: "error", error: err?.message || "erreur" });
  }
}
