import { StrictMode, useState, useEffect, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import Editor from "./Editor.jsx";
import Input from "./Input.jsx";
import Pipeline from "./Pipeline.jsx";
import Templates from "./Templates.jsx";
import Settings from "./Settings.jsx";
import BackendBanner from "./components/BackendBanner.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import { getSettings, patchSettings } from "./api.js";
import { loadUiPrefs, useUiPref } from "./hooks/useUiPref.js";
import {
  Crop, FolderOpen, LayoutTemplate, Moon, PanelLeftClose, PanelLeftOpen,
  Settings as SettingsIcon, Sparkles, Sun,
} from "lucide-react";
import "./index.css";

const TABS = [
  { id: "input", label: "Input", hint: "Select source folder", icon: FolderOpen },
  { id: "pipeline", label: "Process", hint: "Configure pipeline", icon: Sparkles },
  { id: "editor", label: "Editor", hint: "Review and export", icon: Crop },
  { id: "templates", label: "Templates", icon: LayoutTemplate },
  { id: "settings", label: "Settings", icon: SettingsIcon },
];

const NARROW_QUERY = "(max-width: 1199px)";

// True below 1200px wide: the nav rail collapses to icons unless the user chose otherwise.
function useNarrowWindow() {
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW_QUERY).matches);
  useEffect(() => {
    const query = window.matchMedia(NARROW_QUERY);
    const onChange = (e) => setNarrow(e.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return narrow;
}

function BrandMark() {
  return (
    <svg className="app-brand-mark" viewBox="0 0 24 24" aria-hidden="true">
      <rect width="24" height="24" rx="6" fill="var(--brand)" />
      <circle cx="12" cy="12" r="5.5" fill="none" stroke="var(--brand-ink)" strokeWidth="2" strokeDasharray="3 2.2" />
    </svg>
  );
}

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
  const narrow = useNarrowWindow();
  const [navPref, setNavPref] = useUiPref("nav.collapsed", null);
  const navCollapsed = navPref ?? narrow;
  const [inputDir, setInputDir] = useState("");
  const [outputDir, setOutputDir] = useState("");
  // Output folder the Editor follows. Only updated on blur / Browse / Recent pick / run,
  // so typing in Process › Output folder does not reload (and clear) the Editor session.
  const [committedOutputDir, setCommittedOutputDir] = useState("");
  const [recentInputDirs, rememberInputDir, loadRecentInputDirs] = useRecentFolders("recent_input_dirs");
  const [recentOutputDirs, rememberRecentOutputDir, loadRecentOutputDirs] = useRecentFolders("recent_output_dirs");

  useEffect(() => { loadUiPrefs(); }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

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
    <>
    <BackendBanner />
    <div className="app-shell" data-theme={theme}>
      <aside className={navCollapsed ? "app-rail is-collapsed" : "app-rail"} aria-label="Main navigation">
        <div className="app-brand">
          <BrandMark />
          <div className="app-brand-copy">
            <div className="app-brand-title">Cutout Studio</div>
            <div className="app-brand-version">v{__APP_VERSION__}</div>
          </div>
        </div>

        <nav className="app-nav-group" aria-label="Workflow">
          <div className="app-nav-label">Workflow</div>
          {primaryTabs.map((tab, i) => {
            const active = screen === tab.id;
            const state = active ? "active" : mountedScreens.has(tab.id) ? "ready" : "idle";
            return (
              <button
                key={tab.id}
                className={active ? "app-nav-item is-active" : "app-nav-item"}
                onClick={() => openScreen(tab.id)}
                aria-current={active ? "page" : undefined}
                title={navCollapsed ? `${tab.label} - ${tab.hint}` : tab.hint}
              >
                <tab.icon size={16} aria-hidden="true" />
                <span className="app-nav-text">{tab.label}</span>
                <span className="app-nav-step">{String(i + 1).padStart(2, "0")}</span>
                <span className={`app-nav-state is-${state}`} aria-hidden="true" />
              </button>
            );
          })}
        </nav>

        <nav className="app-nav-group" aria-label="Library">
          <div className="app-nav-label">Library</div>
          {secondaryTabs.map((tab) => {
            const active = screen === tab.id;
            return (
              <button
                key={tab.id}
                className={active ? "app-nav-item is-active" : "app-nav-item"}
                onClick={() => openScreen(tab.id)}
                aria-current={active ? "page" : undefined}
                title={navCollapsed ? tab.label : undefined}
              >
                <tab.icon size={16} aria-hidden="true" />
                <span className="app-nav-text">{tab.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="app-rail-footer">
          <button
            className="app-nav-item"
            onClick={handleThemeToggle}
            title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
          >
            {theme === "dark" ? <Moon size={16} aria-hidden="true" /> : <Sun size={16} aria-hidden="true" />}
            <span className="app-nav-text">{theme === "dark" ? "Dark theme" : "Light theme"}</span>
          </button>
          <button
            className="app-nav-item"
            onClick={() => setNavPref(!navCollapsed)}
            aria-expanded={!navCollapsed}
            title={navCollapsed ? "Expand navigation" : "Collapse navigation"}
          >
            {navCollapsed
              ? <PanelLeftOpen size={16} aria-hidden="true" />
              : <PanelLeftClose size={16} aria-hidden="true" />}
            <span className="app-nav-text">Collapse</span>
          </button>
        </div>
      </aside>

      <main className="app-main">
        {mountedScreens.has("input") && (
          <div className="app-screen" style={{ display: screen === "input" ? "flex" : "none" }}>
            <ErrorBoundary label="Input"><Input
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
            /></ErrorBoundary>
          </div>
        )}

        {mountedScreens.has("pipeline") && (
          <div className="app-screen" style={{ display: screen === "pipeline" ? "flex" : "none" }}>
            <ErrorBoundary label="Process"><Pipeline
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
            /></ErrorBoundary>
          </div>
        )}

        {mountedScreens.has("templates") && (
          <div className="app-screen" style={{ display: screen === "templates" ? "flex" : "none" }}>
            <ErrorBoundary label="Templates"><Templates onBack={() => openScreen("pipeline")} /></ErrorBoundary>
          </div>
        )}

        {mountedScreens.has("editor") && (
          <div className="app-screen" style={{ display: screen === "editor" ? "flex" : "none" }}>
            <ErrorBoundary label="Editor"><Editor
              key={editorKey}
              outputDir={committedOutputDir}
              canvasSize={editorSettings.canvasSize}
              thumbnail={editorSettings.thumbnail}
            /></ErrorBoundary>
          </div>
        )}

        {mountedScreens.has("settings") && (
          <div className="app-screen" style={{ display: screen === "settings" ? "flex" : "none" }}>
            <ErrorBoundary label="Settings"><Settings onThemeChange={handleSettingsThemeChange} /></ErrorBoundary>
          </div>
        )}
      </main>
    </div>
    </>
  );
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <Root />
  </StrictMode>
);
