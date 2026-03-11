import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const localesDir = path.join(
  repoRoot,
  "node_modules",
  "@react-native",
  "debugger-frontend",
  "dist",
  "third-party",
  "front_end",
  "core",
  "i18n",
  "locales"
);
const i18nPath = path.join(
  repoRoot,
  "node_modules",
  "@react-native",
  "debugger-frontend",
  "dist",
  "third-party",
  "front_end",
  "core",
  "i18n",
  "i18n.js"
);
const fallbackLocale = "en-US";

function readSupportedLocales(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const source = fs.readFileSync(filePath, "utf8");
  const match = source.match(/new t\.I18n\.I18n\(\[([^\]]+)\],"en-US"\)/);
  if (!match) {
    return [];
  }

  return match[1]
    .split(",")
    .map((entry) => entry.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);
}

function ensureLocaleAliases() {
  if (!fs.existsSync(localesDir)) {
    return;
  }

  const fallbackPath = path.join(localesDir, `${fallbackLocale}.json`);
  if (!fs.existsSync(fallbackPath)) {
    return;
  }

  const fallbackContents = fs.readFileSync(fallbackPath);
  const supportedLocales = readSupportedLocales(i18nPath);

  for (const locale of supportedLocales) {
    const localePath = path.join(localesDir, `${locale}.json`);
    if (fs.existsSync(localePath)) {
      continue;
    }
    fs.writeFileSync(localePath, fallbackContents);
  }
}

ensureLocaleAliases();
