import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import Pipeline from "./Pipeline.jsx";
import Templates from "./Templates.jsx";
import "./index.css";

function Root() {
  const [screen,   setScreen]   = useState("pipeline");
  const [settings, setSettings] = useState({ outputDir:"", canvasSize:1440, thumbnail:true });

  if (screen === "pipeline") return (
    <Pipeline
      onGoToEditor={(s) => { setSettings(s); setScreen("editor"); }}
      onGoToTemplates={() => setScreen("templates")}
    />
  );
  if (screen === "templates") return (
    <Templates onBack={() => setScreen("pipeline")} />
  );
  return (
    <App
      onGoPipeline={() => setScreen("pipeline")}
      outputDir={settings.outputDir}
      canvasSize={settings.canvasSize}
      thumbnail={settings.thumbnail}
    />
  );
}

createRoot(document.getElementById("root")).render(
  <StrictMode><Root /></StrictMode>
);
