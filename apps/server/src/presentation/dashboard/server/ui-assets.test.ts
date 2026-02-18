import { describe, expect, test } from "bun:test";
import { getUiAssets } from "@/presentation/dashboard/server/ui-assets";

const STYLES_URL_RE = /^\/_\/dashboard\/assets\/styles\.css\?v=[a-z0-9]+$/;
const ENHANCED_STYLES_URL_RE =
  /^\/_\/dashboard\/assets\/styles-enhanced\.css\?v=[a-z0-9]+$/;
const CLIENT_URL_RE = /^\/_\/dashboard\/assets\/client\.js\?v=[a-z0-9]+$/;

describe("getUiAssets", () => {
  test("returns versioned dashboard asset URLs", () => {
    const assets = getUiAssets();
    expect(assets.stylesHref).toMatch(STYLES_URL_RE);
    expect(assets.stylesEnhancedHref).toMatch(ENHANCED_STYLES_URL_RE);
    expect(assets.clientEntry).toMatch(CLIENT_URL_RE);
  });
});
