import { useEffect, useMemo, useRef, type RefObject } from "react";

// Shared motion tokens. Easing curves mirror standard CSS custom properties;
// springs are the canonical physics used across components.
export const EASE_OUT = [0.16, 1, 0.3, 1] as const;
export const EASE_IN_OUT = [0.77, 0, 0.175, 1] as const;
export const EASE_DRAWER = [0.32, 0.72, 0, 1] as const;

/** CSS string form of EASE_OUT for inline style transitions. */
export const EASE_OUT_CSS = "cubic-bezier(0.16, 1, 0.3, 1)";

/** Press feedback on buttons and other tappable surfaces. */
export const SPRING_PRESS = {
  type: "spring",
  stiffness: 500,
  damping: 30,
  mass: 0.6,
} as const;

/** Content swaps — label/icon slots trading places inside a control. */
export const SPRING_SWAP = {
  type: "spring",
  stiffness: 460,
  damping: 30,
  mass: 0.55,
} as const;

/** Overlay panel entrances — modals and sheets summoned by pointer. */
export const SPRING_PANEL = {
  type: "spring",
  stiffness: 420,
  damping: 40,
  mass: 0.5,
} as const;

/** Shared-layout glides — pills, indicators and panels morphing between positions. */
export const SPRING_LAYOUT = {
  type: "spring",
  stiffness: 360,
  damping: 32,
  mass: 0.6,
} as const;

/** Cursor-follow physics for decorative mouse tracking (magnetic, tilt, dock). */
export const SPRING_MOUSE = {
  stiffness: 200,
  damping: 15,
  mass: 0.3,
} as const;

/** Dragged handles and fills (sliders) — critically damped config */
export const SPRING_GLIDE = {
  stiffness: 700,
  damping: 50,
  mass: 0.5,
} as const;

export const TOUCH_GESTURE_CLASS = "select-none [-webkit-touch-callout:none]";

export function isHoveringPointer(event: { pointerType: string; buttons: number }): boolean {
  if (event.pointerType === "touch") return false;
  return event.buttons === 0;
}

export interface BoundaryEvent {
  pointerId: number;
  pointerType: string;
  buttons: number;
}

export interface HoverGesture {
  enter: (event: BoundaryEvent) => boolean;
  leave: (event: BoundaryEvent) => boolean;
}

export function useHoverGesture(): HoverGesture {
  const contact = useRef(new Set<number>());

  return useMemo(
    () => ({
      enter: (event) => {
        if (isHoveringPointer(event)) {
          contact.current.delete(event.pointerId);
          return true;
        }
        contact.current.add(event.pointerId);
        return false;
      },
      leave: (event) => {
        const arrivedInContact = contact.current.delete(event.pointerId);
        return !arrivedInContact && event.pointerType !== "touch";
      },
    }),
    [],
  );
}

export interface TapRecord<S> {
  pointerType: string;
  state: S;
}

export interface TapGesture<S> {
  start: (event: { pointerType: string }, state: S) => void;
  take: () => TapRecord<S> | null;
  drop: () => void;
}

export function useTapGesture<S>(): TapGesture<S> {
  const record = useRef<TapRecord<S> | null>(null);

  return useMemo(
    () => ({
      start: (event, state) => {
        record.current = { pointerType: event.pointerType, state };
      },
      take: () => {
        const spent = record.current;
        record.current = null;
        return spent;
      },
      drop: () => {
        record.current = null;
      },
    }),
    [],
  );
}

export type DismissBehavior = "pass-through" | "consume";

export interface DismissOptions {
  behavior?: DismissBehavior;
  escape?: boolean;
  ignore?: (target: Element) => boolean;
}

const openScopes = new Set<(target: Element) => boolean>();

function claimedByAnotherScope(self: (target: Element) => boolean, target: Element) {
  for (const scope of openScopes) {
    if (scope !== self && scope(target)) return true;
  }
  return false;
}

function consumeActivation(source: Event) {
  const swallow = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    release();
  };
  const restart = (event: Event) => {
    if (event !== source) release();
  };
  const release = () => {
    window.removeEventListener("click", swallow, true);
    window.removeEventListener("pointerdown", restart, true);
    window.removeEventListener("pointercancel", restart, true);
    window.removeEventListener("keydown", release, true);
  };
  window.addEventListener("click", swallow, true);
  window.addEventListener("pointerdown", restart, true);
  window.addEventListener("pointercancel", restart, true);
  window.addEventListener("keydown", release, true);
}

export function useDismiss(
  open: boolean,
  onDismiss: () => void,
  ref: RefObject<HTMLElement | SVGElement | null> | null,
  {
    behavior = "pass-through",
    escape: dismissOnEscape = true,
    ignore,
  }: DismissOptions = {},
) {
  useEffect(() => {
    if (!open) return;
    const inside = (target: Element) =>
      Boolean(ref?.current?.contains(target)) || Boolean(ignore?.(target));
    const onKey = (event: KeyboardEvent) => {
      if (dismissOnEscape && event.key === "Escape") onDismiss();
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (!target || inside(target)) return;
      if (behavior === "consume" && !claimedByAnotherScope(inside, target)) {
        consumeActivation(event);
      }
      onDismiss();
    };
    openScopes.add(inside);
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer, true);
    return () => {
      openScopes.delete(inside);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer, true);
    };
  }, [open, onDismiss, ref, behavior, dismissOnEscape, ignore]);
}
