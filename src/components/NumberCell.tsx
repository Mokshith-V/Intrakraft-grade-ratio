import { useState } from 'react';

interface Props {
  value: number;
  min?: number;
  onCommit: (n: number) => void;
  label: string;
  className?: string;
}

/**
 * Whole-number input. Valid values commit as you type; invalid text is flagged and reverted on blur.
 * A local draft exists only while typing, so outside changes (e.g. Set Ratio) show immediately.
 */
export function NumberCell({ value, min = 0, onCommit, label, className = '' }: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? String(value);
  const n = Number(text);
  const valid = text.trim() !== '' && Number.isInteger(n) && n >= min;

  return (
    <input
      className={`qty ${className}${valid ? '' : ' invalid'}`}
      inputMode="numeric"
      value={text}
      aria-label={label}
      aria-invalid={!valid}
      title={valid ? undefined : `Whole number ${min} or more`}
      onChange={(e) => {
        const t = e.target.value;
        setDraft(t);
        const v = Number(t);
        if (t.trim() !== '' && Number.isInteger(v) && v >= min && v !== value) onCommit(v);
      }}
      onFocus={(e) => e.target.select()}
      onBlur={() => setDraft(null)}
    />
  );
}
