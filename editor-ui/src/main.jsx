import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import Pipeline from "./Pipeline.jsx";
import Templates from "./Templates.jsx";
import Settings from "./Settings.jsx";
import "./index.css";

const C = {
  bg:"#0b0d14", panel:"#0f1219", border:"#1d2235",
  text:"#e2e8f8", dim:"#6b7a9e", dim2:"#2a3350", green:"#4ade80",
};

const TABS = [
  { id:"pipeline",  label:"Pipeline"  },
  { id:"templates", label:"Templates" },
  { id:"editor",    label:"Editor"    },
  { id:"settings",  label:"Settings"  },
];

function Root() {
  const [screen,   setScreen]   = useState("pipeline");
  const [settings, setSettings] = useState({ outputDir:"", canvasSize:1440, thumbnail:true });

  return (
    <div style={{
      display:"flex", flexDirection:"column", height:"100vh",
      overflow:"hidden", background:C.bg,
      fontFamily:"'Outfit','DM Sans',system-ui,sans-serif",
    }}>
      {/* ── Shared nav strip ── */}
      <div style={{
        display:"flex", alignItems:"stretch", height:40,
        background:C.panel, borderBottom:`1px solid ${C.border}`,
        flexShrink:0, zIndex:10,
      }}>
        <div style={{
          display:"flex", alignItems:"center",
          padding:"0 16px 0 18px", borderRight:`1px solid ${C.border}`,
          gap:6, flexShrink:0,
        }}>
          <span style={{ fontSize:12, fontWeight:700, color:C.text, letterSpacing:"0.02em" }}>
            Image Pipeline
          </span>
          <span style={{ fontSize:9, color:C.dim2, fontFamily:"JetBrains Mono" }}>v3.2</span>
        </div>
        <div style={{ display:"flex" }}>
          {TABS.map(tab => {
            const active = screen === tab.id;
            return (
              <button key={tab.id} onClick={() => setScreen(tab.id)} style={{
                padding:"0 22px", fontSize:12,
                fontWeight:    active ? 600 : 400,
                color:         active ? C.text : C.dim,
                background:    active ? C.bg : "transparent",
                border:        "none",
                borderRight:   `1px solid ${C.border}`,
                borderBottom:  active ? `2px solid ${C.green}` : "2px solid transparent",
                cursor:        active ? "default" : "pointer",
                fontFamily:    "inherit",
                transition:    "color 0.1s",
                marginBottom:  -1,
              }}>{tab.label}</button>
            );
          })}
        </div>
      </div>

      {/* ── Screens (always mounted) ── */}
      <div style={{ flex:1, minHeight:0, display:screen==="pipeline"  ? "flex" : "none", flexDirection:"column" }}>
        <Pipeline
          onGoToEditor={(s) => { setSettings(s); setScreen("editor"); }}
          onGoToTemplates={() => setScreen("templates")}
        />
      </div>
      <div style={{ flex:1, minHeight:0, display:screen==="templates" ? "flex" : "none", flexDirection:"column" }}>
        <Templates onBack={() => setScreen("pipeline")} />
      </div>
      <div style={{ flex:1, minHeight:0, display:screen==="editor"    ? "flex" : "none", flexDirection:"column" }}>
        <App
          onGoPipeline={() => setScreen("pipeline")}
          outputDir={settings.outputDir}
          canvasSize={settings.canvasSize}
          thumbnail={settings.thumbnail}
        />
      </div>
      <div style={{ flex:1, minHeight:0, display:screen==="settings"  ? "flex" : "none", flexDirection:"column" }}>
        <Settings />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(
  <StrictMode><Root /></StrictMode>
);