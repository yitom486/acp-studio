import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

/** Shared canvas controls for image and Mermaid previews. */
export function useLightboxViewport(onClose: () => void) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const positionRef = useRef(position);
  const dragRef = useRef<{
    pointerId: number;
    element: HTMLDivElement;
    startX: number;
    startY: number;
  } | null>(null);

  const endDrag = useCallback((pointerId?: number) => {
    const drag = dragRef.current;
    if (!drag || (pointerId !== undefined && pointerId !== drag.pointerId)) return;
    dragRef.current = null;
    setIsDragging(false);
    if (drag.element.hasPointerCapture(drag.pointerId)) {
      drag.element.releasePointerCapture(drag.pointerId);
    }
  }, []);

  const reset = useCallback(() => {
    endDrag();
    setScale(1);
    positionRef.current = { x: 0, y: 0 };
    setPosition(positionRef.current);
  }, [endDrag]);

  // Parent rerenders must not tear down listeners or cancel a captured drag.
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dialog = canvas.closest<HTMLElement>('[role="dialog"]');
    const previousFocus = document.activeElement as HTMLElement | null;
    const controls = () => Array.from(dialog?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], [tabindex="0"]') || []);
    controls()[0]?.focus({ preventScroll: true });
    const onWheel = (event: WheelEvent) => {
      // React's delegated wheel listener is passive; cancel at the canvas itself.
      event.preventDefault();
      if (event.deltaY === 0) return;
      const delta = event.deltaY < 0 ? 0.15 : -0.15;
      setScale((prev) => Math.min(4, Math.max(0.25, +(prev + delta).toFixed(2))));
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Tab") {
        const items = controls();
        const index = items.indexOf(document.activeElement as HTMLElement);
        if (items.length && (index < 0 || (event.shiftKey ? index === 0 : index === items.length - 1))) {
          event.preventDefault();
          items[event.shiftKey ? items.length - 1 : 0].focus();
        }
        return;
      }
      if (event.key === "Escape") onCloseRef.current();
      else if (event.key === "+" || event.key === "=") setScale((s) => Math.min(4, +(s + 0.25).toFixed(2)));
      else if (event.key === "-") setScale((s) => Math.max(0.25, +(s - 0.25).toFixed(2)));
      else if (event.key === "0") reset();
      else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
        endDrag();
        const step = event.shiftKey ? 80 : 20;
        const next = { ...positionRef.current };
        if (event.key === "ArrowLeft") next.x -= step;
        if (event.key === "ArrowRight") next.x += step;
        if (event.key === "ArrowUp") next.y -= step;
        if (event.key === "ArrowDown") next.y += step;
        positionRef.current = next;
        setPosition(next);
      } else return;
      event.preventDefault();
    };
    const onBlur = () => endDrag();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    canvas.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onBlur);
    return () => {
      endDrag();
      canvas.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onBlur);
      document.body.style.overflow = overflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [endDrag, reset]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || event.button !== 0 || dragRef.current) return;
    event.preventDefault();
    const element = event.currentTarget;
    element.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId, element,
      startX: event.clientX - positionRef.current.x,
      startY: event.clientY - positionRef.current.y,
    };
    setIsDragging(true);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    // Also recover if a mouse-up was lost while the app was outside the foreground.
    if (event.pointerType === "mouse" && event.buttons === 0) {
      endDrag(event.pointerId);
      return;
    }
    positionRef.current = { x: event.clientX - drag.startX, y: event.clientY - drag.startY };
    setPosition(positionRef.current);
  };
  const onPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => endDrag(event.pointerId);

  return {
    canvasRef, scale, setScale, position, isDragging, reset,
    pointerHandlers: {
      onPointerDown, onPointerMove,
      onPointerUp: onPointerEnd,
      onPointerCancel: onPointerEnd,
      onLostPointerCapture: onPointerEnd,
    },
  };
}
