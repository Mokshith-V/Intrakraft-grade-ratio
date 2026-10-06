const LABELS = ['Upload catalogue', 'Select products', 'Cart + Grades', 'Set ratio'];

/** Step tracker. `done` marks steps already completed; the first not-done step is current. */
export function Steps({ done }: { done: boolean[] }) {
  const current = done.findIndex((d) => !d);
  return (
    <ol className="steps" aria-label="Progress">
      {LABELS.map((label, i) => {
        const state = done[i] ? 'done' : i === current ? 'on' : '';
        return (
          <li key={label} className={`step ${state}`} aria-current={i === current ? 'step' : undefined}>
            <span className="step-dot" aria-hidden="true">{done[i] ? '✓' : i + 1}</span>
            {label}
            {done[i] && <span className="sr-only"> (done)</span>}
          </li>
        );
      })}
    </ol>
  );
}
