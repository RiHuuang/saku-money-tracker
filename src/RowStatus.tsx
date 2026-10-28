import { Check, CircleAlert, Clock, X } from "lucide-react";

export type RowState = "ready" | "skip" | "review" | "later" | "saved";

// The decided state of a Catch up row, shown with an icon and a tint as well as words, so it reads at a glance.
export function RowStatus({ state, label }: { state: RowState; label: string }) {
  const Icon = state === "ready" || state === "saved" ? Check : state === "skip" ? X : state === "later" ? Clock : CircleAlert;
  return <small className="catchup-row-status" data-state={state}><Icon size={12} aria-hidden="true" />{label}</small>;
}
