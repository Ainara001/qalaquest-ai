import { Component, type ReactNode } from "react";
import i18n from "@/i18n";

/** A crash in one screen shows a short message with "reload" instead of an empty page. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error("screen crashed", error);
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    // moving to another tab gives the next screen a fresh start
    if (prev.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="mx-auto mt-10 max-w-sm space-y-3 rounded-2xl border bg-card p-5 text-center shadow-sm">
        <p className="font-semibold">{i18n.t("error.screen")}</p>
        <button type="button" onClick={() => window.location.reload()} className="h-11 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground">
          {i18n.t("error.reload")}
        </button>
      </div>
    );
  }
}
