import { useEffect, useState } from "react";

// Hides a bottom bar while the page scrolls up and brings it back on the way down, so it stays out of the way
// when someone goes back to read and is there again when they head for the end of the list.
export function useHiddenWhileScrollingUp() {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    let last = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY, delta = y - last;
      if (Math.abs(delta) < 6) return;
      last = y;
      const atBottom = window.innerHeight + y >= document.documentElement.scrollHeight - 24;
      setHidden(delta < 0 && !atBottom);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return hidden;
}
