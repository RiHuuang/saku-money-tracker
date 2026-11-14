import { useEffect, useRef, useState } from "react";

// Motion helpers shared by Monthly check, onboarding and the pocket planner. CSS animations already stop under
// prefers-reduced-motion (styles.css); JavaScript ones check it here. Nothing here ever delays input.
export const reducedMotion = () => {
  try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return true; }
};

// Counts from the previous value to the new one over `duration` ms with the house ease-out.
export function useCountUp(value: number, duration = 520, initial = value): number {
  const [shown, setShown] = useState(reducedMotion() ? value : initial);
  const from = useRef(reducedMotion() ? value : initial);
  useEffect(() => {
    const start = from.current;
    from.current = value;
    if (start === value || reducedMotion() || typeof requestAnimationFrame !== "function") { setShown(value); return; }
    let frame = 0;
    const began = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - began) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setShown(Math.round(start + (value - start) * eased));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, duration]);
  return shown;
}

export function CountUp({ value, format = String, fromZero = false }: { value: number; format?: (value: number) => string; fromZero?: boolean }) {
  const shown = useCountUp(value, 520, fromZero ? 0 : value);
  return <span className="count-up">{format(shown)}</span>;
}
