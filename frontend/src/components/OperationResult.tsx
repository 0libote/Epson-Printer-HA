import { Check, X } from "lucide-react";
import type { ReactNode } from "react";

export function OperationResult({
  title,
  description,
  dismissLabel,
  onDismiss,
  children,
}: Readonly<{
  title: string;
  description: string;
  dismissLabel: string;
  onDismiss: () => void;
  children: ReactNode;
}>) {
  return (
    <output className="operation-result">
      <span className="result-icon">
        <Check size={20} />
      </span>
      <span className="result-body">
        <strong>{title}</strong>
        <span className="result-description">{description}</span>
        {children}
      </span>
      <button
        type="button"
        className="icon-button"
        aria-label={dismissLabel}
        onClick={onDismiss}
      >
        <X size={16} />
      </button>
    </output>
  );
}
