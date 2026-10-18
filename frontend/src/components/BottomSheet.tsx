import { X } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

/** Modal sheet: slides from the bottom on phones, centred dialog on wide screens. */
export function BottomSheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const { t } = useTranslation();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="qq-fade-in fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 md:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="qq-sheet-in max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-card p-4 shadow-xl md:rounded-3xl"
        style={{ paddingBottom: "max(1rem, var(--safe-b))" }}
      >
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-muted md:hidden" aria-hidden />
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold">{title}</h2>
          <button type="button" onClick={onClose} aria-label={t("common.close")} className="rounded-full p-2 hover:bg-muted">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
