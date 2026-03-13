import { Component, type ErrorInfo, type ReactNode } from "react";
import { createLogger } from "../lib/logger";

const log = createLogger("ErrorBoundary");

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    log.error("React crashed", {
      error: error.message,
      stack: error.stack,
      componentStack: info.componentStack,
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "100dvh",
            padding: "var(--space-6)",
            background: "var(--bg-primary)",
            color: "var(--text-primary)",
            fontFamily: "var(--font-family)",
            textAlign: "center",
          }}
        >
          <h1
            style={{
              fontSize: "1.5rem",
              fontWeight: 600,
              marginBottom: "var(--space-3)",
            }}
          >
            Something went wrong
          </h1>
          <p
            style={{
              fontSize: "0.95rem",
              color: "var(--text-secondary)",
              marginBottom: "var(--space-6)",
              maxWidth: 360,
            }}
          >
            The app hit an unexpected error. Reloading should fix it.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="focus-ring"
            style={{
              padding: "var(--space-3) var(--space-6)",
              fontSize: "1rem",
              fontWeight: 500,
              fontFamily: "var(--font-family)",
              color: "var(--bg-primary)",
              background: "var(--accent)",
              border: "none",
              borderRadius: "var(--radius-full)",
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
