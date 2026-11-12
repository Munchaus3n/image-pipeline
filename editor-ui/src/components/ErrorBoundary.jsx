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
      <div role="alert" className="ui-error-card">
        <h2>{this.props.label || "This screen"} hit an error</h2>
        <p>{String(error?.message || error)}</p>
        <button type="button" className="ui-btn ui-btn-primary ui-btn-m" onClick={() => this.setState({ error: null })}>
          Try again
        </button>
      </div>
    );
  }
}
