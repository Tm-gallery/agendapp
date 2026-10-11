// Snackbars (with an optional action such as "Undo") and confirmation dialogs, callable from
// anywhere once <Overlays /> is mounted.
import { useState, useEffect } from "preact/hooks";
import { t } from "../i18n/index.js";
import { Button } from "./components.jsx";

const overlayHandlers = { toast: null, confirm: null };

/** Shows a snackbar. `opts`: { tone: "danger", action: { label, run } }. */
export function toast(msg, opts = {}) {
  overlayHandlers.toast?.({ msg, ...opts, id: Date.now() + Math.random() });
}

/** Asks for confirmation; resolves to true or false. `opts`: { title, text, confirmLabel, danger }. */
export function confirmDialog(opts) {
  return new Promise((resolve) =>
    overlayHandlers.confirm ? overlayHandlers.confirm({ ...opts, resolve }) : resolve(false),
  );
}

export function Overlays() {
  const [toasts, setToasts] = useState([]);
  const [pending, setPending] = useState(null);
  useEffect(() => {
    overlayHandlers.toast = (item) => {
      setToasts([item]);
      setTimeout(() => setToasts((list) => list.filter((t) => t.id !== item.id)), item.action ? 6500 : 3200);
    };
    overlayHandlers.confirm = (request) => setPending(request);
    return () => {
      overlayHandlers.toast = null;
      overlayHandlers.confirm = null;
    };
  }, []);
  const answer = (ok) => {
    pending.resolve(ok);
    setPending(null);
  };
  return (
    <>
      <div class="toasts" aria-live="polite">
        {toasts.map((item) => (
          <div class={`toast ${item.tone || ""}`} key={item.id}>
            <span>{item.msg}</span>
            {item.action && (
              <button
                type="button"
                onClick={() => {
                  item.action.run();
                  setToasts((list) => list.filter((t) => t.id !== item.id));
                }}
              >
                {item.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
      {pending && (
        <div class="dlg-wrap">
          <div class="scrim" onClick={() => answer(false)} />
          <div class="dlg" role="alertdialog" aria-modal="true">
            <h3>{pending.title}</h3>
            {pending.text && <p>{pending.text}</p>}
            <div class="row gap-s end">
              <Button kind="ghost" onClick={() => answer(false)}>
                {pending.cancelLabel || t("common.cancel")}
              </Button>
              <Button kind={pending.danger ? "danger" : "primary"} onClick={() => answer(true)}>
                {pending.confirmLabel || t("common.confirm")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
