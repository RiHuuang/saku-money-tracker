import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command, mode }) => {
  if (command === "build") {
    const apiUrl = process.env.VITE_SAKU_API_URL || loadEnv(mode, process.cwd(), "VITE_").VITE_SAKU_API_URL;
    if (apiUrl !== "https://app.sakumoney.my.id") {
      throw new Error(`Production build requires VITE_SAKU_API_URL=https://app.sakumoney.my.id (received ${apiUrl || "empty"})`);
    }
  }
  return { plugins: [react()] };
});
