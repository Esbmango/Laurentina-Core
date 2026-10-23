"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { helpUrl } = require("./provider_help.cjs");

test("provider help only opens fixed official HTTPS destinations", () => {
  for (const provider of ["openai", "deepseek", "gemini", "doubao"]) {
    for (const page of ["keys", "docs", "pricing"]) {
      const url = new URL(helpUrl(provider, page));
      assert.equal(url.protocol, "https:");
      assert.equal(url.username + url.password + url.hash, "");
    }
  }
  for (const value of ["__proto__", "constructor", "toString", "https://example.com", "file:///C:/Windows", {}, null]) {
    assert.throws(() => helpUrl(value));
    assert.throws(() => helpUrl("openai", value));
  }
});
