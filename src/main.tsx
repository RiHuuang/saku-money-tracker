import "./csp";
import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/plus-jakarta-sans/400.css";
import "@fontsource/plus-jakarta-sans/500.css";
import "@fontsource/plus-jakarta-sans/600.css";
import "@fontsource/plus-jakarta-sans/700.css";
import App from "./App";
import ErrorBoundary from "./ErrorBoundary";
import { AppUpdateProvider } from "./appUpdate";
import { loadSystemTheme, loadTheme, paintTheme, watchSystemTheme } from "./appearance";
import "./styles.css";
import { loadLanguage, prepareLanguage } from "./i18n";
void loadTheme().catch(() => "system" as const).then(async (preference) => {
  await loadSystemTheme();
  paintTheme(preference);
  // The saved language and the device language (used until the saved one is read) are ready before the first render.
  const language = await loadLanguage().catch(() => "system" as const);
  await Promise.all([prepareLanguage(language), prepareLanguage("system")]);
  watchSystemTheme();
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode><ErrorBoundary><AppUpdateProvider><App /></AppUpdateProvider></ErrorBoundary></React.StrictMode>,
  );
});
