import { StrictMode, useState, useEffect, useCallback } from "react";
import { createRoot } from "react-dom/client";
import Editor from "./Editor.jsx";
import Input from "./Input.jsx";
import Pipeline from "./Pipeline.jsx";
import Templates from "./Templates.jsx";
import Settings from "./Settings.jsx";
import "./index.css";

const TABS = [
  { id: "input", label: "Input" },
  { id: "pipeline", label: "Process" },
  { id: "editor", label: "Editor" },
  { id: "templates", label: "Templates" },
  { id: "settings", label: "Settings" },
];

export function Root() {
  const [screen, setScreen] = useState("input");
  const [theme, setTheme] = useState("dark");
  const [mountedScreens, setMountedScreens] = useState(() => new Set(["input"]));

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.settings?.appearance?.theme) setTheme(data.settings.appearance.theme);
      })
      .catch(() => {});
  }, []);

  const [inputDir, setInputDir] = useState("");
  const [outputDir, setOutputDir] = useState("");
  const [excludeTags, setExcludeTags] = useState([]);
  const [thumbs, setThumbs] = useState([]);
  const [removedImages, setRemovedImages] = useState(new Set());
  const [editorSettings, setEditorSettings] = useState({ canvasSize: 1440, thumbnail: true });
  const [editorKey, setEditorKey] = useState(0);
  const primaryTabs = TABS.slice(0, 3);
  const secondaryTabs = TABS.slice(3);

  const openScreen = useCallback((next) => {
    setMountedScreens((prev) => {
      if (prev.has(next)) return prev;
      const updated = new Set(prev);
      updated.add(next);
      return updated;
    });
    setScreen(next);
  }, []);

  // BUG-11 FIX: theme toggle must read current settings, patch appearance.theme, then save full settings.
  const handleThemeToggle = async () => {
    const newTheme = theme === "dark" ? "light" : "dark";
    setTheme(newTheme);
    try {
      const r = await fetch("/api/settings");
      const data = r.ok ? await r.json() : { settings: {} };
      const current = data?.settings ?? {};
      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: {
            ...current,
            appearance: { ...(current.appearance ?? {}), theme: newTheme },
          },
        }),
      });
    } catch {
      void 0;
    }
  };

  return (
    <div
      className="app-shell"
      data-theme={theme}
      style={{
        display: "flex",
        height: "100vh",
        overflow: "hidden",
        background: "var(--bg)",
        color: "var(--text)",
      }}
    >
      <aside className="app-sidebar">
        <div className="app-header app-logo">
          <svg className="app-logo-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.2">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
            <polyline points="7.5 4.21 12 6.81 16.5 4.21" />
            <polyline points="7.5 19.79 7.5 14.6 3 12" />
            <polyline points="21 12 16.5 14.6 16.5 19.79" />
            <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
            <line x1="12" y1="22.08" x2="12" y2="12" />
          </svg>
          <div>
            <div className="app-title">Image Pipeline Pro</div>
            <div className="app-version">v2.0</div>
          </div>
        </div>

        <nav className="app-tabs">
          {primaryTabs.map((tab, i) => {
            const active = screen === tab.id;
            return (
              <button key={tab.id} className={active ? "app-tab app-tab-active" : "app-tab"} onClick={() => openScreen(tab.id)}>
                <span className="app-tab-index">{String(i + 1).padStart(2, "0")}</span>
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>

        <nav className="app-tabs app-tabs-secondary">
          {secondaryTabs.map((tab) => {
            const active = screen === tab.id;
            return (
              <button key={tab.id} className={active ? "app-tab app-tab-active" : "app-tab"} onClick={() => openScreen(tab.id)}>
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>

        <button className="app-theme-toggle" onClick={handleThemeToggle}>
          Theme: {theme === "dark" ? "Dark" : "Light"}
        </button>
      </aside>

      <main className="app-main">
        {mountedScreens.has("input") && (
          <div className="app-screen" style={{ flex: 1, minHeight: 0, display: screen === "input" ? "flex" : "none", flexDirection: "column" }}>
            <Input
              inputDir={inputDir}
              setInputDir={setInputDir}
              thumbs={thumbs}
              setThumbs={setThumbs}
              excludeTags={excludeTags}
              setExcludeTags={setExcludeTags}
              removedImages={removedImages}
              setRemovedImages={setRemovedImages}
              onGoToProcess={() => openScreen("pipeline")}
            />
          </div>
        )}

        {mountedScreens.has("pipeline") && (
          <div className="app-screen" style={{ flex: 1, minHeight: 0, display: screen === "pipeline" ? "flex" : "none", flexDirection: "column" }}>
            {/* BUG-18 FIX: Pipeline now receives onGoToTemplates and no longer ignores it. */}
            <Pipeline
              inputDir={inputDir}
              setInputDir={setInputDir}
              outputDir={outputDir}
              setOutputDir={setOutputDir}
              excludeTags={excludeTags}
              removedImages={removedImages}
              onGoToEditor={(s) => {
                setEditorSettings(s);
                setEditorKey((k) => k + 1);
                openScreen("editor");
              }}
              onPipelineDone={(s) => {
                setEditorSettings(s);
              }}
              onGoToTemplates={() => openScreen("templates")}
            />
          </div>
        )}

        {mountedScreens.has("templates") && (
          <div className="app-screen" style={{ flex: 1, minHeight: 0, display: screen === "templates" ? "flex" : "none", flexDirection: "column" }}>
            <Templates onBack={() => openScreen("pipeline")} />
          </div>
        )}

        {mountedScreens.has("editor") && (
          <div className="app-screen" style={{ flex: 1, minHeight: 0, display: screen === "editor" ? "flex" : "none", flexDirection: "column" }}>
            <Editor
              key={editorKey}
              onGoPipeline={() => openScreen("pipeline")}
              outputDir={outputDir}
              canvasSize={editorSettings.canvasSize}
              thumbnail={editorSettings.thumbnail}
            />
          </div>
        )}

        {mountedScreens.has("settings") && (
          <div className="app-screen" style={{ flex: 1, minHeight: 0, display: screen === "settings" ? "flex" : "none", flexDirection: "column" }}>
            <Settings onThemeChange={setTheme} />
          </div>
        )}
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <Root />
  </StrictMode>
);
