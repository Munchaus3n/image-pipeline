import { useEffect, useState } from "react";

const TONES = {
  restarting: { bg: "var(--yellow-bg)", border: "var(--yellow-bdr)", role: "status" },
  running: { bg: "var(--green-bg)", border: "var(--green-bdr)", role: "status" },
  failed: { bg: "var(--red-bg)", border: "var(--red-bdr)", role: "alert" },
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
    <div
      role={tone.role}
      style={{
        position: "fixed",
        top: 12,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 1000,
        maxWidth: "min(720px, calc(100vw - 32px))",
        padding: "10px 16px",
        border: `1px solid ${tone.border}`,
        borderRadius: 10,
        background: tone.bg,
        color: "var(--text)",
        fontFamily: "var(--font-sans)",
        fontSize: 13,
        lineHeight: 1.45,
        boxShadow: "0 6px 24px rgba(0, 0, 0, 0.18)",
      }}
    >
      {messageFor(status)}
    </div>
  );
}
