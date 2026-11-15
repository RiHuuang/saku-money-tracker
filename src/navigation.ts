export type View = "overview" | "transactions" | "pockets" | "plans" | "more" | "insights" | "check" | "settings";

export const moreViews: View[] = ["more", "insights", "plans", "settings"];

export const pushSheet = <T>(stack: readonly T[], sheet: T): T[] => [...stack, sheet];
export const popSheet = <T>(stack: readonly T[]): T[] => stack.slice(0, -1);

export function backDestination(view: View, history: readonly View[]): View | null {
  return history.at(-1) ?? (view === "overview" ? null : "overview");
}
