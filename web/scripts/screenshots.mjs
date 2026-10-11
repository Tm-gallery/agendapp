// Documentation screenshots, made from the example profiles in examples/ and the desktop build
// (dist/AgendApp.html). Uses an installed Chrome, Edge, Brave or Chromium through the DevTools
// protocol, with no extra dependency. Run "npm run build" first.
// Usage: npm run screenshots                      (every profile, English)
//        npm run screenshots -- patrol            (one profile)
//        npm run screenshots -- patrol --lang fr  (French, into docs/screens/fr/)
//        CHROME_PATH=/path/to/chrome npm run screenshots
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "../..");
const APP = path.resolve(here, "../dist/AgendApp.html");
const args = process.argv.slice(2);
const langIndex = args.indexOf("--lang");
const lang = langIndex >= 0 ? args.splice(langIndex, 2)[1] : "en";
const only = args[0];
const EXAMPLES = lang === "en" ? path.join(ROOT, "examples") : path.join(ROOT, "examples", lang);
const OUT = lang === "en" ? path.join(ROOT, "docs/screens") : path.join(ROOT, "docs/screens", lang);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findBrowser() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const pf = process.env.PROGRAMFILES || "C:\\Program Files";
  const pf86 = process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)";
  const local = process.env.LOCALAPPDATA || "";
  const candidates = [
    `${pf}\\Google\\Chrome\\Application\\chrome.exe`,
    `${local}\\Google\\Chrome\\Application\\chrome.exe`,
    `${pf86}\\Microsoft\\Edge\\Application\\msedge.exe`,
    `${pf}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
  const found = candidates.find((p) => p && fs.existsSync(p));
  if (!found) throw new Error("No browser found: set CHROME_PATH");
  return found;
}

async function launch() {
  const port = 9300 + Math.floor(Math.random() * 500);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "agendapp-shots-"));
  const proc = spawn(findBrowser(), [
    "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    "--allow-file-access-from-files", "--hide-scrollbars", "about:blank",
  ], { stdio: "ignore" });
  for (let i = 0; i < 50; i++) {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = pages.find((p) => p.type === "page");
      if (page) return { proc, page, profile };
    } catch {}
    await sleep(200);
  }
  throw new Error("The browser did not start");
}

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((r) => ws.addEventListener("open", r));
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
  });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || expression);
    return r.result?.result?.value;
  };
  return { ws, send, evaluate };
}

// In-page helpers. Navigation uses positions (tabs, rows), so it works in every language.
const HELPERS = `window.__s = {
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  pane: () => document.querySelector('.tabpane:not([hidden])'),
  top: () => [...document.querySelectorAll('#layers .sheet-wrap')].pop(),
  async click(root, sel, index = 0) {
    const scope = root === 'sheet' ? this.top() : root === 'doc' ? document : this.pane();
    const el = scope.querySelectorAll(sel)[index];
    if (!el) throw new Error('not found: ' + sel + ' #' + index);
    el.click();
    await this.sleep(450);
  },
  async tab(index) { await this.click('doc', '.tabbar .tab', index); },
};true`;

// Screens captured for each profile: [name, actions].
const SCREENS = [
  ["01-calendar", "await __s.tab(0)"],
  ["02-day", "await __s.tab(0); __s.pane().querySelector('.dayp')?.scrollIntoView({block:'start'}); await __s.sleep(300)"],
  ["03-new-event", "await __s.tab(0); await __s.click('pane', '.actionbar .btn'); __s.top().querySelector('.chips .chip')?.click(); await __s.sleep(500)"],
  ["04-schedule", "await __s.tab(1); await __s.click('pane', '.modebar .seg button', 1)"],
  ["05-export", "await __s.tab(1); await __s.click('pane', '.actionbar .btn'); await __s.sleep(600)"],
  ["06-settings", "await __s.tab(2)"],
  ["07-event-type", "await __s.tab(2); await __s.click('pane', '.li', 2); await __s.click('pane', '.li'); await __s.sleep(300)"],
  ["08-rules", "await __s.tab(2); await __s.click('pane', '.li', 3)"],
  ["09-per-person", "await __s.tab(0); await __s.click('pane', '.bil-link', 0); await __s.click('sheet', '.bil-h')"],
  ["10-hours-summary", "await __s.tab(2); await __s.click('pane', '.li', 5)"],
];

async function shoot(page, file, profileName, theme) {
  const state = fs.readFileSync(path.join(EXAMPLES, file), "utf8");
  const appUrl = pathToFileURL(APP).href;
  const dir = path.join(OUT, profileName);
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, actions] of SCREENS) {
    // Same starting point for every screen.
    await page.send("Page.navigate", { url: appUrl });
    await sleep(800);
    const withTheme = { ...JSON.parse(state), settings: { ...JSON.parse(state).settings, theme, lang } };
    await page.evaluate(`localStorage.clear(); localStorage.setItem('pam-agenda:v1', ${JSON.stringify(JSON.stringify(withTheme))}); localStorage.setItem('pam-agenda:tab', '"cal"'); true`);
    await page.send("Page.reload");
    await sleep(1200);
    await page.evaluate(HELPERS);
    try {
      await page.evaluate(`(async () => { ${actions}; await __s.sleep(400); })()`);
    } catch (e) {
      console.warn(`  ${name} : ${e.message.split("\n")[0]}`);
      continue;
    }
    const shot = await page.send("Page.captureScreenshot", { format: "png" });
    const suffix = theme === "dark" ? "-dark" : "";
    fs.writeFileSync(path.join(dir, `${name}${suffix}.png`), Buffer.from(shot.result.data, "base64"));
  }
}

if (!fs.existsSync(APP)) throw new Error("dist/AgendApp.html is missing: run \"npm run build\" first");
const { proc, page: target, profile } = await launch();
const page = await connect(target.webSocketDebuggerUrl);
await page.send("Page.enable");
await page.send("Runtime.enable");
await page.send("Emulation.setDeviceMetricsOverride", { width: 412, height: 915, deviceScaleFactor: 2, mobile: true });
try {
  const files = fs.readdirSync(EXAMPLES).filter((f) => f.endsWith(".json") && (!only || f.startsWith(only)));
  for (const file of files) {
    const name = file.replace(/\.json$/, "");
    console.log(name);
    await shoot(page, file, name, "light");
    await shoot(page, file, name, "dark");
  }
} finally {
  page.ws.close();
  proc.kill();
  await sleep(500);
  fs.rmSync(profile, { recursive: true, force: true });
}
console.log(`Screenshots in ${path.relative(process.cwd(), OUT)}`);
