import { useEffect, useRef, useState } from "react";
import { FileText } from "lucide-react";

export const PRINT_FILE_TYPES = [".pdf", ".png", ".jpg", ".jpeg", ".txt"];

function DocumentDrop({
  file,
  max,
  busy,
  onChoose,
  onPick,
  onError,
}: Readonly<{
  file: File | null;
  max: number;
  busy: boolean;
  onChoose: () => void;
  onPick: (file: File | null) => void;
  onError: (message: string) => void;
}>) {
  const [dragOver, setDragOver] = useState(false);
  const dragDepth = useRef(0);
  let title = file?.name || "Drop your document here";
  if (dragOver) title = "Drop your document here";
  return (
    <button
      type="button"
      className={`document-drop ${dragOver ? "is-dragging" : ""} ${file ? "has-file" : ""}`}
      disabled={busy}
      aria-label="Choose a file to print"
      onClick={onChoose}
      onDragEnter={(event) => {
        event.preventDefault();
        dragDepth.current++;
        setDragOver(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => {
        if (--dragDepth.current <= 0) {
          dragDepth.current = 0;
          setDragOver(false);
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        dragDepth.current = 0;
        setDragOver(false);
        if (event.dataTransfer.files.length > 1)
          onError(
            "Choose one document at a time so each has its own print settings.",
          );
        else onPick(event.dataTransfer.files[0]);
      }}
    >
      <span className="document-drop-art">
        {file ? (
          <FileText size={30} strokeWidth={1.4} />
        ) : (
          <FileText size={35} strokeWidth={1.3} />
        )}
      </span>
      <strong>{title}</strong>
      <span>
        {file ? (
          `${(file.size / 1024 / 1024).toFixed(2)} MB · Click to choose a different file`
        ) : (
          <>
            <u>Choose a file</u> from your device
          </>
        )}
      </span>
      <small>
        Up to {max} MB per document
      </small>
    </button>
  );
}

function DocumentPreview({ url, file }: Readonly<{ url: string; file: File }>) {
  return (
    <div className="document-preview">
      {/\.(png|jpe?g)$/i.test(file.name) ? (
        <img src={url} alt={`Preview of ${file.name}`} />
      ) : (
        <iframe src={url} title={`Preview of ${file.name}`} />
      )}
      <p>
        Original file preview. Paper and scaling settings apply when printed.
      </p>
    </div>
  );
}

export function PrintFilePicker({
  file,
  max,
  busy,
  onPick,
  onRemove,
  onError,
}: Readonly<{
  file: File | null;
  max: number;
  busy: boolean;
  onPick: (file: File | null) => void;
  onRemove: () => void;
  onError: (message: string) => void;
}>) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  useEffect(() => {
    setPreview(false);
    if (!file || !/\.(pdf|png|jpe?g)$/i.test(file.name)) {
      setPreviewUrl("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return (
    <>
      <input
        ref={fileRef}
        className="visually-hidden"
        type="file"
        disabled={busy}
        accept={PRINT_FILE_TYPES.join(",")}
        onChange={(event) => {
          onPick(event.target.files?.[0] || null);
          event.target.value = "";
        }}
        tabIndex={-1}
        aria-label="File to print"
      />
      <DocumentDrop
        file={file}
        max={max}
        busy={busy}
        onChoose={() => fileRef.current?.click()}
        onPick={onPick}
        onError={onError}
      />
      {file ? (
        <div className="file-toolbar">
          <span>
            <FileText size={14} /> Document selected
          </span>
          <div>
            {previewUrl ? (
              <button
                className="text-button"
                type="button"
                onClick={() => setPreview((value) => !value)}
              >
                {preview ? "Close preview" : "Preview file"}
              </button>
            ) : null}
            <button
              className="text-button"
              type="button"
              disabled={busy}
              onClick={onRemove}
            >
              Remove
            </button>
          </div>
        </div>
      ) : null}
      {preview && previewUrl && file ? (
        <DocumentPreview url={previewUrl} file={file} />
      ) : null}
    </>
  );
}
