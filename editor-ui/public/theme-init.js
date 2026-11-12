// Set the theme before first paint so there is no light flash.
// External file (not inline) because the production CSP forbids inline scripts.
// Same storage key as src/main.jsx.
(function () {
  var theme = "dark";
  try {
    var saved = window.localStorage.getItem("image-pipeline-theme");
    if (saved === "light" || saved === "dark") theme = saved;
  } catch { /* storage unavailable */ }
  document.documentElement.setAttribute("data-theme", theme);
})();
