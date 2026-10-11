// Bottom sheet: a panel sliding up from the bottom, closed by tapping the scrim, Escape or a
// downward drag. Rendered into #layers, above the tabs.
import { useRef, useState, useEffect } from "preact/hooks";
import { createPortal } from "preact/compat";
import { t } from "../i18n/index.js";
import { IconButton } from "./components.jsx";

let openSheetCount = 0;

export function Sheet({ open = true, onClose, title, subtitle, children, footer, tall, headerRight }) {
  const sheetRef = useRef(null);
  const dragRef = useRef(null);
  const [closing, setClosing] = useState(false);
  const host = typeof document !== "undefined" ? document.getElementById("layers") : null;
  const close = () => {
    if (!closing) {
      setClosing(true);
      setTimeout(() => {
        setClosing(false);
        onClose?.();
      }, 160);
    }
  };
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (ev) => ev.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    openSheetCount += 1;
    document.documentElement.classList.add("noscroll");
    sheetRef.current?.focus({ preventScroll: true });
    return () => {
      window.removeEventListener("keydown", onKey);
      openSheetCount = Math.max(0, openSheetCount - 1);
      if (!openSheetCount) {
        document.documentElement.classList.remove("noscroll");
      }
    };
  }, [open]);
  if (!open || !host) {
    return null;
  }
  const onDragStart = (ev) => {
    if (!ev.target.closest("button,a,input,select")) {
      dragRef.current = { y: ev.clientY, dy: 0 };
      ev.currentTarget.setPointerCapture?.(ev.pointerId);
    }
  };
  const onDragMove = (ev) => {
    if (dragRef.current) {
      dragRef.current.dy = Math.max(0, ev.clientY - dragRef.current.y);
      if (sheetRef.current) {
        sheetRef.current.style.transform = `translateY(${dragRef.current.dy}px)`;
      }
    }
  };
  const onDragEnd = () => {
    if (!dragRef.current) {
      return;
    }
    const dy = dragRef.current.dy;
    dragRef.current = null;
    if (dy > 90) {
      close();
    } else if (sheetRef.current) {
      sheetRef.current.style.transform = "";
    }
  };
  return createPortal(
    <div class={`sheet-wrap ${closing ? "out" : ""}`}>
      <div class="scrim" onClick={close} />
      <div
        class={`sheet ${tall ? "tall" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={sheetRef}
      >
        <div
          class="sheet-head"
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragEnd}
        >
          <i class="grab" />
          <div class="sheet-title">
            <div>
              <h2>{title}</h2>
              {subtitle && <p>{subtitle}</p>}
            </div>
            <div class="row gap-s">
              {headerRight}
              <IconButton n="x" label={t("common.close")} onClick={close} />
            </div>
          </div>
        </div>
        <div class="sheet-body">{children}</div>
        {footer && <div class="sheet-foot">{footer}</div>}
      </div>
    </div>,
    host,
  );
}
