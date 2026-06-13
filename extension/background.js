// FT Expand All Comments — badge service worker (v2.3)
// Shows a per-tab toolbar badge with the number of comments expanded on that
// tab (manual or Always Expand). Purely cosmetic: no state lives here.
"use strict";

const badgeTimers = new Map(); // tabId -> timeout handle

chrome.runtime.onMessage.addListener((message, sender) => {
  if (!message || message.type !== "ft-expand-badge") return;
  const tabId = sender && sender.tab && sender.tab.id;
  if (typeof tabId !== "number") return;

  const count = Number(message.count) || 0;
  const text = count > 0 ? (count > 999 ? "1k+" : String(count)) : "";
  try {
    chrome.action.setBadgeBackgroundColor({ color: "#0d7680", tabId });
    chrome.action.setBadgeText({ tabId, text }).catch(() => {});
  } catch (_) {}

  // Clear after a few seconds — the badge is a confirmation, not a counter UI.
  if (badgeTimers.has(tabId)) clearTimeout(badgeTimers.get(tabId));
  const timer = setTimeout(() => {
    badgeTimers.delete(tabId);
    try {
      chrome.action.setBadgeText({ tabId, text: "" }).catch(() => {});
    } catch (_) {}
  }, 8000);
  badgeTimers.set(tabId, timer);
});
