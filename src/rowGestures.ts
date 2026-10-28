import { useRef, useState } from "react";
import type React from "react";

// Swipe right to add, left to leave out; tap or hold to open the row for editing. Every decision is also
// announced, since a swipe changes the row without moving focus.
// Shared by every Catch up list (screenshots, statements, notifications, CSV) so they all behave the same.
export function useRowGestures({ onAdd, onSkip, onOpen }: { onAdd: (id: string) => void; onSkip: (id: string) => void; onOpen: (id: string) => void }) {
  const [announcement, announce] = useState("");
  const [swipe, setSwipe] = useState<{ id: string; dx: number } | null>(null);
  const gesture = useRef<{ id: string; x: number; y: number; moved: boolean; held: boolean; touch: boolean; timer: number } | null>(null);
  const offset = (id: string) => swipe?.id === id ? swipe.dx : 0;
  const handlers = (id: string, disabled = false) => ({
    onPointerDown: (event: React.PointerEvent) => {
      if (disabled) return;
      const touch = event.pointerType !== "mouse";
      gesture.current = { id, x: event.clientX, y: event.clientY, moved: false, held: false, touch, timer: touch ? window.setTimeout(() => {
        if (!gesture.current || gesture.current.id !== id || gesture.current.moved) return;
        gesture.current.held = true; navigator.vibrate?.(12); onOpen(id);
      }, 450) : 0 };
    },
    onPointerMove: (event: React.PointerEvent) => {
      const current = gesture.current;
      if (!current || current.id !== id || current.held) return;
      const dx = event.clientX - current.x, dy = event.clientY - current.y;
      if (!current.moved && Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { window.clearTimeout(current.timer); gesture.current = null; return; }
      if (!current.moved && Math.abs(dx) > 10) { current.moved = true; window.clearTimeout(current.timer); try { (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId); } catch { /* the swipe still follows the finger */ } }
      if (current.moved) setSwipe({ id, dx: Math.max(-140, Math.min(140, dx)) });
    },
    onPointerUp: () => end(id),
    onPointerCancel: () => end(id),
    onContextMenu: (event: React.MouseEvent) => event.preventDefault(),
    onClick: () => { const current = gesture.current; if (disabled || current?.moved || current?.held) return; onOpen(id); },
  });
  function end(id: string) {
    const current = gesture.current;
    if (!current || current.id !== id) return;
    window.clearTimeout(current.timer);
    const dx = offset(id);
    if (current.moved && dx > 90) onAdd(id);
    else if (current.moved && dx < -90) onSkip(id);
    setSwipe(null);
    window.setTimeout(() => { if (gesture.current === current) gesture.current = null; }, 0);
  }
  return { offset, handlers, announcement, announce };
}
