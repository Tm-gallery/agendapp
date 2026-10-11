// Shared building blocks: buttons, pickers, switches, list items, sections.
import { haptic } from "../lib/haptics.js";
import { t } from "../i18n/index.js";
import { Icon } from "./Icon.jsx";

/** Readable text colour (dark or white) on a `hex` background. */
export function contrastText(hex) {
  const rgb = hex.replace("#", "");
  const r = parseInt(rgb.slice(0, 2), 16);
  const g = parseInt(rgb.slice(2, 4), 16);
  const b = parseInt(rgb.slice(4, 6), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 165 ? "#17202e" : "#ffffff";
}

export function Button({ kind = "soft", icon, children, class: className = "", block, small, ...rest }) {
  return (
    <button
      type="button"
      class={`btn btn-${kind} ${block ? "btn-block" : ""} ${small ? "btn-sm" : ""} ${className}`}
      {...rest}
    >
      {icon && <Icon n={icon} size={small ? 16 : 18} />}
      {children != null && <span>{children}</span>}
    </button>
  );
}

export function IconButton({ n: name, label, class: className = "", size = 20, ...rest }) {
  return (
    <button type="button" class={`ibtn ${className}`} aria-label={label} title={label} {...rest}>
      <Icon n={name} size={size} />
    </button>
  );
}

/** Connected button group; `options` are { v, label, sub? }. */
export function Segmented({ value, options, onChange, class: className = "" }) {
  return (
    <div class={`seg ${className}`} role="radiogroup">
      {options.map((opt) => (
        <button
          type="button"
          role="radio"
          aria-checked={opt.v === value}
          class={opt.v === value ? "on" : ""}
          onClick={() => {
            haptic();
            onChange(opt.v);
          }}
          key={String(opt.v)}
        >
          <span class="seg-l">{opt.label}</span>
          {opt.sub && <span class="seg-s">{opt.sub}</span>}
        </button>
      ))}
    </div>
  );
}

/** Filter chips, single choice or `multi`; shows `empty` when there is nothing to pick. */
export function ChipPicker({ options, value, onChange, multi = false, empty, class: className = "" }) {
  const isOn = (v) => (multi ? value?.includes(v) : value === v);
  const toggle = (v) => {
    haptic();
    if (!multi) {
      return onChange(v);
    }
    onChange(isOn(v) ? value.filter((name) => name !== v) : [...(value || []), v]);
  };
  return !options.length && empty ? (
    <p class="muted small">{empty}</p>
  ) : (
    <div class={`chips ${className}`}>
      {options.map((opt) => (
        <button
          type="button"
          class={`chip ${isOn(opt.v) ? "on" : ""}`}
          style={opt.color ? { "--c": opt.color, "--ct": contrastText(opt.color) } : null}
          onClick={() => toggle(opt.v)}
          aria-pressed={isOn(opt.v)}
          key={String(opt.v)}
        >
          {opt.color && <i class="dot" />}
          {opt.label}
          {isOn(opt.v) && multi && <Icon n="check" size={14} sw={2.4} />}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label, hint, id }) {
  return (
    <label class="toggle" for={id}>
      <span class="toggle-t">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </span>
      <input
        id={id}
        type="checkbox"
        checked={!!checked}
        onChange={(ev) => {
          haptic();
          onChange(ev.currentTarget.checked);
        }}
      />
      <i class="sw" />
    </label>
  );
}

/** Number with − and + buttons. `format` replaces the default "value + suffix" display. */
export function Stepper({ value, onChange, min = 1, max = 60, step = 1, suffix = "", format, id }) {
  const set = (v) => {
    haptic();
    onChange(Math.max(min, Math.min(max, v)));
  };
  return (
    <div class="stepper" id={id}>
      <button type="button" aria-label={t("common.less")} onClick={() => set(value - step)} disabled={value <= min}>
        <Icon n="minus" size={18} />
      </button>
      <output>
        {format ? (
          format(value)
        ) : (
          <>
            {value}
            {suffix}
          </>
        )}
      </output>
      <button type="button" aria-label={t("common.more")} onClick={() => set(value + step)} disabled={value >= max}>
        <Icon n="plus" size={18} />
      </button>
    </div>
  );
}

export function Field({ label, hint, children, for: htmlFor, class: className = "" }) {
  return (
    <div class={`lab ${className}`}>
      {label && <label for={htmlFor}>{label}</label>}
      {children}
      {hint && <small class="hint">{hint}</small>}
    </div>
  );
}

export function TextInput({ value, onInput, ...rest }) {
  return (
    <input
      class="inp"
      type="text"
      value={value ?? ""}
      onInput={(ev) => onInput(ev.currentTarget.value)}
      autocomplete="off"
      {...rest}
    />
  );
}

export function Select({ value, options, onChange, id }) {
  return (
    <div class="sel">
      <select id={id} value={value ?? ""} onChange={(ev) => onChange(ev.currentTarget.value)}>
        {options.map((opt) => (
          <option value={opt.v} key={opt.v}>
            {opt.label}
          </option>
        ))}
      </select>
      <Icon n="chevD" size={16} />
    </div>
  );
}

/** List row: a button when `onClick` is given, a plain block otherwise. */
export function ListItem({ title, sub, left, right, onClick, chevron = true, class: className = "" }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      class={`li ${onClick ? "li-btn" : ""} ${className}`}
      onClick={onClick}
    >
      {left && <span class="li-l">{left}</span>}
      <span class="li-m">
        <span class="li-t">{title}</span>
        {sub && <span class="li-s">{sub}</span>}
      </span>
      {right && <span class="li-r">{right}</span>}
      {onClick && chevron && <Icon n="chevR" size={18} class="li-c" />}
    </Tag>
  );
}

export function Section({ title, action, children, hint }) {
  return (
    <section class="sect">
      {(title || action) && (
        <header class="sect-h">
          <h3>{title}</h3>
          {action}
        </header>
      )}
      {hint && <p class="muted small sect-hint">{hint}</p>}
      <div class="sect-b">{children}</div>
    </section>
  );
}

export function EmptyState({ icon = "info", title, text, action }) {
  return (
    <div class="empty">
      <Icon n={icon} size={30} />
      <strong>{title}</strong>
      {text && <p>{text}</p>}
      {action}
    </div>
  );
}

export function Badge({ children, tone = "neutral", icon }) {
  return (
    <span class={`badge badge-${tone}`}>
      {icon && <Icon n={icon} size={12} sw={2.2} />}
      {children}
    </span>
  );
}

/** Header of a settings page, with a back button. */
export const PageHeader = ({ title, onBack, right }) => (
  <header class="top">
    <div class="row gap-s center top-l">
      <IconButton n="chevL" label={t("common.back")} onClick={onBack} />
      <div class="top-t">
        <h1>{title}</h1>
      </div>
    </div>
    {right}
  </header>
);
