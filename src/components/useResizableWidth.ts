import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";

/**
 * Width of a panel resized by dragging one of its edges, remembered in
 * localStorage. `edge` is the side the handle is on: dragging a left-edge
 * handle to the left makes the panel wider. Double-click resets.
 */
export function useResizableWidth(key: string, initial: number, min: number, max: number, edge: "left" | "right") {
  const [width, setWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(key));
      return saved ? Math.max(min, Math.min(max, saved)) : initial;
    } catch {
      return initial;
    }
  });
  const drag = useRef<{ x: number; w: number } | null>(null);
  const latest = useRef(width);
  latest.current = width;

  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!drag.current) return;
      const dx = e.clientX - drag.current.x;
      latest.current = Math.max(min, Math.min(max, drag.current.w + (edge === "left" ? -dx : dx)));
      setWidth(latest.current);
    };
    const up = () => {
      if (!drag.current) return;
      drag.current = null;
      document.body.classList.remove("resizing-x");
      try {
        localStorage.setItem(key, String(latest.current));
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [key, min, max, edge]);

  const handleProps = {
    title: "Drag to resize · double-click to reset",
    onMouseDown: (e: ReactMouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      drag.current = { x: e.clientX, w: latest.current };
      document.body.classList.add("resizing-x");
    },
    onDoubleClick: () => {
      setWidth(initial);
      try {
        localStorage.removeItem(key);
      } catch {
        /* ignore */
      }
    },
  };
  return { width, handleProps };
}
