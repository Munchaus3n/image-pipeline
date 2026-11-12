import {
  useCallback, useEffect, useId, useLayoutEffect, useRef, useState,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, ChevronRight, Search, X } from "lucide-react";
import { useUiPref } from "../../hooks/useUiPref.js";

const cx = (...parts) => parts.filter(Boolean).join(" ");

/* ---------------------------------------------------------------- Buttons */

export function Button({
  variant = "secondary", size = "m", icon, iconEnd,
  className, children, type = "button", ...rest
}) {
  const Icon = icon;
  const IconEnd = iconEnd;
  return (
    <button type={type} className={cx("ui-btn", `ui-btn-${variant}`, `ui-btn-${size}`, className)} {...rest}>
      {Icon ? <Icon size={14} aria-hidden="true" /> : null}
      {children != null ? <span className="ui-btn-label">{children}</span> : null}
      {IconEnd ? <IconEnd size={14} aria-hidden="true" /> : null}
    </button>
  );
}

export function IconButton({
  icon, label, variant = "ghost", size = "m", className, type = "button", ...rest
}) {
  const Icon = icon;
  return (
    <button
      type={type}
      className={cx("ui-btn", "ui-icon-btn", `ui-btn-${variant}`, `ui-btn-${size}`, className)}
      aria-label={label}
      title={label}
      {...rest}
    >
      <Icon size={size === "s" ? 13 : 15} aria-hidden="true" />
    </button>
  );
}

/* ----------------------------------------------------------------- Fields */

export function TextField({ className, mono, ...rest }) {
  return <input className={cx("ui-field", mono && "ui-mono", className)} {...rest} />;
}

export function SearchField({
  value, onChange, placeholder = "Search", className, onKeyDown, ...rest
}) {
  return (
    <div className={cx("ui-search", className)}>
      <Search size={14} className="ui-search-icon" aria-hidden="true" />
      <input
        className="ui-field ui-search-input"
        type="text"
        value={value}
        placeholder={placeholder}
        aria-label={rest["aria-label"] || placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && value) {
            e.stopPropagation();
            onChange("");
          }
          onKeyDown?.(e);
        }}
        {...rest}
      />
      {value ? (
        <button type="button" className="ui-search-clear" aria-label="Clear search" onClick={() => onChange("")}>
          <X size={13} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

export function Select({ className, children, ...rest }) {
  return (
    <span className={cx("ui-select", className)}>
      <select className="ui-field" {...rest}>{children}</select>
      <ChevronDown size={14} className="ui-select-icon" aria-hidden="true" />
    </span>
  );
}

export function Checkbox({ label, className, ...rest }) {
  return (
    <label className={cx("ui-check", className)}>
      <input type="checkbox" {...rest} />
      {label ? <span>{label}</span> : null}
    </label>
  );
}

export function Switch({ checked, onChange, label, disabled, className, ...rest }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={!!checked}
      disabled={disabled}
      className={cx("ui-switch", checked && "is-on", className)}
      onClick={() => onChange?.(!checked)}
      {...rest}
    >
      <span className="ui-switch-track" aria-hidden="true"><span className="ui-switch-thumb" /></span>
      {label ? <span className="ui-switch-label">{label}</span> : null}
    </button>
  );
}

export function SegmentedControl({
  options, value, onChange, size = "m", label, className,
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cx("ui-seg", `ui-seg-${size}`, className)}>
      {options.map((opt) => {
        const o = typeof opt === "object" ? opt : { value: opt, label: String(opt) };
        const selected = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={selected}
            title={o.title}
            disabled={o.disabled}
            className={cx("ui-seg-item", selected && "is-selected")}
            onClick={() => onChange(o.value)}
          >
            {o.dot ? <span className="ui-dot" style={{ background: o.dot }} aria-hidden="true" /> : null}
            {o.icon ? <o.icon size={14} aria-hidden="true" /> : null}
            {o.label != null ? <span>{o.label}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/* A labelled number box that commits on blur/Enter and clamps to [min, max]. */
export function NumberField({
  value, onChange, min, max, step = 1, decimals = 0, suffix, className, ...rest
}) {
  const shown = Number.isFinite(value) ? Number(value).toFixed(decimals) : "";
  const [draft, setDraft] = useState(null);

  const commit = () => {
    if (draft == null) return;
    const parsed = parseFloat(String(draft).replace(",", "."));
    setDraft(null);
    if (!Number.isFinite(parsed)) return;
    let next = parsed;
    if (min != null) next = Math.max(min, next);
    if (max != null) next = Math.min(max, next);
    onChange(next);
  };

  return (
    <span className={cx("ui-number", className)}>
      <input
        className="ui-field ui-mono"
        inputMode="decimal"
        step={step}
        value={draft ?? shown}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commit(); e.currentTarget.blur(); }
          if (e.key === "Escape") { e.stopPropagation(); setDraft(null); e.currentTarget.blur(); }
        }}
        {...rest}
      />
      {suffix ? <span className="ui-number-suffix">{suffix}</span> : null}
    </span>
  );
}

/* Range slider with an editable value next to it. */
export function Slider({
  value, onChange, min, max, step = 0.01, decimals = 2, display, parse,
  label, suffix, onPointerDown, className,
}) {
  return (
    <div className={cx("ui-slider", className)}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onPointerDown={onPointerDown}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
      <NumberField
        value={display ? display(value) : value}
        onChange={(v) => onChange(parse ? parse(v) : v)}
        decimals={decimals}
        suffix={suffix}
        aria-label={label ? `${label} value` : undefined}
      />
    </div>
  );
}

/* ---------------------------------------------------------------- Section */

export function Section({
  title, prefKey, defaultOpen = true, actions, badge, children, className,
}) {
  const [open, setOpen] = useUiPref(`sec.${prefKey || title}`, defaultOpen);
  const bodyId = useId();
  return (
    <section className={cx("ui-section", open && "is-open", className)}>
      <header className="ui-section-head">
        <button
          type="button"
          className="ui-section-toggle"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen(!open)}
        >
          <ChevronRight size={14} className="ui-section-chevron" aria-hidden="true" />
          <span className="ui-section-title">{title}</span>
          {badge != null ? <span className="ui-badge">{badge}</span> : null}
        </button>
        {actions ? <div className="ui-section-actions">{actions}</div> : null}
      </header>
      {open ? <div id={bodyId} className="ui-section-body">{children}</div> : null}
    </section>
  );
}

/* ---------------------------------------------------------------- Popover */

// Positioned with position:fixed from the anchor's rect, so it is never clipped
// by an overflow:hidden ancestor. Flips above the anchor when there is no room below.
export function Popover({
  open, onClose, anchorRef, children, width, minWidth, maxHeight = 360,
  align = "start", className, label,
}) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);

  const place = useCallback(() => {
    const anchor = anchorRef?.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const margin = 8;
    const w = width || Math.max(rect.width, minWidth || 0);
    const below = window.innerHeight - rect.bottom - margin;
    const above = rect.top - margin;
    const flip = below < 200 && above > below;
    const avail = Math.max(120, flip ? above : below);
    let left = align === "end" ? rect.right - w : rect.left;
    left = Math.min(Math.max(margin, left), Math.max(margin, window.innerWidth - w - margin));
    setPos({
      left,
      width: w,
      maxHeight: Math.min(maxHeight, avail),
      ...(flip ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
    });
  }, [anchorRef, width, minWidth, maxHeight, align]);

  useLayoutEffect(() => {
    if (!open) return undefined;
    const frame = requestAnimationFrame(place);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, place]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (ref.current?.contains(e.target) || anchorRef?.current?.contains(e.target)) return;
      onClose();
    };
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, onClose, anchorRef]);

  if (!open || !pos) return null;
  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      className={cx("ui-popover", className)}
      style={pos}
      // Keep keystrokes inside the popover away from screen-level shortcuts.
      onKeyDown={(e) => e.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------------ Modal */

const FOCUSABLE = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

export function Modal({ open, title, onClose, children, footer, width = 420 }) {
  const ref = useRef(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement;
    const node = ref.current;
    node?.querySelector("[data-autofocus]")?.focus?.() ?? node?.querySelector(FOCUSABLE)?.focus?.();
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose?.();
        return;
      }
      if (e.key !== "Tab" || !node) return;
      const items = [...node.querySelectorAll(FOCUSABLE)];
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      previous?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div className="ui-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="ui-modal"
        style={{ width: `min(${width}px, calc(100vw - 32px))` }}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="ui-modal-title">{title}</h2>
        <div className="ui-modal-body">{children}</div>
        {footer ? <div className="ui-modal-footer">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

/* --------------------------------------------------------- ResizablePanel */

// A side panel with a drag handle. Width is remembered under `prefKey`.
// Double-click the handle to reset; Arrow keys resize when the handle is focused.
export function ResizablePanel({
  prefKey, side = "right", defaultWidth = 300, min = 240, max = 480,
  collapsed = false, className, children, ...rest
}) {
  const [stored, setStored] = useUiPref(`w.${prefKey}`, defaultWidth);
  const width = Math.min(max, Math.max(min, Number(stored) || defaultWidth));
  const [dragging, setDragging] = useState(false);
  const startRef = useRef(null);

  const onPointerDown = (e) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    startRef.current = { x: e.clientX, w: width };
    setDragging(true);
  };
  const onPointerMove = (e) => {
    if (!startRef.current) return;
    const delta = (e.clientX - startRef.current.x) * (side === "right" ? -1 : 1);
    setStored(Math.min(max, Math.max(min, Math.round(startRef.current.w + delta))));
  };
  const endDrag = () => { startRef.current = null; setDragging(false); };
  const onKeyDown = (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    e.stopPropagation();
    const dir = (e.key === "ArrowRight" ? 1 : -1) * (side === "right" ? -1 : 1);
    setStored(Math.min(max, Math.max(min, width + dir * (e.shiftKey ? 32 : 8))));
  };

  if (collapsed) return null;
  return (
    <aside
      className={cx("ui-panel", `ui-panel-${side}`, dragging && "is-dragging", className)}
      style={{ width, flexBasis: width }}
      {...rest}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panel"
        aria-valuenow={width}
        aria-valuemin={min}
        aria-valuemax={max}
        tabIndex={0}
        className="ui-panel-handle"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={() => setStored(defaultWidth)}
        onKeyDown={onKeyDown}
      />
      {children}
    </aside>
  );
}

/* -------------------------------------------------------------- StatusBar */

export function StatusBar({ left, right, className }) {
  return (
    <footer className={cx("ui-statusbar", className)}>
      <div className="ui-statusbar-side">{left}</div>
      <div className="ui-statusbar-side ui-statusbar-right">{right}</div>
    </footer>
  );
}

/* -------------------------------------------------------- Menu (in popover) */

// A short list of choices for use inside <Popover>. Shows a check on the current one.
export function MenuList({ items, value, onSelect }) {
  return (
    <ul className="ui-menu" role="listbox">
      {items.map((item) => (
        <li key={String(item.value)} role="option" aria-selected={item.value === value}>
          <button type="button" className="ui-menu-item" onClick={() => onSelect(item.value)}>
            <span className="ui-menu-check">{item.value === value ? <Check size={14} aria-hidden="true" /> : null}</span>
            <span>{item.label}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
