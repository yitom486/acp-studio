import { useEffect, useState, type ReactNode } from "react";

/** Defer lazy imports until needed, then preserve forms and live terminals. */
export function MountOnFirstOpen({ isOpen, children }: { isOpen: boolean; children: ReactNode }) {
  const [hasOpened, setHasOpened] = useState(isOpen);
  useEffect(() => {
    if (isOpen) setHasOpened(true);
  }, [isOpen]);
  return isOpen || hasOpened ? children : null;
}
