"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Props = {
  children: React.ReactNode;
  className?: string;

  /** Your table header uses px-5, so 20 aligns to the header content */
  contentPadPx?: number;

  bottomOffsetPx?: number;

  /** Show bar only if horizontal overflow exists */
  onlyWhenOverflow?: boolean;

  /** Debug: force it visible */
  forceShow?: boolean;
};

export default function FloatingXScroll({
  children,
  className = "",
  contentPadPx = 20,
  bottomOffsetPx = 16,
  onlyWhenOverflow = true,
  forceShow = false,
}: Props) {
  const canUseDOM = typeof window !== "undefined";

  const containerRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  const floatRef = useRef<HTMLDivElement | null>(null);
  const floatInnerRef = useRef<HTMLDivElement | null>(null);

  const bottomSentinelRef = useRef<HTMLDivElement | null>(null);

  const syncingRef = useRef<"table" | "float" | null>(null);
  const dragRef = useRef({ down: false, startX: 0, startLeft: 0 });

  const [inView, setInView] = useState(false);
  const [bottomVisible, setBottomVisible] = useState(false);
  const [hasOverflow, setHasOverflow] = useState(false);
  const [pos, setPos] = useState<{ left: number; width: number }>({
    left: 16,
    width: 320,
  });

  const syncScroll = useCallback((from: "table" | "float") => {
    const tableEl = scrollerRef.current;
    const floatEl = floatRef.current;
    if (!tableEl || !floatEl) return;

    if (syncingRef.current && syncingRef.current !== from) return;
    syncingRef.current = from;

    const src = from === "table" ? tableEl : floatEl;
    const dst = from === "table" ? floatEl : tableEl;

    dst.scrollLeft = src.scrollLeft;

    requestAnimationFrame(() => {
      syncingRef.current = null;
    });
  }, []);

  // Measure overflow + align bar to header content width
  const recompute = useCallback(() => {
    const containerEl = containerRef.current;
    const tableEl = scrollerRef.current;
    const innerEl = floatInnerRef.current;
    const floatEl = floatRef.current;
    if (!containerEl || !tableEl || !innerEl) return;

    setHasOverflow(tableEl.scrollWidth > tableEl.clientWidth + 1);
    innerEl.style.minWidth = `${tableEl.scrollWidth}px`;

    const r = containerEl.getBoundingClientRect();
    const left = Math.max(8, r.left + contentPadPx);
    const width = Math.max(200, r.width - contentPadPx * 2);
    setPos({ left, width });

    if (floatEl) floatEl.scrollLeft = tableEl.scrollLeft;
  }, [contentPadPx]);

  // Observe: is the table area in the viewport?
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const io = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { root: null, threshold: 0.01 },
    );

    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Observe: is the *bottom* of the scroller visible? (native scrollbar reachable)
  useEffect(() => {
    const el = bottomSentinelRef.current;
    if (!el) return;

    const io = new IntersectionObserver(
      ([entry]) => setBottomVisible(entry.isIntersecting),
      {
        root: null,
        threshold: 0.01,
        // You can tune this: if you want bar to hide slightly BEFORE bottom fully appears:
        rootMargin: "0px 0px 0px 0px",
      },
    );

    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Keep measurements fresh
  useEffect(() => {
    recompute();

    const onWin = () => recompute();
    window.addEventListener("scroll", onWin, { passive: true });
    window.addEventListener("resize", onWin);

    const tableEl = scrollerRef.current;
    let ro: ResizeObserver | null = null;
    if (tableEl) {
      ro = new ResizeObserver(onWin);
      ro.observe(tableEl);
    }

    return () => {
      window.removeEventListener("scroll", onWin);
      window.removeEventListener("resize", onWin);
      ro?.disconnect();
    };
  }, [recompute, children]);

  // Drag to scroll
  const onPointerDown = (e: React.PointerEvent) => {
    const el = floatRef.current;
    if (!el) return;
    dragRef.current.down = true;
    dragRef.current.startX = e.clientX;
    dragRef.current.startLeft = el.scrollLeft;
    el.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const el = floatRef.current;
    if (!el || !dragRef.current.down) return;
    const dx = e.clientX - dragRef.current.startX;
    el.scrollLeft = dragRef.current.startLeft - dx;
    syncScroll("float");
  };

  const onPointerUp = (e: React.PointerEvent) => {
    dragRef.current.down = false;
    const el = floatRef.current;
    try {
      el?.releasePointerCapture(e.pointerId);
    } catch {}
  };

  const show =
    forceShow ||
    (inView && (!onlyWhenOverflow || hasOverflow) && !bottomVisible);

  return (
    <div ref={containerRef} className={className}>
      <div
        ref={scrollerRef}
        className="overflow-x-auto scrollbar-x-none"
        onScroll={() => syncScroll("table")}
      >
        {children}
      </div>

      {/* Sentinel OUTSIDE the scroller */}
      <div ref={bottomSentinelRef} style={{ height: 1 }} />

      {canUseDOM && show
        ? createPortal(
            <div
              className="fixed z-[99999]"
              style={{
                left: pos.left,
                width: pos.width,
                bottom: bottomOffsetPx,
              }}
            >
              <div
                ref={floatRef}
                className="h-6 overflow-x-auto overflow-y-hidden rounded-full border border-slate-300 bg-white/90 backdrop-blur shadow-sm cursor-grab active:cursor-grabbing"
                onScroll={() => syncScroll("float")}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
              >
                <div ref={floatInnerRef} className="h-6" />
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
