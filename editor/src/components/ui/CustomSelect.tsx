import React, { useEffect, useRef, useState } from "react";

export interface CustomSelectOption<T extends string | number = string> {
  value: T;
  label: string;
}

interface CustomSelectProps<T extends string | number = string> {
  value: T;
  options: CustomSelectOption<T>[];
  onChange: (value: T) => void;
  placeholder?: string;
  className?: string;
}

export default function CustomSelect<T extends string | number = string>({
  value,
  options,
  onChange,
  placeholder,
  className = ""
}: CustomSelectProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const selectedOption = options.find((opt) => opt.value === value);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div ref={containerRef} className={`relative select-none ${className}`}>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex w-full items-center justify-between border border-[var(--line)] bg-[var(--paper-lift)] px-2.5 py-1.5 text-xs text-[var(--ink)] font-medium rounded hover:border-[var(--ink)] transition focus:outline-none focus:border-[var(--signal)]"
      >
        <span className="truncate">
          {selectedOption ? selectedOption.label : placeholder || "请选择"}
        </span>
        <span className="ml-1 text-[10px] text-[var(--ink-light)] transition-transform duration-150 transform">
          {isOpen ? "▲" : "▼"}
        </span>
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute left-0 top-full z-50 mt-1 w-full min-w-[140px] max-h-56 overflow-y-auto rounded border border-[var(--ink)] bg-[var(--paper-surface)] p-1 shadow-2xl font-sans">
          {options.map((opt) => {
            const isSelected = opt.value === value;
            return (
              <div
                key={String(opt.value)}
                onClick={() => {
                  onChange(opt.value);
                  setIsOpen(false);
                }}
                className={`flex items-center justify-between px-2.5 py-1.5 text-xs cursor-pointer rounded transition ${
                  isSelected
                    ? "bg-[var(--signal)] text-white font-bold"
                    : "text-[var(--ink)] hover:bg-[var(--paper-wash)]"
                }`}
              >
                <span className="truncate">{opt.label}</span>
                {isSelected && <span className="ml-2 font-mono text-xs">✓</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
