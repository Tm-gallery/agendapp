// Material Symbols Rounded icons, converted to a 24×24 viewBox by build.mjs (icons.gen.json).
// Short names (calendar, gear, plus…) are mapped to symbol names in build.mjs.
import ICON_PATHS from "./icons.gen.json";

export function Icon({ n: name, size = 20, class: className = "", sw = 1.8 }) {
  return (
    <svg
      class={`ico ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width={sw}
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d={ICON_PATHS[name] || ICON_PATHS.info} />
    </svg>
  );
}

