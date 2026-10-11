// Saving and sharing files. When the page is hosted by Claude (window.claude.use: downloads,
// connectors) those services are used; otherwise files are regular browser downloads. In the
// Android app, downloads and sharing go through the Android bridge.
let hostPromise = null;

/**
 * Capabilities of the current host: { downloads, mcp, gcal (direct calendar sending), hosted,
 * native (Android app, where direct sending targets the phone's calendar) }.
 */
export function getHost() {
  return (
    hostPromise ||
    ((hostPromise = (async () => {
      const host = {
        downloads: null,
        mcp: null,
        gcal: false,
        hosted: false,
        native: typeof window !== "undefined" && !!window.AndroidBridge,
      };
      const claude = typeof window !== "undefined" ? window.claude : null;
      if (!claude || typeof claude.use != "function") {
        return host;
      }
      host.hosted = true;
      try {
        host.downloads = await claude.use("downloads");
      } catch {}
      try {
        host.mcp = await claude.use("mcp");
      } catch {}
      if (host.mcp) {
        try {
          const listing = await host.mcp.listTools("Google Calendar");
          host.gcal = !!listing?.servers?.some(
            (server) =>
              server.server === "Google Calendar" &&
              (server.tools?.length || server.authStatus === "unknown"),
          );
        } catch {
          host.gcal = false;
        }
      }
      return host;
    })()),
    hostPromise)
  );
}

const HOST_SAVE_EXTENSIONS = [
  "gif",
  "png",
  "jpg",
  "jpeg",
  "webp",
  "mp4",
  "webm",
  "txt",
  "json",
  "md",
  "docx",
  "pptx",
  "epub",
  "csv",
  "ttf",
  "html",
  "svg",
  "pdf",
  "xlsx",
  "zip",
];

const fileExtension = (filename) => (filename.split(".").pop() || "").toLowerCase();

/** Saves a file. Returns "saved", "declined" or "unsupported". */
export async function saveFile(host, { filename, data, mime = "application/octet-stream" }) {
  if (host?.downloads) {
    if (!HOST_SAVE_EXTENSIONS.includes(fileExtension(filename))) {
      return "unsupported";
    }
    try {
      await host.downloads.save({ filename, data });
      return "saved";
    } catch (err) {
      if (err?.code === "declined") {
        return "declined";
      }
      throw err;
    }
  }
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4_000);
  return "saved";
}

/** Opens the system share sheet with a file. Returns "saved", "declined" or "unsupported". */
export async function shareFile({ filename, data, mime }) {
  const file = new File([data], filename, { type: mime });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return "saved";
    } catch (err) {
      return err?.name === "AbortError" ? "declined" : "unsupported";
    }
  }
  return "unsupported";
}

export const canShareFiles = () => {
  try {
    return !!(
      navigator.canShare &&
      navigator.canShare({ files: [new File(["x"], "a.ics", { type: "text/calendar" })] })
    );
  } catch {
    return false;
  }
};
