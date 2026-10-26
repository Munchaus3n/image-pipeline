import { StrictMode, useState, useEffect, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import Editor from "./Editor.jsx";
import Input from "./Input.jsx";
import Pipeline from "./Pipeline.jsx";
import Templates from "./Templates.jsx";
import Settings from "./Settings.jsx";
import { getSettings, patchSettings } from "./api.js";
import "./index.css";

const TABS = [
  { id: "input", label: "Input", hint: "Select source folder" },
  { id: "pipeline", label: "Process", hint: "Configure pipeline" },
  { id: "editor", label: "Editor", hint: "Review and export" },
  { id: "templates", label: "Templates" },
  { id: "settings", label: "Settings" },
];

const RECENT_LIMIT = 8;
const THEME_STORAGE_KEY = "image-pipeline-theme";

function normalizeTheme(value) {
  return value === "light" || value === "dark" ? value : "";
}

function loadStoredTheme() {
  try {
    return normalizeTheme(window.localStorage.getItem(THEME_STORAGE_KEY)) || "dark";
  } catch {
    return "dark";
  }
}

function saveStoredTheme(value) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, value);
  } catch {
    void 0;
  }
}

function recentFolders(path, current = []) {
  const value = String(path || "").trim();
  if (!value) return current;
  return [value, ...current.filter((item) => item !== value)].slice(0, RECENT_LIMIT);
}

function sameList(a, b) {
  return a.length === b.length && a.every((item, i) => item === b[i]);
}

// Recent-folder list mirrored in a ref so remember() stays stable and the
// settings save happens outside the (pure) state updater.
function useRecentFolders(settingsKey) {
  const [recent, setRecent] = useState([]);
  const recentRef = useRef(recent);

  const load = useCallback((list) => {
    recentRef.current = list;
    setRecent(list);
  }, []);

  const remember = useCallback((path) => {
    const prev = recentRef.current;
    const next = recentFolders(path, prev);
    if (sameList(prev, next)) return;
    recentRef.current = next;
    setRecent(next);
    patchSettings({ output: { [settingsKey]: next } }).catch(() => {});
  }, [settingsKey]);

  return [recent, remember, load];
}

export function Root() {
  const [screen, setScreen] = useState("input");
  const [theme, setTheme] = useState(loadStoredTheme);
  const [mountedScreens, setMountedScreens] = useState(() => new Set(["input"]));
  const [inputDir, setInputDir] = useState("");
  const [outputDir, setOutputDir] = useState("");
  // Output folder the Editor follows. Only updated on blur / Browse / Recent pick / run,
  // so typing in Process › Output folder does not reload (and clear) the Editor session.
  const [committedOutputDir, setCommittedOutputDir] = useState("");
  const [recentInputDirs, rememberInputDir, loadRecentInputDirs] = useRecentFolders("recent_input_dirs");
  const [recentOutputDirs, rememberRecentOutputDir, loadRecentOutputDirs] = useRecentFolders("recent_output_dirs");

  useEffect(() => {
    getSettings()
      .then((settings) => {
        if (!settings) return;
        const savedTheme = normalizeTheme(settings.appearance?.theme);
        if (savedTheme) {
          setTheme(savedTheme);
          saveStoredTheme(savedTheme);
        }
        if (typeof settings.output?.input_dir === "string") setInputDir(settings.output.input_dir);
        if (typeof settings.output?.output_dir === "string") {
          setOutputDir(settings.output.output_dir);
          setCommittedOutputDir(settings.output.output_dir);
        }
        if (Array.isArray(settings.output?.recent_input_dirs)) loadRecentInputDirs(settings.output.recent_input_dirs);
        if (Array.isArray(settings.output?.recent_output_dirs)) loadRecentOutputDirs(settings.output.recent_output_dirs);
      })
      .catch(() => {});
  }, [loadRecentInputDirs, loadRecentOutputDirs]);

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

  const rememberOutputDir = useCallback((path) => {
    setCommittedOutputDir(String(path ?? ""));
    rememberRecentOutputDir(path);
  }, [rememberRecentOutputDir]);

  const persistTheme = useCallback(async (newTheme) => {
    const normalized = normalizeTheme(newTheme) || "dark";
    setTheme(normalized);
    saveStoredTheme(normalized);
    try {
      await patchSettings({ appearance: { theme: normalized } });
    } catch {
      void 0;
    }
  }, []);

  // BUG-11 FIX: theme toggle only patches appearance.theme; the server merges it into saved settings.
  const handleThemeToggle = useCallback(() => {
    persistTheme(theme === "dark" ? "light" : "dark");
  }, [persistTheme, theme]);

  const handleSettingsThemeChange = useCallback((newTheme) => {
    const normalized = normalizeTheme(newTheme);
    if (!normalized) return;
    setTheme(normalized);
    saveStoredTheme(normalized);
  }, []);

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
          <div className="app-logo-mark" aria-hidden="true"><span /></div>
          <div>
            <div className="app-title">Cutout Studio</div>
            <div className="app-version">Product image workflow</div>
          </div>
        </div>

        <nav className="app-tabs">
          {primaryTabs.map((tab, i) => {
            const active = screen === tab.id;
            const status = active ? "Active" : mountedScreens.has(tab.id) ? "Ready" : "Idle";
            return (
              <button
                key={tab.id}
                className={active ? "app-tab app-tab-active" : "app-tab"}
                onClick={() => openScreen(tab.id)}
                aria-current={active ? "page" : undefined}
              >
                <span className="app-tab-meta">
                  <span className="app-tab-step">{String(i + 1).padStart(2, "0")}</span>
                  <span className="app-tab-status">{status}</span>
                </span>
                <span className="app-tab-copy">
                  <span className="app-tab-label">{tab.label}</span>
                  <span className="app-tab-hint">{tab.hint}</span>
                </span>
              </button>
            );
          })}
        </nav>

        <nav className="app-tabs app-tabs-secondary">
          {secondaryTabs.map((tab) => {
            const active = screen === tab.id;
            return (
              <button
                key={tab.id}
                className={active ? "app-tab app-tab-secondary app-tab-active" : "app-tab app-tab-secondary"}
                onClick={() => openScreen(tab.id)}
                aria-current={active ? "page" : undefined}
              >
                <span className="app-tab-label">{tab.label}</span>
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
              recentInputDirs={recentInputDirs}
              rememberInputDir={rememberInputDir}
            />
          </div>
        )}

        {mountedScreens.has("pipeline") && (
          <div className="app-screen" style={{ flex: 1, minHeight: 0, display: screen === "pipeline" ? "flex" : "none", flexDirection: "column" }}>
            <Pipeline
              inputDir={inputDir}
              setInputDir={setInputDir}
              outputDir={outputDir}
              setOutputDir={setOutputDir}
              excludeTags={excludeTags}
              removedImages={removedImages}
              thumbs={thumbs}
              recentInputDirs={recentInputDirs}
              recentOutputDirs={recentOutputDirs}
              rememberInputDir={rememberInputDir}
              rememberOutputDir={rememberOutputDir}
              onGoToEditor={(s) => {
                setEditorSettings((prev) => ({ ...prev, ...s }));
                setEditorKey((k) => k + 1);
                openScreen("editor");
              }}
              onPipelineDone={(s) => {
                setEditorSettings((prev) => ({ ...prev, ...s }));
              }}
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
              outputDir={committedOutputDir}
              canvasSize={editorSettings.canvasSize}
              thumbnail={editorSettings.thumbnail}
            />
          </div>
        )}

        {mountedScreens.has("settings") && (
          <div className="app-screen" style={{ flex: 1, minHeight: 0, display: screen === "settings" ? "flex" : "none", flexDirection: "column" }}>
            <Settings onThemeChange={handleSettingsThemeChange} />
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
