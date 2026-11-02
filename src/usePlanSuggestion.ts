import { useEffect, useRef, useState } from "react";
import { baselinePlan, spreadRest, type PlanRow } from "./allocation";
import { suggestBudget } from "./cloud";
import type { Data } from "./domain";
import type { SuggestionState } from "./AllocationEditor";

export type PlanPocket = { key: string; pocketId?: string; name: string; icon: string };

// Rules first, AI second: the phone's plan shows at once and stays whenever the AI is slow, offline or over its
// daily allowance. Pockets the person set by hand are never overwritten by either.
export function usePlanSuggestion({ income, kind, pockets, data, month, userId }: { income: number; kind: "fixed" | "variable"; pockets: PlanPocket[]; data: Data; month: string; userId?: string }) {
  const [rows, setRows] = useState<PlanRow[]>([]);
  const [state, setState] = useState<SuggestionState>("rules");
  const request = useRef(0);
  const signature = JSON.stringify([income, kind, pockets.map((pocket) => [pocket.key, pocket.name])]);
  useEffect(() => {
    const base = baselinePlan(income, kind, pockets, data, month);
    setRows((current) => base.map((row) => { const mine = current.find((item) => item.key === row.key && item.userSet); return mine ? { ...row, amount: mine.amount, userSet: true, reason: { kind: "user" } } : row; }));
    setState("rules");
    request.current++;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);
  async function refine() {
    if (!userId || income < 100_000 || !rows.length) return;
    const id = ++request.current;
    setState("thinking");
    try {
      const answer = await suggestBudget(userId, { income, kind, pockets: rows.map((row) => ({ key: row.key, name: row.name, group: row.group, baseline: row.amount, spend: row.spend, fixed: row.fixed })) });
      if (id !== request.current) return;
      if (answer.source !== "ai") { setState("basic"); return; }
      setRows((current) => current.map((row) => {
        const pick = answer.allocations.find((item) => item.key === row.key);
        return pick && !row.userSet ? { ...row, amount: pick.amount, reason: pick.reason ? { kind: "ai", text: pick.reason } : row.reason } : row;
      }));
      setState("ai");
    } catch { if (id === request.current) setState("basic"); }
  }
  return { rows, setRows, state, refine, spread: () => setRows((current) => spreadRest(current, income, data)) };
}
