// Run with: npm run test:electron   (uses Node's built-in test runner, no extra packages)
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  API_TOKEN_HEADER,
  createApiToken,
  denyAllPermissions,
  installApiAuthHeader,
  isAppUrl,
  isSafeExternalUrl,
} = require("../electron/security.cjs");

test("browser permissions are refused", () => {
  let requestHandler = null;
  let checkHandler = null;
  denyAllPermissions({
    setPermissionRequestHandler(handler) { requestHandler = handler; },
    setPermissionCheckHandler(handler) { checkHandler = handler; },
  });
  let granted = null;
  requestHandler({}, "media", (value) => { granted = value; });
  assert.equal(granted, false);
  assert.equal(checkHandler({}, "geolocation"), false);
});

test("external links: only https is allowed", () => {
  assert.equal(isSafeExternalUrl("https://example.com/docs"), true);
  for (const bad of [
    "http://example.com",
    "file:///C:/Windows/System32/calc.exe",
    "ms-msdt:/id PCWDiagnostic",
    "search-ms:query=x&crumb=location:\\\\evil\\share",
    "javascript:alert(1)",
    "data:text/html,<script>1</script>",
    "not a url",
    "",
    null,
    undefined,
  ]) {
    assert.equal(isSafeExternalUrl(bad), false, `should refuse ${String(bad)}`);
  }
});

test("packaged app: only its own index.html may be shown", () => {
  const app = "file:///C:/Program%20Files/Cutout%20Studio/resources/app/editor-ui/dist/index.html";
  assert.equal(isAppUrl(app, app), true);
  assert.equal(isAppUrl(`${app}#/editor`, app), true);
  assert.equal(isAppUrl("file:///C:/Users/me/Downloads/page.html", app), false); // dropped file
  assert.equal(isAppUrl("file:///C:/Users/me/Pictures/photo.png", app), false);
  // Same path on another machine (UNC): must not pass as the app.
  assert.equal(isAppUrl("file://evil/C:/Program%20Files/Cutout%20Studio/resources/app/editor-ui/dist/index.html", app), false);
  assert.equal(isAppUrl("https://example.com/", app), false);
  assert.equal(isAppUrl("garbage", app), false);
});

test("dev app: only the Vite origin may be shown", () => {
  const app = "http://127.0.0.1:5173";
  assert.equal(isAppUrl("http://127.0.0.1:5173/", app), true);
  assert.equal(isAppUrl("http://127.0.0.1:5173/some/path?x=1", app), true);
  assert.equal(isAppUrl("http://127.0.0.1:7421/config", app), false);
  assert.equal(isAppUrl("http://127.0.0.1:5173.evil.example/", app), false);
  assert.equal(isAppUrl("file:///C:/x.html", app), false);
});

test("tokens are long, hex and different every launch", () => {
  const a = createApiToken();
  const b = createApiToken();
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, b);
});

test("auth header is added to API requests and keeps the others", () => {
  let registered = null;
  const fakeSession = {
    webRequest: {
      onBeforeSendHeaders(filter, listener) {
        registered = { filter, listener };
      },
    },
  };
  installApiAuthHeader(fakeSession, "secret", "http://127.0.0.1:53124");
  assert.deepEqual(registered.filter.urls, ["http://127.0.0.1:53124/*"]);

  let result = null;
  registered.listener({ requestHeaders: { Accept: "image/*" } }, (value) => {
    result = value;
  });
  assert.equal(result.requestHeaders[API_TOKEN_HEADER], "secret");
  assert.equal(result.requestHeaders.Accept, "image/*");
});
