"use strict";

const { JSDOM } = require("jsdom");

/**
 * Factory that returns a fresh jsdom window per call. Passed into buildThread so
 * each test gets an isolated DOM.
 */
function makeWindow(html = "<!DOCTYPE html><html><body></body></html>") {
  const dom = new JSDOM(html, { url: "https://www.ft.com/content/test-article" });
  return { window: dom.window, dom };
}

/**
 * Minimal in-memory chrome.* stub sufficient to load content.js as a real
 * content script under jsdom. Captures registered listeners so tests can drive
 * the message + storage paths.
 */
function makeChromeStub(initialStorage = {}) {
  const store = Object.assign({}, initialStorage);
  const messageListeners = [];
  const storageChangeListeners = [];
  let lastError = null;

  const chrome = {
    runtime: {
      get lastError() {
        return lastError;
      },
      onMessage: {
        addListener: (fn) => messageListeners.push(fn),
      },
    },
    storage: {
      sync: {
        get: (keys, cb) => {
          const keyList = Array.isArray(keys) ? keys : [keys];
          const out = {};
          keyList.forEach((k) => {
            if (k in store) out[k] = store[k];
          });
          // async-ish but synchronous enough for tests
          cb(out);
        },
        set: (obj, cb) => {
          const changes = {};
          Object.keys(obj).forEach((k) => {
            changes[k] = { oldValue: store[k], newValue: obj[k] };
            store[k] = obj[k];
          });
          if (cb) cb();
          storageChangeListeners.forEach((fn) => fn(changes, "sync"));
        },
      },
      onChanged: {
        addListener: (fn) => storageChangeListeners.push(fn),
      },
    },
  };

  /** Simulate the popup sending a message; returns a Promise of the response. */
  function sendMessage(message) {
    return new Promise((resolve) => {
      let answered = false;
      const sendResponse = (resp) => {
        if (!answered) {
          answered = true;
          resolve(resp);
        }
      };
      let keptOpen = false;
      messageListeners.forEach((fn) => {
        const r = fn(message, { id: "popup" }, sendResponse);
        if (r === true) keptOpen = true;
      });
      // If no listener kept the channel open and none responded, resolve undefined.
      if (!keptOpen && !answered) resolve(undefined);
    });
  }

  return {
    chrome,
    sendMessage,
    store,
    messageListeners,
    storageChangeListeners,
    setStorage: (obj, fireChange = true) => {
      const changes = {};
      Object.keys(obj).forEach((k) => {
        changes[k] = { oldValue: store[k], newValue: obj[k] };
        store[k] = obj[k];
      });
      if (fireChange) storageChangeListeners.forEach((fn) => fn(changes, "sync"));
    },
    _setLastError: (e) => (lastError = e),
  };
}

const path = require("path");
const CONTENT_PATH = path.join(__dirname, "..", "extension", "content.js");

/**
 * Load content.js as if it were a real content script: wire jsdom globals and a
 * chrome stub, then require it fresh (bypassing the module cache so each test
 * gets isolated closure state). Returns the pure api plus the chrome stub.
 */
function loadContentScript(window, chrome) {
  const g = globalThis;
  const saved = {
    window: g.window,
    document: g.document,
    chrome: g.chrome,
    MutationObserver: g.MutationObserver,
    Node: g.Node,
    Event: g.Event,
    console: g.console,
  };

  g.window = window;
  g.document = window.document;
  g.chrome = chrome;
  g.MutationObserver = window.MutationObserver;
  g.Node = window.Node;
  g.Event = window.Event;

  delete require.cache[require.resolve(CONTENT_PATH)];
  const api = require(CONTENT_PATH);

  function restore() {
    if (typeof window.__ftExpandTeardown === "function") {
      try {
        window.__ftExpandTeardown();
      } catch (_) {}
    }
    Object.assign(g, saved);
    delete require.cache[require.resolve(CONTENT_PATH)];
  }

  return { api, restore };
}

/** Load just the pure helpers (no chrome, no runtime timers). */
function loadPureApi() {
  delete require.cache[require.resolve(CONTENT_PATH)];
  const savedChrome = globalThis.chrome;
  globalThis.chrome = undefined; // force the runtime branch off
  const api = require(CONTENT_PATH);
  globalThis.chrome = savedChrome;
  delete require.cache[require.resolve(CONTENT_PATH)];
  return api;
}

module.exports = { makeWindow, makeChromeStub, loadContentScript, loadPureApi, CONTENT_PATH };
