"use client";

import { HelpCircle } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type Placement = "top" | "bottom";

interface TooltipPosition {
  left: number;
  placement: Placement;
  top: number;
  width: number;
}

const VIEWPORT_MARGIN = 12;
const TOOLTIP_GAP = 9;
const TOOLTIP_WIDTH = 248;
const ESTIMATED_HEIGHT = 76;

export function InfoTip({ children, label }: { children: ReactNode; label: string }) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [portalHost, setPortalHost] = useState<Element | null>(null);
  const [position, setPosition] = useState<TooltipPosition | null>(null);

  const calculatePosition = useCallback((tooltipHeight = ESTIMATED_HEIGHT): TooltipPosition | null => {
    const trigger = triggerRef.current;
    if (!trigger || typeof window === "undefined") return null;

    const rect = trigger.getBoundingClientRect();
    const container = trigger.closest("dialog")?.getBoundingClientRect();
    const safeLeft = Math.max(VIEWPORT_MARGIN, container ? container.left + VIEWPORT_MARGIN : VIEWPORT_MARGIN);
    const safeRight = Math.min(window.innerWidth - VIEWPORT_MARGIN, container ? container.right - VIEWPORT_MARGIN : window.innerWidth - VIEWPORT_MARGIN);
    const safeTop = Math.max(VIEWPORT_MARGIN, container ? container.top + VIEWPORT_MARGIN : VIEWPORT_MARGIN);
    const safeBottom = Math.min(window.innerHeight - VIEWPORT_MARGIN, container ? container.bottom - VIEWPORT_MARGIN : window.innerHeight - VIEWPORT_MARGIN);
    const renderedWidth = Math.min(TOOLTIP_WIDTH, safeRight - safeLeft);
    const halfWidth = renderedWidth / 2;
    const left = clamp(rect.left + (rect.width / 2), safeLeft + halfWidth, safeRight - halfWidth);
    const spaceAbove = rect.top - safeTop;
    const spaceBelow = safeBottom - rect.bottom;
    const placement: Placement = spaceAbove >= tooltipHeight + TOOLTIP_GAP || (spaceBelow < tooltipHeight + TOOLTIP_GAP && spaceAbove > spaceBelow) ? "top" : "bottom";
    const desiredTop = placement === "top"
      ? rect.top - TOOLTIP_GAP - tooltipHeight
      : rect.bottom + TOOLTIP_GAP;
    const top = clamp(desiredTop, safeTop, Math.max(safeTop, safeBottom - tooltipHeight));

    return { left, placement, top, width: renderedWidth };
  }, []);

  function show(): void {
    setPortalHost(triggerRef.current?.closest("dialog") ?? document.body);
    setPosition(calculatePosition());
    setOpen(true);
  }

  function hide(): void {
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const reposition = () => setPosition(calculatePosition(tooltipRef.current?.getBoundingClientRect().height));
    const frame = window.requestAnimationFrame(reposition);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [calculatePosition, open]);

  return <>
    <button
      ref={triggerRef}
      type="button"
      className="info-tip"
      aria-label={label}
      aria-describedby={open ? id : undefined}
      aria-expanded={open}
      onBlur={hide}
      onClick={show}
      onFocus={show}
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      <HelpCircle size={14} aria-hidden="true" />
    </button>
    {open && position && portalHost && createPortal(
      <span
        ref={tooltipRef}
        id={id}
        role="tooltip"
        className={`smart-tooltip smart-tooltip--${position.placement}`}
        style={{ left: position.left, top: position.top, width: position.width }}
      >
        {children}
      </span>,
      portalHost,
    )}
  </>;
}

function clamp(value: number, minimum: number, maximum: number): number {
  if (maximum < minimum) return value;
  return Math.min(Math.max(value, minimum), maximum);
}
