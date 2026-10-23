"use strict";

// Renderer requests an identifier, never a URL. These official setup pages are
// opened in the user's browser; no credentials are handled by this helper.
const PAGES = Object.freeze({
  openai: Object.freeze({
    keys: "https://platform.openai.com/api-keys",
    docs: "https://developers.openai.com/api/docs/quickstart",
    pricing: "https://developers.openai.com/api/docs/pricing",
  }),
  deepseek: Object.freeze({
    keys: "https://platform.deepseek.com/",
    docs: "https://api-docs.deepseek.com/",
    pricing: "https://api-docs.deepseek.com/quick_start/pricing/",
  }),
  gemini: Object.freeze({
    keys: "https://aistudio.google.com/apikey",
    docs: "https://ai.google.dev/gemini-api/docs/openai",
    pricing: "https://ai.google.dev/gemini-api/docs/pricing",
  }),
  doubao: Object.freeze({
    keys: "https://ark.volcengine.com/region:cn-beijing/apikey",
    docs: "https://docs.volcengine.com/docs/ark/integrate-third-party-tools?lang=zh",
    pricing: "https://docs.volcengine.com/docs/ark/model-pricing?lang=zh",
  }),
});

function helpUrl(provider, page = "docs") {
  if (typeof provider !== "string" || typeof page !== "string" ||
      !Object.hasOwn(PAGES, provider) || !Object.hasOwn(PAGES[provider], page)) {
    throw new Error("请选择支持的服务和官方帮助页面。");
  }
  return PAGES[provider][page];
}

module.exports = { helpUrl };
