import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";

export type ModelStatus = {
  supported: boolean;
  reason: string;
  installed: boolean;
  downloading: boolean;
  freeBytes: number;
  modelBytes: number;
};
export type ModelProgress = { bytes: number; total: number; stage: string };

interface LocalStatementAIPlugin {
  getStatus(): Promise<ModelStatus>;
  downloadModel(): Promise<void>;
  removeModel(): Promise<void>;
  cancel(): Promise<void>;
  recognizeImage(options: { image: string }): Promise<{ text: string }>;
  generate(options: { prompt: string }): Promise<{ text: string; backend: string }>;
  addListener(
    eventName: "modelProgress",
    listener: (event: ModelProgress) => void,
  ): Promise<PluginListenerHandle>;
}

export const nativeAIAvailable = Capacitor.getPlatform() === "android";
export const localStatementAI = registerPlugin<LocalStatementAIPlugin>("LocalStatementAI");
