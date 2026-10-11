// Checks the translation catalogs: every key used in src/ exists in English, every catalog has the
// same keys as English, and placeholders match. Run with: npm run check:i18n
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, "../src");
const load = async (name) => (await import(pathToFileURL(path.join(src, "i18n", name)).href)).default;
const catalogs = { en: await load("en.js"), fr: await load("fr.js") };
const en = catalogs.en;
const namespaces = new Set(Object.keys(en).map((key) => key.split(".")[0]));

const files = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(js|jsx)$/.test(entry.name) && !full.includes(`${path.sep}i18n${path.sep}`)) files.push(full);
  }
};
walk(src);

let errors = 0;
const fail = (message) => {
  errors++;
  console.error("✗ " + message);
};

// Keys written literally, e.g. t("plan.title") or t(cond ? "a.b" : "a.c").
const used = new Set();
for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  for (const [, key] of text.matchAll(/["'`]([a-z]+(?:\.[A-Za-z0-9_/-]+)+)["'`]/g)) {
    if (namespaces.has(key.split(".")[0]) && !/\.(js|jsx|json|css)$/.test(key)) {
      used.add(key);
      if (!(key in en)) fail(`${path.relative(src, file)}: unknown key "${key}"`);
    }
  }
  // Keys built at runtime, e.g. t(`fields.kind.${kind}`): at least one key must match the pattern.
  for (const [, pattern] of text.matchAll(/\bt\(`([^`]+)`/g)) {
    const regex = new RegExp("^" + pattern.replace(/\./g, "\\.").replace(/\$\{[^}]+\}/g, "[^.]+?") + "$");
    const matches = Object.keys(en).filter((key) => regex.test(key));
    if (!matches.length) fail(`${path.relative(src, file)}: no key matches \`${pattern}\``);
    matches.forEach((key) => used.add(key));
  }
}

const placeholders = (value) =>
  typeof value === "string" ? [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",") : null;

for (const [lang, catalog] of Object.entries(catalogs)) {
  if (lang === "en") continue;
  for (const key of Object.keys(en)) {
    if (!(key in catalog)) fail(`${lang}: missing "${key}"`);
    else if (typeof en[key] !== typeof catalog[key] && typeof en[key] !== "function" && typeof catalog[key] !== "function")
      fail(`${lang}: "${key}" has a different kind of value`);
    else if (typeof en[key] === "string" && typeof catalog[key] === "string" && placeholders(en[key]) !== placeholders(catalog[key]))
      console.warn(`! ${lang}: "${key}" placeholders differ ({${placeholders(en[key])}} vs {${placeholders(catalog[key])}})`);
  }
  for (const key of Object.keys(catalog)) if (!(key in en)) fail(`${lang}: extra key "${key}"`);
}

const unused = Object.keys(en).filter((key) => !used.has(key) && !/^(tz|color)\./.test(key));
if (unused.length) console.warn(`! unused keys: ${unused.join(", ")}`);

console.log(errors ? `${errors} problem(s)` : `OK: ${Object.keys(en).length} keys, ${Object.keys(catalogs).length} languages`);
process.exit(errors ? 1 : 0);
