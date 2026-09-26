import { useEffect, useRef, useState, type ReactNode } from "react";
import { create } from "zustand";
import { useUi } from "../store/ui";

export function Modal({
  title,
  onClose,
  children,
  footer,
  size = "medium",
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: "small" | "medium" | "large";
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal modal-${size}`} role="dialog">
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} title="Close (Esc)">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

/** A button that opens a dropdown panel; closes on outside click or item click. */
export function Dropdown({
  label,
  title,
  children,
  align = "left",
  className,
  disabled,
}: {
  label: ReactNode;
  title?: string;
  children: (close: () => void) => ReactNode;
  align?: "left" | "right";
  className?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className={`dropdown ${className ?? ""}`} ref={ref}>
      <button className={`tb-btn ${open ? "active" : ""}`} title={title} disabled={disabled} onClick={() => setOpen(!open)}>
        {label} <span className="caret">▾</span>
      </button>
      {open && <div className={`dropdown-panel align-${align}`}>{children(() => setOpen(false))}</div>}
    </div>
  );
}

// ---- confirm dialog --------------------------------------------------------

interface ConfirmRequest {
  message: ReactNode;
  confirmLabel: string;
  danger: boolean;
  resolve: (ok: boolean) => void;
}

const useConfirmStore = create<{ req: ConfirmRequest | null }>(() => ({ req: null }));

/** Promise-based replacement for window.confirm. */
export function confirmAsync(message: ReactNode, opts: { confirmLabel?: string; danger?: boolean } = {}): Promise<boolean> {
  return new Promise((resolve) => {
    useConfirmStore.setState({
      req: { message, confirmLabel: opts.confirmLabel ?? "OK", danger: opts.danger ?? false, resolve },
    });
  });
}

export function ConfirmHost() {
  const req = useConfirmStore((s) => s.req);
  if (!req) return null;
  const done = (ok: boolean) => {
    useConfirmStore.setState({ req: null });
    req.resolve(ok);
  };
  return (
    <Modal
      title="Are you sure?"
      size="small"
      onClose={() => done(false)}
      footer={
        <>
          <button onClick={() => done(false)}>Cancel</button>
          <button className={req.danger ? "danger" : "primary"} autoFocus onClick={() => done(true)}>
            {req.confirmLabel}
          </button>
        </>
      }
    >
      <p>{req.message}</p>
    </Modal>
  );
}

export function Toast() {
  const toast = useUi((s) => s.toast);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!toast) return;
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 3500);
    return () => clearTimeout(t);
  }, [toast]);
  if (!toast || !visible) return null;
  return <div className="toast">{toast.text}</div>;
}

/** Number input that only commits valid values (on blur / Enter). */
export function NumberField({
  value,
  onCommit,
  min,
  max,
  step = 1,
  integer = false,
  className,
}: {
  value: number;
  onCommit: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  integer?: boolean;
  className?: string;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    let v = Number(text);
    if (!Number.isFinite(v) || text.trim() === "") {
      setText(String(value));
      return;
    }
    if (integer) v = Math.round(v);
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    setText(String(v));
    if (v !== value) onCommit(v);
  };
  return (
    <input
      type="number"
      className={className}
      value={text}
      step={step}
      min={min}
      max={max}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && commit()}
    />
  );
}
