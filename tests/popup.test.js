"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const POPUP_HTML = fs.readFileSync(
  path.join(__dirname, "..", "extension", "popup.html"),
  "utf8"
);

function loadPopup() {
  const dom = new JSDOM(POPUP_HTML);
  return dom.window.document;
}

test("popup: html has a lang attribute", () => {
  const doc = loadPopup();
  assert.equal(doc.documentElement.getAttribute("lang"), "en");
});

test("popup: status region is a polite live region", () => {
  const doc = loadPopup();
  const status = doc.getElementById("status");
  assert.ok(status, "status element exists");
  assert.equal(status.getAttribute("role"), "status");
  assert.equal(status.getAttribute("aria-live"), "polite");
});

test("popup: Always Expand checkbox has a programmatic accessible name", () => {
  const doc = loadPopup();
  const cb = doc.getElementById("alwaysExpandToggle");
  assert.ok(cb, "checkbox exists");
  const labelledby = cb.getAttribute("aria-labelledby");
  assert.ok(labelledby, "checkbox is associated with a label via aria-labelledby");
  const labelEl = doc.getElementById(labelledby);
  assert.ok(labelEl, "the referenced label element exists");
  assert.ok(labelEl.textContent.trim().length > 0, "the label has visible text");
});

test("popup: both action buttons exist with clear text", () => {
  const doc = loadPopup();
  const expand = doc.getElementById("expandBtn");
  const collapse = doc.getElementById("collapseBtn");
  assert.match(expand.textContent, /expand/i);
  assert.match(collapse.textContent, /collapse/i);
});

test("popup: disabled buttons are styled (feedback during expand)", () => {
  // Asserted at the source level: a :disabled rule must exist.
  assert.match(POPUP_HTML, /\.btn:disabled/);
});
