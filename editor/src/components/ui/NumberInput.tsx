import { useEffect, useId, useRef, useState, type InputHTMLAttributes } from "react";
import { isComposingEvent } from "../modals/ModalShell";

export function parseNumberDraft(raw: string, options: { min?: number; max?: number; integer?: boolean } = {}): { value?: number; error?: string } {
  if (!raw.trim()) return { error: "请输入数值" };
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(raw.trim())) return { error: "请输入有效数值" };
  const value = Number(raw);
  if (!Number.isFinite(value)) return { error: "请输入有效数值" };
  if (options.integer && !Number.isInteger(value)) return { error: "请输入整数" };
  if (options.min !== undefined && value < options.min) return { error: `最小为 ${options.min}` };
  if (options.max !== undefined && value > options.max) return { error: `最大为 ${options.max}` };
  return { value };
}

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type" | "min" | "max" | "onBlur" | "onKeyDown"> & {
  value: number | null;
  onCommit: (value: number) => void;
  min?: number;
  max?: number;
  integer?: boolean;
  onValidityChange?: (valid: boolean) => void;
};

export default function NumberInput({ value, onCommit, min, max, integer, onValidityChange, className = "ui-input numeric", ...props }: Props) {
  const [draft, setDraft] = useState(value === null ? "" : String(value));
  const [error, setError] = useState<string>();
  const dirty = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const errorId = useId();
  useEffect(() => { if (!dirty.current) setDraft(value === null ? "" : String(value)); }, [value]);
  const cancel = () => { dirty.current = false; setDraft(value === null ? "" : String(value)); setError(undefined); onValidityChange?.(true); };
  const commit = () => {
    if (!dirty.current) return;
    const result = parseNumberDraft(draft, { min, max, integer });
    setError(result.error); onValidityChange?.(!result.error);
    if (result.value === undefined) return;
    dirty.current = false; setDraft(String(result.value));
    if (result.value !== value) onCommit(result.value);
  };
  return <span className="number-field min-w-0"><input {...props} ref={input} type="text" inputMode={integer ? "numeric" : "decimal"} role="spinbutton" aria-valuenow={value ?? undefined} aria-valuemin={min} aria-valuemax={max} aria-invalid={Boolean(error)} aria-describedby={error ? errorId : props["aria-describedby"]} value={draft} className={className} onChange={event => { dirty.current = true; setDraft(event.target.value); setError(undefined); onValidityChange?.(parseNumberDraft(event.target.value, { min, max, integer }).value !== undefined); }} onBlur={commit} onKeyDown={event => {
    if (isComposingEvent(event.nativeEvent)) return;
    if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); commit(); }
    else if (event.key === "Escape" && (dirty.current || error)) { event.preventDefault(); event.stopPropagation(); cancel(); }
    else if (event.key === "ArrowUp" || event.key === "ArrowDown") { event.preventDefault(); const current = parseNumberDraft(draft).value ?? value ?? 0; const next = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, current + (event.key === "ArrowUp" ? 1 : -1) * Number(props.step || 1))); dirty.current = false; setDraft(String(next)); setError(undefined); onValidityChange?.(true); onCommit(next); }
  }} />{error && <span id={errorId} role="alert" className="mt-1 block text-xs text-[var(--error)]">{error}</span>}</span>;
}
