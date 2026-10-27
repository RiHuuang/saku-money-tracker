import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/plus-jakarta-sans/400.css";
import "@fontsource/plus-jakarta-sans/500.css";
import "@fontsource/plus-jakarta-sans/600.css";
import "@fontsource/plus-jakarta-sans/700.css";
import App from "./App";
import ErrorBoundary from "./ErrorBoundary";
import { AppUpdateProvider } from "./appUpdate";
import { loadTheme, paintTheme, watchSystemTheme } from "./appearance";
import "./styles.css";
void loadTheme().catch(() => "system" as const).then((preference) => {
  paintTheme(preference);
  watchSystemTheme();
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode><ErrorBoundary><AppUpdateProvider><App /></AppUpdateProvider></ErrorBoundary></React.StrictMode>,
  );
});
