import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command, mode }) => {
  if (command === "build") {
    const apiUrl = process.env.VITE_SAKU_API_URL || loadEnv(mode, process.cwd(), "VITE_").VITE_SAKU_API_URL;
    const required = mode === "staging" ? "https://stage.sakumoney.my.id" : "https://app.sakumoney.my.id";
    if (apiUrl !== required) {
      throw new Error(`${mode === "staging" ? "Staging" : "Production"} build requires VITE_SAKU_API_URL=${required} (received ${apiUrl || "empty"})`);
    }
  }
  return { plugins: [react()] };
});
