import { Capacitor, registerPlugin } from "@capacitor/core";

// On-device text recognition (ML Kit). No language model ships with Saku.
interface LocalStatementAIPlugin {
  recognizeImage(options: { image: string }): Promise<{ text: string }>;
}

export const nativeAIAvailable = Capacitor.getPlatform() === "android";
export const localStatementAI = registerPlugin<LocalStatementAIPlugin>("LocalStatementAI");
