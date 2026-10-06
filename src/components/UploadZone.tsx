import { useRef, useState } from 'react';

interface Props {
  onFile: (file: File) => void;
  onSample: () => void;
  loading: boolean;
  error: { message: string; missing: string[] } | null;
}

/** Empty-state upload area: click, keyboard or drag-and-drop a catalogue file. */
export function UploadZone({ onFile, onSample, loading, error }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  return (
    <div className="upload-wrap">
      <div
        className={`dropzone${over ? ' over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOver(false);
          const f = e.dataTransfer.files[0];
          if (f) onFile(f);
        }}
      >
        {loading ? (
          <div className="loading" role="status"><span className="spinner" aria-hidden="true" /> Reading catalogue…</div>
        ) : (
          <>
            <div className="drop-icon" aria-hidden="true">⇪</div>
            <p className="drop-title">Step 1 · Upload your catalogue</p>
            <p className="muted">Drag an Excel file (.xlsx) here, or</p>
            <div className="row-gap">
              <button className="btn primary" onClick={() => input.current?.click()}>Choose file…</button>
              <button className="btn" onClick={onSample}>Use sample catalogue</button>
            </div>
            <p className="muted small">
              One row per SKU (style + colour + size). Required columns: <code>Style_Code</code>, <code>Style_Name</code>,{' '}
              <code>IK_Colour_Name</code>, <code>Size_Code</code>, <code>MRP</code>, <code>Brick</code>.
              Sizes are read from the file — nothing is hard-coded.
            </p>
          </>
        )}
        <input
          ref={input}
          type="file"
          accept=".xlsx,.xls,.csv"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) onFile(f);
          }}
        />
      </div>
      {error && <UploadError error={error} />}
    </div>
  );
}

export function UploadError({ error }: { error: { message: string; missing: string[] } }) {
  return (
    <div className="alert error" role="alert">
      <b>Couldn't load that file.</b> {error.missing.length ? 'These required columns are missing:' : error.message}
      {error.missing.length > 0 && (
        <ul>
          {error.missing.map((m) => <li key={m}><code>{m}</code></li>)}
        </ul>
      )}
      {error.missing.length > 0 && <div className="small">Check the first row of the first sheet holds the column headers.</div>}
    </div>
  );
}
