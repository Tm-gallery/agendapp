// Navigation requests coming from outside the page (Android home-screen shortcuts, widgets, links
// from the watch). An intent waits in a queue until a mounted screen handles it, so it can be sent
// before the target screen exists.
//
//   new            Calendar: new event today          day <date>    Calendar: show that day
//   plan           Schedule tab                        export        Schedule: open the export sheet
//   sync           Schedule: export and send directly  settings      Settings home
//   backup         Settings: automatic backup          widget <id>   Settings: configure a widget
import { useEffect, useRef } from "preact/hooks";

/** Tab that shows each intent (see App.jsx). */
export const INTENT_TABS = {
  new: "cal",
  day: "cal",
  plan: "plan",
  export: "plan",
  sync: "plan",
  settings: "set",
  backup: "set",
  widget: "set",
};

const queue = [];
const handlers = new Set();
const observers = new Set();

function drain() {
  for (const handler of handlers) {
    handler();
  }
}

/** Queues an intent; observers (tab switching) are told first, then handlers get a chance. */
export function sendIntent(name, arg = "") {
  if (!(name in INTENT_TABS)) {
    return;
  }
  queue.push({ name, arg });
  observers.forEach((observer) => observer(name, arg));
  drain();
}

/** Preact hook: `handler(name, arg)` consumes the intents listed in `names`. */
export function useIntent(names, handler) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const run = () => {
      const index = queue.findIndex((intent) => names.includes(intent.name));
      if (index >= 0) {
        const [intent] = queue.splice(index, 1);
        ref.current(intent.name, intent.arg);
      }
    };
    handlers.add(run);
    run();
    return () => handlers.delete(run);
  }, []);
}

/** Preact hook: `observer(name, arg)` sees every intent without consuming it. */
export function useIntentObserver(observer) {
  const ref = useRef(observer);
  ref.current = observer;
  useEffect(() => {
    const run = (name, arg) => ref.current(name, arg);
    observers.add(run);
    return () => observers.delete(run);
  }, []);
}
