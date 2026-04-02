import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import Pipeline from "./Pipeline.jsx";
import "./index.css";

function Root() {
  const [screen, setScreen] = useState("pipeline");

  return screen === "pipeline"
    ? <Pipeline onGoToEditor={() => setScreen("editor")} />
    : <App      onGoPipeline={() => setScreen("pipeline")} />;
}

createRoot(document.getElementById("root")).render(
  <StrictMode><Root /></StrictMode>
);
