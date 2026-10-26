export type View = "overview" | "transactions" | "pockets" | "plans" | "more" | "insights" | "check" | "settings";

export const moreViews: View[] = ["more", "insights", "plans", "settings"];

export function backDestination(view: View, previousView: View): View | null {
  if (moreViews.includes(view) && view !== "more") return "more";
  if (view === "more") return previousView === "more" ? "overview" : previousView;
  return view === "overview" ? null : "overview";
}
