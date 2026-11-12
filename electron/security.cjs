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
      // Host too: file://server/C:/... is a UNC path on another machine.
      return target.protocol === "file:" && target.host === app.host && target.pathname === app.pathname;
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

// The app needs no browser permission (camera, microphone, location, notifications...).
// Electron grants them by default, so refuse every request and every check.
function denyAllPermissions(electronSession) {
  electronSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  electronSession.setPermissionCheckHandler(() => false);
}

module.exports = {
  API_TOKEN_HEADER,
  createApiToken,
  denyAllPermissions,
  installApiAuthHeader,
  isAppUrl,
  isSafeExternalUrl,
};
