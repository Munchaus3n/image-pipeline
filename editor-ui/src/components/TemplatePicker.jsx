import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Popover, SearchField, Select } from "./ui/index.jsx";
import TemplateThumb from "./TemplateThumb.jsx";
import { TEMPLATE_SORTS, useTemplateList } from "../hooks/useTemplateList.js";
import { useUiPref } from "../hooks/useUiPref.js";
import { zoneColor } from "../utils/zones.js";

export const NO_TEMPLATE = "— none —";
const NO_ZONES = [];

// Searchable replacement for the native <select>. `value` is the template name or
// NO_TEMPLATE; choosing calls onChange(name) exactly like the old select did.
// Search and sort match the Templates screen (the sort choice is shared).
export default function TemplatePicker({ templates, value, onChange, onClosed }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useUiPref("templates.sort", "name-asc");
  // null = follow the default (current template, or first match while searching)
  const [pickedCursor, setCursor] = useState(null);
  const triggerRef = useRef(null);
  const listRef = useRef(null);
  const listId = useId();

  const rows = useTemplateList(templates, { query, sort, zones: NO_ZONES });
  // "None" is always first so clearing a template is one click.
  const options = useMemo(
    () => [{ name: NO_TEMPLATE, tpl: null }, ...rows.filter(r => r.name !== NO_TEMPLATE)],
    [rows],
  );

  const current = value && value !== NO_TEMPLATE ? templates[value] : null;
  const defaultCursor = query
    ? (options.length > 1 ? 1 : 0)
    : Math.max(0, options.findIndex(o => o.name === value));
  const cursor = Math.min(pickedCursor ?? defaultCursor, options.length - 1);

  const close = () => {
    setOpen(false);
    setQuery("");
    setCursor(null);
    onClosed?.();
  };

  const choose = (name) => {
    onChange(name);
    close();
  };

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector(`[data-index="${cursor}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, cursor]);

  const onKeyDown = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setCursor(Math.min(options.length - 1, cursor + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setCursor(Math.max(0, cursor - 1)); }
    else if (e.key === "Home") { e.preventDefault(); setCursor(0); }
    else if (e.key === "End") { e.preventDefault(); setCursor(options.length - 1); }
    else if (e.key === "Enter") {
      e.preventDefault();
      const picked = options[cursor];
      if (picked) choose(picked.name);
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="tpl-picker-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => { if (open) close(); else { setCursor(null); setOpen(true); } }}
      >
        <span className="ui-dot" style={{ background: zoneColor(current?.zone) }} aria-hidden="true" />
        <span className="tpl-picker-name">{current ? value : "No template"}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>

      <Popover
        open={open}
        onClose={close}
        anchorRef={triggerRef}
        minWidth={288}
        maxHeight={440}
        label="Choose template"
        className="tpl-picker-popover"
      >
        <div className="tpl-picker-tools" onKeyDown={onKeyDown}>
          <SearchField
            value={query}
            onChange={(v) => { setQuery(v); setCursor(null); }}
            placeholder="Search templates"
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={`${listId}-${cursor}`}
          />
          <Select
            value={sort}
            onChange={e => setSort(e.target.value)}
            aria-label="Sort templates"
            className="tpl-picker-sort"
            onKeyDown={e => e.stopPropagation()}
          >
            {TEMPLATE_SORTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </Select>
        </div>

        <ul id={listId} ref={listRef} role="listbox" className="tpl-picker-list">
          {options.map(({ name, tpl }, index) => {
            const selected = name === value || (name === NO_TEMPLATE && !current);
            return (
              <li
                key={name}
                id={`${listId}-${index}`}
                role="option"
                data-index={index}
                aria-selected={selected}
                className={index === cursor ? "tpl-picker-option is-cursor" : "tpl-picker-option"}
                onMouseMove={() => setCursor(index)}
                onClick={() => choose(name)}
              >
                <span className="tpl-picker-check">{selected ? <Check size={14} aria-hidden="true" /> : null}</span>
                {tpl ? (
                  <>
                    <span className="ui-dot" style={{ background: zoneColor(tpl.zone) }} aria-hidden="true" />
                    <span className="tpl-picker-text">
                      <span className="tpl-picker-option-name">{name}</span>
                      {tpl.match ? <span className="tpl-picker-option-sub">{tpl.match}</span> : null}
                    </span>
                    {tpl.ref_image ? <TemplateThumb refImage={tpl.ref_image} size={28} /> : null}
                  </>
                ) : (
                  <span className="tpl-picker-text"><span className="tpl-picker-option-name">No template</span></span>
                )}
              </li>
            );
          })}
          {options.length === 1 && query ? <li className="tpl-picker-empty">No templates match</li> : null}
        </ul>
      </Popover>
    </>
  );
}
