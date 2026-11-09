import { Component } from "react";

// One screen throwing during render must not blank the whole app: the other
// screens (and any unsaved work in them) stay mounted and usable.
export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error(`${this.props.label || "Screen"} crashed:`, error, info?.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div
        role="alert"
        style={{
          margin: "48px auto",
          maxWidth: 520,
          padding: 24,
          border: "1px solid var(--red-bdr)",
          borderRadius: 12,
          background: "var(--red-bg)",
          color: "var(--text)",
          fontFamily: "var(--font-sans)",
        }}
      >
        <h2 style={{ margin: "0 0 8px", fontSize: 18 }}>{this.props.label || "This screen"} hit an error</h2>
        <p style={{ margin: "0 0 16px", color: "var(--dim)", wordBreak: "break-word" }}>
          {String(error?.message || error)}
        </p>
        <button
          type="button"
          onClick={() => this.setState({ error: null })}
          style={{
            padding: "8px 16px",
            border: 0,
            borderRadius: 8,
            background: "var(--accent)",
            color: "var(--accent-fg)",
            font: "inherit",
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </div>
    );
  }
}
