import { Component, type ErrorInfo, type ReactNode } from "react";
import { RotateCcw } from "lucide-react";
import { recordClientError } from "@/lib/api";

// A LOCAL error boundary. The router's root boundary replaces the whole page, so one bad
// message used to take the entire lesson down ("the 'something went wrong' keeps getting
// in the way" — tester, 2026-08-13). Wrapping a region means the failure stays that
// region's problem: the sidebar, the composer, and the session survive, and Try again
// re-renders just the subtree.
//
// Every catch reports to runtime_events (see recordClientError) so a crash we cannot
// reproduce still leaves a diagnosable trace, and the real message is shown — a student
// screenshot of "something went wrong" told us nothing.

type Props = { children: ReactNode; label: string; fallbackTitle?: string };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[${this.props.label}]`, error, info.componentStack);
    void recordClientError(error, {
      boundary: this.props.label,
      component_stack: String(info.componentStack || "").slice(0, 1200),
    });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div
        role="alert"
        className="mx-auto my-3 w-full max-w-3xl rounded-card border border-danger/40 bg-danger/5 px-4 py-3"
      >
        <p className="text-body text-foreground">
          {this.props.fallbackTitle ?? "This part didn't render."}
        </p>
        <p className="mt-1 break-words text-meta text-muted-foreground">
          {error.message || String(error)}
        </p>
        <button
          type="button"
          onClick={() => this.setState({ error: null })}
          className="mt-2.5 inline-flex items-center gap-1.5 rounded-control border border-border px-2.5 py-1 text-meta text-foreground transition-colors duration-(--dur-fast) hover:bg-muted"
        >
          <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.7} />
          Try again
        </button>
      </div>
    );
  }
}
