import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import Pipeline from "./Pipeline.jsx";
import Templates from "./Templates.jsx";
import "./index.css";

const C = {
  bg: "#0b0d14", panel: "#0f1219", border: "#1d2235",
  text: "#e2e8f8", dim: "#6b7a9e", dim2: "#2a3350",
};

const TABS = [
  { id: "pipeline",  label: "Pipeline"  },
  { id: "templates", label: "Templates" },
  { id: "editor",    label: "Editor"    },
];

// All three screens stay mounted. Switching tabs only toggles display:none.
// This means the pipeline stream keeps running even while on other tabs.
function Root() {
  const [screen,   setScreen]   = useState("pipeline");
  const [settings, setSettings] = useState({ outputDir: "", canvasSize: 1440, thumbnail: true });

  const show = (id) => ({
    display:       screen === id ? "flex" : "none",
    flexDirection: "column",
    flex:          1,
    minHeight:     0,
    overflow:      "hidden",
  });

  return (
    <div style={{
      display: "flex", flexDirection: "column",
      height: "100vh", overflow: "hidden",
      background: C.bg,
      fontFamily: "'Outfit','DM Sans',system-ui,sans-serif",
    }}>
      {/* ── Shared nav strip ── */}
      <div style={{
        display: "flex", alignItems: "stretch",
        height: 38, flexShrink: 0,
        background: C.panel,
        borderBottom: `1px solid ${C.border}`,
      }}>
        {/* App name */}
        <div style={{
          display: "flex", alignItems: "center",
          padding: "0 16px", borderRight: `1px solid ${C.border}`,
          fontSize: 12, fontWeight: 700, color: C.text, letterSpacing: "0.03em",
          whiteSpace: "nowrap",
        }}>
          Image Pipeline
          <span style={{ fontSize: 9, color: C.dim2, marginLeft: 6, fontFamily: "JetBrains Mono" }}>v3.2</span>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", flex: 1 }}>
          {TABS.map(tab => {
            const active = screen === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setScreen(tab.id)}
                style={{
                  background:    active ? C.bg       : "transparent",
                  color:         active ? C.text     : C.dim,
                  borderRight:   `1px solid ${C.border}`,
                  borderBottom:  active ? `2px solid #4ade80` : "2px solid transparent",
                  borderTop:     "none",
                  borderLeft:    "none",
                  padding:       "0 20px",
                  fontSize:      12,
                  fontWeight:    active ? 600 : 400,
                  cursor:        active ? "default" : "pointer",
                  fontFamily:    "inherit",
                  letterSpacing: "0.02em",
                  transition:    "color 0.12s",
                  flexShrink:    0,
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Screens (always mounted) ── */}
      <div style={show("pipeline")}>
        <Pipeline
          onGoToEditor={(s) => { setSettings(s); setScreen("editor"); }}
          onGoToTemplates={() => setScreen("templates")}
          hideHeader   // tell Pipeline not to render its own header/nav buttons
        />
      </div>

      <div style={show("templates")}>
        <Templates
          onBack={() => setScreen("pipeline")}
          hideHeader
        />
      </div>

      <div style={show("editor")}>
        <App
          onGoPipeline={() => setScreen("pipeline")}
          outputDir={settings.outputDir}
          canvasSize={settings.canvasSize}
          thumbnail={settings.thumbnail}
          hideHeader
        />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(
  <StrictMode><Root /></StrictMode>
);
