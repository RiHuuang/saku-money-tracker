import { Component, type ReactNode } from "react";
import { t } from "./i18n";

// A render error must not blank the whole app: the ledger is stored separately and is unaffected.
export default class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) { console.error("Saku stopped rendering", error); }
  render() {
    if (!this.state.failed) return this.props.children;
    return <div className="loading">
      <h1>Saku</h1>
      <p role="alert">{t("appErrorBody")}</p>
      <button className="button primary" onClick={() => location.reload()}>{t("retry")}</button>
    </div>;
  }
}
