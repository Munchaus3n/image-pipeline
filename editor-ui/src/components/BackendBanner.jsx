import { useEffect, useState } from "react";

const TONES = {
  restarting: { className: "is-restarting", role: "status" },
  running: { className: "is-running", role: "status" },
  failed: { className: "is-failed", role: "alert" },
};

function messageFor(status) {
  if (status.state === "restarting") {
    return `The background service stopped unexpectedly and is restarting (attempt ${status.attempt} of ${status.max}). A job that was running was interrupted.`;
  }
  if (status.state === "running") {
    return "The background service is back. If a job was running, start it again.";
  }
  return `The background service could not be restarted. ${status.message || ""} Close and reopen Cutout Studio.`.trim();
}

// Desktop app only: the main process tells the window when it has to restart the backend.
export default function BackendBanner() {
  const [status, setStatus] = useState(null);

  useEffect(() => {
    const subscribe = window.electronAPI?.onBackendStatus;
    return typeof subscribe === "function" ? subscribe(setStatus) : undefined;
  }, []);

  useEffect(() => {
    if (status?.state !== "running") return undefined;
    const timer = window.setTimeout(() => setStatus(null), 8000);
    return () => window.clearTimeout(timer);
  }, [status]);

  const tone = status && TONES[status.state];
  if (!tone) return null;

  return (
    <div role={tone.role} className={`ui-banner ${tone.className}`}>
      {messageFor(status)}
    </div>
  );
}
