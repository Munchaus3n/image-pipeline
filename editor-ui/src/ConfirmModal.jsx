export default function ConfirmModal({
  open,
  title = "Confirm action",
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
}) {
  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        padding: 16,
      }}
    >
      <div
        style={{
          width: "min(420px, calc(100vw - 32px))",
          background: "var(--panel)",
          color: "var(--text)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          boxShadow: "0 20px 40px rgba(0,0,0,0.35)",
          padding: 16,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{title}</div>
        <div style={{ fontSize: 12, color: "var(--dim)", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
          {message}
        </div>
        <div style={{ marginTop: 14, display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            onClick={onCancel}
            style={{
              background: "transparent",
              color: "var(--dim)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: "6px 12px",
              fontSize: 11,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            style={{
              background: "var(--red-bg)",
              color: "var(--red)",
              border: "1px solid var(--red-bdr)",
              borderRadius: 6,
              padding: "6px 12px",
              fontSize: 11,
              cursor: "pointer",
              fontFamily: "inherit",
              fontWeight: 600,
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
