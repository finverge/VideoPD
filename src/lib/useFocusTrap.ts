"use client";

import { useEffect, useRef } from "react";

/**
 * Minimal focus trap for a modal/dialog overlay (FSD accessibility gap found
 * in review: the camera-capture modal and the mobile chat sheet were both
 * `fixed inset-0` overlays with no role="dialog"/aria-modal and no focus
 * management at all — a keyboard/screen-reader user tabbing through either
 * would cycle straight into the page behind it). On open: remembers whatever
 * had focus, moves focus into the container, and traps Tab/Shift+Tab within
 * it. Escape calls onClose if given. On close: restores focus to whatever
 * triggered the modal, so keyboard users aren't dropped back at the top of
 * the page.
 */
export function useFocusTrap(
  containerRef: React.RefObject<HTMLElement | null>,
  active: boolean,
  onClose?: () => void
) {
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;

    const FOCUSABLE =
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const getFocusable = () =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);

    // Move focus in — a fresh render each open, so wait a tick for the DOM
    // (e.g. framer-motion's entrance) to actually be there.
    const raf = requestAnimationFrame(() => {
      const focusables = getFocusable();
      (focusables[0] ?? container).focus();
    });

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && onClose) {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const items = getFocusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused.current?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
}
