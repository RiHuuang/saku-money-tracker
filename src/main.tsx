import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/600.css";
import "@fontsource/dm-sans/700.css";
import "@fontsource/fraunces/600.css";
import "@fontsource/plus-jakarta-sans/400.css";
import "@fontsource/plus-jakarta-sans/600.css";
import App from "./App";
import { loadTheme, paintTheme, watchSystemTheme } from "./appearance";
import "./styles.css";
void loadTheme().catch(() => "system" as const).then((preference) => {
  paintTheme(preference);
  watchSystemTheme();
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode><App /></React.StrictMode>,
  );
});
