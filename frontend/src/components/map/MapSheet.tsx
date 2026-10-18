import { ChevronUp } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { SheetState } from "@/stores/mapui";

// "full" stops below the search field and the filter chips, so they stay usable
const HEIGHT: Record<SheetState, string> = { collapsed: "7.25rem", half: "50%", full: "calc(100% - 7.25rem - var(--safe-t))" };
const ORDER: SheetState[] = ["collapsed", "half", "full"];

/**
 * Bottom sheet of the map screen with three snap states (collapsed / half / full) on phones; a static side panel on
 * desktop. Only the handle area drags (vertical swipe) or toggles (tap), so the map underneath keeps its own pan/zoom
 * gestures and the content keeps normal scrolling.
 */
export function MapSheet({ state, onState, header, children, label, className }: {
  state: SheetState;
  onState: (s: SheetState) => void;
  header: ReactNode;
  children: ReactNode;
  label: string;
  className?: string;
}) {
  const startY = useRef<number | null>(null);
  const [drag, setDrag] = useState(0);

  const end = (dy: number) => {
    const i = ORDER.indexOf(state);
    if (dy < -40) onState(ORDER[Math.min(2, i + 1)]);
    else if (dy > 40) onState(ORDER[Math.max(0, i - 1)]);
    else if (Math.abs(dy) < 6) onState(ORDER[(i + 1) % 3]);
    setDrag(0);
    startY.current = null;
  };

  return (
    <section
      aria-label={label}
      className={cn(
        "absolute inset-x-0 bottom-0 z-20 flex h-[var(--sheet-h)] flex-col rounded-t-3xl border-t bg-card shadow-[0_-8px_24px_rgba(15,23,42,0.12)] md:static md:h-auto md:min-h-0 md:flex-1 md:rounded-2xl md:border md:shadow-sm",
        drag === 0 && "transition-[height] duration-200 ease-out",
        className,
      )}
      style={{ ["--sheet-h" as string]: `calc(${HEIGHT[state]} + ${drag}px)` }}
    >
      <div
        role="button"
        tabIndex={0}
        aria-label={label}
        aria-expanded={state !== "collapsed"}
        className="shrink-0 cursor-grab touch-none select-none px-4 pb-2 pt-2 md:cursor-default md:pt-4"
        onPointerDown={(e) => {
          // controls inside the header (close, back, actions) keep working as plain buttons
          if (window.innerWidth >= 768 || (e.target as HTMLElement).closest("button,a,input,select,textarea")) return;
          startY.current = e.clientY;
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e) => startY.current !== null && setDrag(Math.max(-400, Math.min(400, startY.current - e.clientY)))}
        onPointerUp={(e) => startY.current !== null && end(e.clientY - startY.current)}
        onPointerCancel={() => {
          setDrag(0);
          startY.current = null;
        }}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && e.target === e.currentTarget && onState(ORDER[(ORDER.indexOf(state) + 1) % 3])}
      >
        <div className="mx-auto mb-1.5 flex h-4 w-12 items-center justify-center md:hidden">
          <ChevronUp className={cn("h-5 w-5 text-muted-foreground transition-transform", state === "full" && "rotate-180")} />
        </div>
        {header}
      </div>
      <div className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4", state === "collapsed" && "max-md:overflow-hidden")}>{children}</div>
    </section>
  );
}
