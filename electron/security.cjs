const crypto = require("node:crypto");

const API_TOKEN_HEADER = "X-Cutout-Token";

// Fresh secret per launch. It goes to the backend we spawn (environment) and to
// the network layer below; the renderer never sees it.
function createApiToken() {
  return crypto.randomBytes(32).toString("hex");
}

// Only plain https links may leave the app. file:, ms-msdt:, search-ms: and other
// protocol handlers are refused, because shell.openExternal would hand them to Windows.
function isSafeExternalUrl(value) {
  try {
    return new URL(String(value)).protocol === "https:";
  } catch {
    return false;
  }
}

// The window may only ever show the app itself: the exact built index.html in a
// packaged app (any hash or query), or the Vite dev origin.
function isAppUrl(value, appUrl) {
  try {
    const target = new URL(String(value));
    const app = new URL(String(appUrl));
    if (app.protocol === "file:") {
      return target.protocol === "file:" && target.pathname === app.pathname;
    }
    return target.origin === app.origin;
  } catch {
    return false;
  }
}

// Adds the token to every request the app's own pages make to the local API,
// <img> loads and streaming included, which could not set a header themselves.
function installApiAuthHeader(electronSession, token, apiOrigin) {
  electronSession.webRequest.onBeforeSendHeaders({ urls: [`${apiOrigin}/*`] }, (details, callback) => {
    callback({ requestHeaders: { ...details.requestHeaders, [API_TOKEN_HEADER]: token } });
  });
}

module.exports = {
  API_TOKEN_HEADER,
  createApiToken,
  installApiAuthHeader,
  isAppUrl,
  isSafeExternalUrl,
};
