import { StrictMode, useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import Input from "./Input.jsx";
import Pipeline from "./Pipeline.jsx";
import Templates from "./Templates.jsx";
import Settings from "./Settings.jsx";
import "./index.css";

const TABS = [
  { id:"input",     label:"Input"     },
  { id:"pipeline",  label:"Process"   },
  { id:"editor",    label:"Editor"    },
  { id:"templates", label:"Templates" },
  { id:"settings",  label:"Settings"  },
];

export function Root() {
  const [screen, setScreen] = useState("input");
  const [theme,  setTheme]  = useState("dark");

  useEffect(() => {
    fetch("/api/settings").then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.settings?.appearance?.theme) setTheme(data.settings.appearance.theme); })
      .catch(() => {});
  }, []);

  const [inputDir,      setInputDir]      = useState("");
  const [outputDir,     setOutputDir]     = useState("");
  const [excludeTags,   setExcludeTags]   = useState([]);
  const [thumbs,        setThumbs]        = useState([]);
  const [removedImages, setRemovedImages] = useState(new Set());
  const [editorSettings, setEditorSettings] = useState({ outputDir:"", canvasSize:1440, thumbnail:true });

  return (
    <div data-theme={theme} style={{
      display:"flex", flexDirection:"column", height:"100vh",
      overflow:"hidden", background:"var(--bg)", color:"var(--text)",
    }}>
      {/* Header */}
      <div style={{
        display:"flex", alignItems:"center", height:44, background:"var(--panel)",
        borderBottom:"1px solid var(--border)", flexShrink:0, padding:"0 12px", gap:8,
      }}>
        {/* Logo */}
        <div style={{
          display:"flex", alignItems:"center", gap:6, paddingRight:12,
          borderRight:"1px solid var(--border)", marginRight:4,
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
            <polyline points="7.5 4.21 12 6.81 16.5 4.21"/>
            <polyline points="7.5 19.79 7.5 14.6 3 12"/>
            <polyline points="21 12 16.5 14.6 16.5 19.79"/>
            <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
            <line x1="12" y1="22.08" x2="12" y2="12"/>
          </svg>
          <span style={{ fontSize:12, fontWeight:600, letterSpacing:"0.01em" }}>Image Pipeline Pro</span>
          <span style={{ fontSize:9, color:"var(--dim)", fontFamily:"JetBrains Mono", fontWeight:500 }}>v2.0</span>
        </div>

        {/* Tabs */}
        <div style={{ display:"flex", gap:2, flex:1 }}>
          {TABS.map((tab, i) => {
            const active = screen === tab.id;
            return (
              <button key={tab.id} onClick={() => setScreen(tab.id)} style={{
                display:"flex", alignItems:"center", gap:4, padding:"5px 12px",
                background: active ? "var(--accent)" : "transparent",
                color: active ? "var(--accent-fg)" : "var(--dim)",
                border:"none", borderRadius:8, fontSize:12, fontWeight: active ? 600 : 400,
                transition:"all 0.15s ease",
              }}>
                <span style={{ fontSize:9, fontFamily:"JetBrains Mono", opacity: active ? 0.8 : 0.5 }}>{i+1}</span>
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Theme toggle */}
        <button
          onClick={() => {
            const newTheme = theme === "dark" ? "light" : "dark";
            setTheme(newTheme);
            fetch("/api/settings", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ settings: { appearance: { theme: newTheme } } }),
            }).catch(() => {});
          }}
          style={{
            width:28, height:28, borderRadius:8, border:"1px solid var(--border)",
            background:"var(--panel2)", color:"var(--dim)", display:"flex",
            alignItems:"center", justifyContent:"center",
          }}
        >
          {theme === "dark" ? "☀" : "🌙"}
        </button>
      </div>

      {/* Screens */}
      <div style={{ flex:1, minHeight:0, display:screen==="input"     ? "flex" : "none", flexDirection:"column" }}>
        <Input
          inputDir={inputDir}         setInputDir={setInputDir}
          thumbs={thumbs}             setThumbs={setThumbs}
          excludeTags={excludeTags}   setExcludeTags={setExcludeTags}
          removedImages={removedImages} setRemovedImages={setRemovedImages}
          onGoToProcess={() => setScreen("pipeline")}
        />
      </div>

      <div style={{ flex:1, minHeight:0, display:screen==="pipeline"  ? "flex" : "none", flexDirection:"column" }}>
        <Pipeline
          inputDir={inputDir}       setInputDir={setInputDir}
          outputDir={outputDir}     setOutputDir={setOutputDir}
          excludeTags={excludeTags}
          removedImages={removedImages}
          onGoToEditor={(s) => { setEditorSettings(s); setScreen("editor"); }}
          onGoToTemplates={() => setScreen("templates")}
        />
      </div>

      <div style={{ flex:1, minHeight:0, display:screen==="templates" ? "flex" : "none", flexDirection:"column" }}>
        <Templates onBack={() => setScreen("pipeline")} />
      </div>

      <div style={{ flex:1, minHeight:0, display:screen==="editor"    ? "flex" : "none", flexDirection:"column" }}>
        <App
          onGoPipeline={() => setScreen("pipeline")}
          outputDir={editorSettings.outputDir}
          canvasSize={editorSettings.canvasSize}
          thumbnail={editorSettings.thumbnail}
        />
      </div>

      <div style={{ flex:1, minHeight:0, display:screen==="settings"  ? "flex" : "none", flexDirection:"column" }}>
        <Settings onThemeChange={setTheme} />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(
  <StrictMode><Root /></StrictMode>
);
