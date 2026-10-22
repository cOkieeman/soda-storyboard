import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

const modalStack: string[] = [];
export function isComposingEvent(event: { isComposing?: boolean; keyCode?: number }) {
  return Boolean(event.isComposing || event.keyCode === 229);
}

type Props = {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  busy?: boolean;
  className?: string;
  initialFocusRef?: RefObject<HTMLElement>;
};

export default function ModalShell({ title, description, children, footer, onClose, busy = false, className = "max-w-2xl", initialFocusRef }: Props) {
  const id = useId();
  const backdrop = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const latest = useRef({ onClose, busy });
  latest.current = { onClose, busy };
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const hidden = [...document.body.children].filter(element => element !== backdrop.current).map(element => ({ element, inert: element.hasAttribute("inert") }));
    hidden.forEach(({ element }) => element.setAttribute("inert", ""));
    modalStack.push(id);
    const focusable = () => [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]') || [])].filter(element => element.getClientRects().length && !element.closest("[inert]"));
    const timer = window.setTimeout(() => (initialFocusRef?.current || dialog.current?.querySelector<HTMLElement>('[data-autofocus], input:not(:disabled), textarea:not(:disabled), select:not(:disabled)') || dialog.current)?.focus(), 0);
    const keyboard = (event: KeyboardEvent) => {
      if (modalStack[modalStack.length - 1] !== id || isComposingEvent(event)) return;
      if (event.key === "Escape" && !dialog.current?.contains(document.activeElement) && !event.defaultPrevented) {
        event.preventDefault(); event.stopPropagation();
        if (!latest.current.busy) latest.current.onClose();
      } else if (event.key === "Tab") {
        const items = focusable(), first = items[0], last = items[items.length - 1];
        if (!first) { event.preventDefault(); dialog.current?.focus(); }
        else if (event.shiftKey && (document.activeElement === first || !dialog.current?.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !dialog.current?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", keyboard, true);
    return () => {
      clearTimeout(timer); document.removeEventListener("keydown", keyboard, true);
      const index = modalStack.lastIndexOf(id); if (index >= 0) modalStack.splice(index, 1);
      hidden.forEach(({ element, inert }) => { if (!inert) element.removeAttribute("inert"); });
      if (previous?.isConnected) previous.focus();
    };
  }, [id, initialFocusRef]);
  return createPortal(<div ref={backdrop} className="modal-scrim fixed inset-0 z-[70] flex items-center justify-center bg-[var(--scrim)] p-4" onKeyDown={event => { if (event.key === "Escape" && !event.defaultPrevented && !isComposingEvent(event.nativeEvent) && !busy && modalStack[modalStack.length - 1] === id) { event.preventDefault(); onClose(); } event.stopPropagation(); }} onPointerDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={description ? `${id}-description` : undefined} aria-busy={busy} tabIndex={-1} className={`modal-shell flex max-h-[92dvh] w-full flex-col border border-[var(--rule)] bg-[var(--paper-lift)] text-[var(--ink)] shadow-[var(--shadow)] ${className}`}>
      <header className="modal-heading flex shrink-0 items-start justify-between gap-4 border-b border-[var(--line)] px-5 py-4"><div className="min-w-0"><h2 id={`${id}-title`} className="font-serif text-lg font-semibold">{title}</h2>{description && <p id={`${id}-description`} className="mt-1 text-sm text-[var(--muted)]">{description}</p>}</div><button type="button" className="icon-button" aria-label={`关闭${title}`} title="关闭 · Esc" disabled={busy} onClick={onClose}><X aria-hidden="true" /></button></header>
      <div className="modal-content min-h-0 flex-1 overflow-auto">{children}</div>
      {footer && <footer className="modal-footer flex shrink-0 flex-wrap items-center justify-end gap-3 border-t border-[var(--line)] px-5 py-3">{footer}</footer>}
    </div>
  </div>, document.body);
}
