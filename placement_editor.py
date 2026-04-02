# =============================================================
# IMAGE PIPELINE
# Version : v3.2
# Copyright (c) 2026 Liudas. Licensed under AGPL-3.0. See LICENSE.
# =============================================================

import json
import tkinter as tk
from tkinter import filedialog, messagebox, ttk
from PIL import Image, ImageTk
from pathlib import Path
import configparser
import shutil

# ── Load config ───────────────────────────────────────────────────────────────
_cfg = configparser.ConfigParser()
_cfg.read(Path(__file__).parent / "config.ini")

CANVAS_SIZE  = _cfg.getint("canvas", "canvas_size",  fallback=1440)
DISPLAY_SIZE = _cfg.getint("canvas", "display_size", fallback=760)
THUMB_SIZE   = _cfg.getint("canvas", "thumb_size",   fallback=72)

BASE_DIR      = Path(__file__).parent
OUTPUT_ROOT   = BASE_DIR / _cfg.get("paths", "output_root",   fallback="output")
TEMPLATES_DIR = BASE_DIR / _cfg.get("paths", "templates_dir", fallback="templates")
SESSION_FILE  = BASE_DIR / "session.json"

S              = DISPLAY_SIZE / CANVAS_SIZE
SUPPORTED_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".tiff"}

def _g(key, fallback):
    return _cfg.getint("guides", key, fallback=fallback)

GUIDES = {
    "red":     {"top": _g("red_top",140),     "bottom": _g("red_bottom",1300),
                "left": _g("red_left",140),   "right": _g("red_right",1300),   "color": "#ff5555"},
    "green":   {"top": _g("green_top",224),   "bottom": _g("green_bottom",1216),
                "left": _g("green_left",224), "right": _g("green_right",1216), "color": "#44dd44"},
    "blue":    {"top": _g("blue_top",284),    "bottom": _g("blue_bottom",1156),
                "left": _g("blue_left",284),  "right": _g("blue_right",1156),  "color": "#4499ff"},
    "magenta": {"top": _g("magenta_top",434), "bottom": _g("magenta_bottom",1006),
                "left": _g("magenta_left",434),"right": _g("magenta_right",1006),"color": "#ff44ff"},
}

TEMPLATES = {
    "— none —":          {"zone": None,      "hint": "",                               "ref": ""},
    "Machine":           {"zone": "green",   "hint": "Top + bottom touch green lines", "ref": "ref_machine.png"},
    "Bottle 1–1.5L":     {"zone": "green",   "hint": "Top + bottom touch green lines", "ref": "ref_bottle_1l.png"},
    "Bottle 0.5L":       {"zone": "blue",    "hint": "Top + bottom touch blue lines",  "ref": "ref_bottle_05l.png"},
    "Coffee bag large":  {"zone": "blue",    "hint": "Fill blue zone",                 "ref": "ref_coffee_large.png"},
    "Coffee bag small":  {"zone": "blue",    "hint": "Fill blue zone",                 "ref": "ref_coffee_small.png"},
    "Box large":         {"zone": "green",   "hint": "Fill green zone",                "ref": "ref_box_large.png"},
    "Box small":         {"zone": "magenta", "hint": "Fill magenta zone",              "ref": "ref_box_small.png"},
    "Capsules / small":  {"zone": "magenta", "hint": "Fill magenta zone",              "ref": "ref_capsules.png"},
    "Combo / multipack": {"zone": "green",   "hint": "Group fills green zone",         "ref": "ref_combo.png"},
}


# ── Helpers ────────────────────────────────────────────────────────────────────

def detect_source_folder() -> tuple[Path, str]:
    for folder, label in [
        (OUTPUT_ROOT / "bg_removed", "output/bg_removed"),
        (OUTPUT_ROOT / "upscaled",   "output/upscaled"),
        (BASE_DIR    / "input",      "input"),
    ]:
        if folder.exists() and any(
            p.suffix.lower() in SUPPORTED_EXTS
            for p in folder.rglob("*") if p.is_file()
        ):
            return folder, label
    return BASE_DIR / "input", "input"


def images_in_folder(folder: Path) -> list[Path]:
    return sorted(
        p for p in folder.rglob("*")
        if p.is_file() and p.suffix.lower() in SUPPORTED_EXTS
    )


def mirror_save_path(src: Path, src_root: Path) -> Path:
    try:
        rel = src.relative_to(src_root)
    except ValueError:
        rel = Path(src.name)
    return OUTPUT_ROOT / "final" / rel


# ── Product item ───────────────────────────────────────────────────────────────

class ProductItem:
    def __init__(self, image: Image.Image, filepath: Path):
        self.original  = image.convert("RGBA")
        self.filepath  = filepath
        self.label     = filepath.name
        self.canvas_x  = CANVAS_SIZE // 2
        self.canvas_y  = CANVAS_SIZE // 2
        self.scale     = 1.0
        self.tk_image  = None

    def current_size_canvas(self):
        return (int(self.original.width  * self.scale),
                int(self.original.height * self.scale))

    def top_left_display(self):
        w, h = self.current_size_canvas()
        return (int(self.canvas_x * S) - int(w * S) // 2,
                int(self.canvas_y * S) - int(h * S) // 2)

    def hit_test(self, ex, ey) -> bool:
        x, y = self.top_left_display()
        w, h = self.current_size_canvas()
        return x <= ex <= x + int(w * S) and y <= ey <= y + int(h * S)

    def rendered_display(self) -> ImageTk.PhotoImage:
        w = max(1, int(self.original.width  * self.scale * S))
        h = max(1, int(self.original.height * self.scale * S))
        self.tk_image = ImageTk.PhotoImage(self.original.resize((w, h), Image.LANCZOS)) # type: ignore
        return self.tk_image

    def snap_to_zone(self, zone: str):
        g = GUIDES[zone]
        self.scale    = (g["bottom"] - g["top"]) / self.original.height
        self.canvas_x = CANVAS_SIZE // 2
        self.canvas_y = (g["top"] + g["bottom"]) // 2

    def center_h(self): self.canvas_x = CANVAS_SIZE // 2
    def center_v(self): self.canvas_y = CANVAS_SIZE // 2

    def get_state(self) -> tuple:
        """Snapshot position+scale for undo."""
        return (self.canvas_x, self.canvas_y, self.scale)

    def set_state(self, state: tuple):
        """Restore from snapshot."""
        self.canvas_x, self.canvas_y, self.scale = state


# ── Editor ─────────────────────────────────────────────────────────────────────

class PlacementEditor:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.root.title("Placement Editor  |  1440×1440")
        self.root.configure(bg="#1e1e1e")
        self.root.resizable(False, False)

        self.items:    list[ProductItem] = []
        self.selected: ProductItem | None = None
        self._drag_offset  = (0, 0)
        self._queue:       list[Path] = []
        self._queue_index: int        = 0
        self._combo_mode:  bool       = False
        self._undo_state:  tuple | None = None   # single-level undo per item
        self._scale_locked = tk.BooleanVar(value=False)

        self._src_root, src_label = detect_source_folder()

        self._active_template = tk.StringVar(value="— none —")
        self._ref_image_pil:  Image.Image | None = None
        self._ref_tk:         ImageTk.PhotoImage | None = None
        self._ref_cache:      dict[str, Image.Image] = {}

        self._build_ui(src_label)

        # Keyboard bindings
        self.root.bind("<Return>",   lambda e: self._queue_save())
        self.root.bind("<KP_Enter>", lambda e: self._queue_save())
        self.root.bind("s",          lambda e: self._queue_skip())
        self.root.bind("S",          lambda e: self._queue_skip())
        self.root.bind("<Control-z>", lambda e: self._undo())
        self.root.bind("<Control-Z>", lambda e: self._undo())
        self.root.bind("<Left>",     lambda e: self._nudge_pos(-1, 0))
        self.root.bind("<Right>",    lambda e: self._nudge_pos( 1, 0))
        self.root.bind("<Up>",       lambda e: self._nudge_pos( 0,-1))
        self.root.bind("<Down>",     lambda e: self._nudge_pos( 0, 1))
        self.root.bind("<Shift-Left>",  lambda e: self._nudge_pos(-10, 0))
        self.root.bind("<Shift-Right>", lambda e: self._nudge_pos( 10, 0))
        self.root.bind("<Shift-Up>",    lambda e: self._nudge_pos(  0,-10))
        self.root.bind("<Shift-Down>",  lambda e: self._nudge_pos(  0, 10))

        # Save session on close
        self.root.protocol("WM_DELETE_WINDOW", self._on_close)

        # Try to resume previous session
        resumed = self._try_resume()
        if not resumed:
            self._reload_queue()

    # ── Layout ────────────────────────────────────────────────────────────────

    def _build_ui(self, src_label: str):
        left = tk.Frame(self.root, bg="#1e1e1e")
        left.pack(side=tk.LEFT, padx=8, pady=8)

        self.canvas = tk.Canvas(left, width=DISPLAY_SIZE, height=DISPLAY_SIZE,
                                bg="white", highlightthickness=1,
                                highlightbackground="#555", cursor="fleur")
        self.canvas.pack()
        self._draw_guides()

        self.canvas.bind("<Button-1>",        self._on_click)
        self.canvas.bind("<B1-Motion>",       self._on_drag)
        self.canvas.bind("<ButtonRelease-1>", self._on_drag_end)
        self.canvas.bind("<MouseWheel>",      self._on_scroll_win)
        self.canvas.bind("<Button-4>",        self._on_scroll_linux_up)
        self.canvas.bind("<Button-5>",        self._on_scroll_linux_down)

        right = tk.Frame(self.root, bg="#252525", width=230)
        right.pack(side=tk.RIGHT, fill=tk.Y, padx=(0, 8), pady=8)
        right.pack_propagate(False)

        p = {"pady": (0, 3), "fill": tk.X, "padx": 8}

        # ── Source folder ─────────────────────────────────────────────────────
        self._section(right, "SOURCE")
        self._src_label_var = tk.StringVar(value=f"  {src_label}")
        tk.Label(right, textvariable=self._src_label_var,
                 bg="#252525", fg="#44dd44", font=("Courier", 7),
                 wraplength=200, justify=tk.LEFT).pack(anchor=tk.W, padx=8)
        tk.Button(right, text="⟳  Change Folder",
                  command=self._change_source_folder, **self._btn()).pack(**p)

        # ── Queue ─────────────────────────────────────────────────────────────
        self._section(right, "QUEUE")
        self._queue_label = tk.Label(right, text="No images.",
                                     bg="#252525", fg="#44dd44",
                                     font=("Courier", 9, "bold"))
        self._queue_label.pack(anchor=tk.W, padx=8)

        self._combo_var = tk.BooleanVar(value=False)
        tk.Checkbutton(right, text="  Combo mode", variable=self._combo_var,
                       command=self._toggle_combo, bg="#252525", fg="white",
                       selectcolor="#333", activebackground="#252525",
                       font=("Arial", 8)).pack(anchor=tk.W, padx=8)

        tk.Button(right, text="✓  Save + Next  [Enter]", command=self._queue_save,
                  bg="#1a4a1a", fg="white", activebackground="#2a6a2a",
                  activeforeground="white", relief=tk.FLAT,
                  font=("Arial", 9, "bold"), width=22).pack(**p)
        tk.Button(right, text="→  Skip  [S]", command=self._queue_skip,
                  bg="#3a2a1a", fg="white", activebackground="#5a3a1a",
                  activeforeground="white", relief=tk.FLAT,
                  font=("Arial", 9), width=22).pack(**p)
        tk.Button(right, text="✕  Remove Selected",
                  command=self._remove_selected, **self._btn()).pack(**p)

        # ── Template ──────────────────────────────────────────────────────────
        self._section(right, "TEMPLATE")
        self._tmpl_combo = ttk.Combobox(right, textvariable=self._active_template,
                                        values=list(TEMPLATES.keys()),
                                        state="readonly", width=26)
        self._tmpl_combo.pack(padx=8, pady=(0, 2), fill=tk.X)
        self._tmpl_combo.bind("<<ComboboxSelected>>", lambda e: self._on_template_select())

        self._tmpl_hint = tk.Label(right, text="", bg="#252525", fg="#888888",
                                   font=("Arial", 7), wraplength=200, justify=tk.LEFT)
        self._tmpl_hint.pack(anchor=tk.W, padx=8, pady=(0, 2))

        # ── Snap / Align ──────────────────────────────────────────────────────
        self._section(right, "SNAP  /  ALIGN")
        snap_row = tk.Frame(right, bg="#252525")
        snap_row.pack(fill=tk.X, padx=8, pady=(0, 3))
        for lbl, zone, col in [("G","green","#44dd44"),("B","blue","#4499ff"),
                                ("M","magenta","#ff44ff"),("R","red","#ff5555")]:
            tk.Button(snap_row, text=lbl, width=4,
                      command=lambda z=zone: self._snap(z),
                      bg="#2a2a2a", fg=col, activebackground="#333",
                      activeforeground=col, relief=tk.FLAT,
                      font=("Arial", 8, "bold")).pack(side=tk.LEFT, expand=True, fill=tk.X, padx=1)

        align_row = tk.Frame(right, bg="#252525")
        align_row.pack(fill=tk.X, padx=8, pady=(0, 3))
        tk.Button(align_row, text="⟺ H-Center", command=lambda: self._align("h"),
                  **self._btn_small()).pack(side=tk.LEFT, expand=True, fill=tk.X, padx=(0,2))
        tk.Button(align_row, text="↕ V-Center", command=lambda: self._align("v"),
                  **self._btn_small()).pack(side=tk.LEFT, expand=True, fill=tk.X)

        # ── Scale ─────────────────────────────────────────────────────────────
        self._section(right, "SCALE  (selected)")
        self._scale_var = tk.DoubleVar(value=1.0)
        tk.Scale(right, from_=0.05, to=3.0, resolution=0.005,
                 variable=self._scale_var, orient=tk.HORIZONTAL,
                 command=self._on_scale_drag,
                 bg="#252525", fg="white", troughcolor="#444",
                 highlightthickness=0, length=210).pack(padx=8, pady=(0, 2))

        nudge = tk.Frame(right, bg="#252525")
        nudge.pack(fill=tk.X, padx=8, pady=(0, 2))
        for lbl, delta in [("−5%",-0.05),("−1%",-0.01),("+1%",0.01),("+5%",0.05)]:
            tk.Button(nudge, text=lbl, command=lambda d=delta: self._nudge_scale(d),
                      **self._btn_small()).pack(side=tk.LEFT, expand=True, fill=tk.X)

        tk.Checkbutton(right, text="  Lock scale",
                       variable=self._scale_locked,
                       bg="#252525", fg="#aaaaaa", selectcolor="#3a1a1a",
                       activebackground="#252525", font=("Arial", 8)
                       ).pack(anchor=tk.W, padx=8, pady=(0, 2))

        # ── Layers ────────────────────────────────────────────────────────────
        self._section(right, "CANVAS ITEMS")
        self._layer_frame = tk.Frame(right, bg="#252525")
        self._layer_frame.pack(fill=tk.X, padx=8)

        # ── Status ────────────────────────────────────────────────────────────
        self._status = tk.Label(right,
                                text="Drag=move  Scroll=resize\nArrows=nudge  Ctrl+Z=undo",
                                bg="#252525", fg="#555555", font=("Arial", 7),
                                wraplength=200, justify=tk.LEFT)
        self._status.pack(padx=8, pady=6, anchor=tk.W)

    # ── Session ───────────────────────────────────────────────────────────────

    def _save_session(self):
        try:
            data = {
                "src_root":    str(self._src_root),
                "queue_index": self._queue_index,
                "template":    self._active_template.get(),
            }
            SESSION_FILE.write_text(json.dumps(data))
        except Exception:
            pass

    def _try_resume(self) -> bool:
        if not SESSION_FILE.exists():
            return False
        try:
            data      = json.loads(SESSION_FILE.read_text())
            src_root  = Path(data["src_root"])
            idx       = int(data.get("queue_index", 0))
            template  = data.get("template", "— none —")
            if not src_root.exists():
                return False
            images = images_in_folder(src_root)
            if not images or idx >= len(images):
                return False
            answer = messagebox.askyesno(
                "Resume session",
                f"Resume from image {idx+1}/{len(images)}?\n{src_root.name}/"
            )
            if not answer:
                SESSION_FILE.unlink(missing_ok=True)
                return False
            self._src_root    = src_root
            self._queue       = images
            self._queue_index = idx
            if template in TEMPLATES:
                self._active_template.set(template)
            self._src_label_var.set(f"  {src_root.name}")
            self._update_queue_label()
            self._load_current()
            return True
        except Exception:
            return False

    def _on_close(self):
        if self._queue and self._queue_index < len(self._queue):
            self._save_session()
        else:
            SESSION_FILE.unlink(missing_ok=True)
        self.root.destroy()

    # ── Queue ─────────────────────────────────────────────────────────────────

    def _reload_queue(self):
        self._queue       = images_in_folder(self._src_root)
        self._queue_index = 0
        self.items        = []
        self.selected     = None
        self._combo_mode  = False
        self._combo_var.set(False)
        self._update_queue_label()
        if self._queue:
            self._load_current()
        else:
            self._status.config(text=f"No images in:\n{self._src_root.name}/")

    def _load_current(self):
        if self._queue_index >= len(self._queue):
            self._all_done()
            return
        path = self._queue[self._queue_index]
        img  = Image.open(path).convert("RGBA")
        item = ProductItem(img, path)

        tmpl = TEMPLATES.get(self._active_template.get(), {})
        item.snap_to_zone(tmpl.get("zone") or "green")

        if not self._combo_mode:
            self.items = [item]
        else:
            self.items.append(item)

        self.selected     = item
        self._undo_state  = None
        self._sync_scale_ui()
        self._redraw()
        self._update_layers()
        self._update_queue_label()
        self.root.title(f"Placement Editor  |  {path.name}")

    def _queue_save(self):
        if not self.items:
            return
        ref       = self.items[0].filepath
        save_path = mirror_save_path(ref, self._src_root)
        if len(self.items) > 1:
            save_path = save_path.with_name(save_path.stem + "_combo.png")
        save_path.parent.mkdir(parents=True, exist_ok=True)
        self._write(save_path)
        self._status.config(text=f"Saved:\n{save_path.name}")
        self._advance_queue()

    def _queue_skip(self):
        """Skip current image — copy to output/skipped/ for review."""
        if self._queue_index < len(self._queue):
            src = self._queue[self._queue_index]
            try:
                dst = OUTPUT_ROOT / "skipped" / src.name
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(src, dst)
            except Exception:
                pass
        self._status.config(text="Skipped.")
        self._advance_queue()

    def _advance_queue(self):
        self._queue_index += 1
        if not self._combo_mode:
            self.items    = []
            self.selected = None
        self._load_current()

    def _all_done(self):
        self.items    = []
        self.selected = None
        self._redraw()
        self._update_layers()
        self._update_queue_label()
        self.root.title("Placement Editor  |  Done")
        self._status.config(text="All images processed.\nOutput → output/final/")
        SESSION_FILE.unlink(missing_ok=True)
        messagebox.showinfo("Done", "All images processed.\nSaved to output/final/")

    def _toggle_combo(self):
        self._combo_mode = self._combo_var.get()

    def _update_queue_label(self):
        total = len(self._queue)
        if total == 0:
            self._queue_label.config(text="No images.")
            return
        self._queue_label.config(text=f"  {min(self._queue_index+1,total)} / {total}")

    # ── Undo ──────────────────────────────────────────────────────────────────

    def _save_undo(self):
        """Call before any transform to enable one-level undo."""
        if self.selected:
            self._undo_state = (self.selected, self.selected.get_state())

    def _undo(self):
        if self._undo_state is None:
            return
        item, state = self._undo_state
        item.set_state(state)
        self._undo_state = None
        self._sync_scale_ui()
        self._redraw()
        self._status.config(text="Undone.")

    # ── Template ──────────────────────────────────────────────────────────────

    def _on_template_select(self):
        tmpl = TEMPLATES.get(self._active_template.get(), {})
        self._tmpl_hint.config(text=tmpl.get("hint", ""))
        self._load_ref_image(tmpl.get("ref", ""))
        self._draw_guides()
        zone = tmpl.get("zone")
        if zone and self.selected:
            self._save_undo()
            self.selected.snap_to_zone(zone)
            self._sync_scale_ui()
        self._redraw()

    def _load_ref_image(self, filename: str):
        if not filename:
            self._ref_image_pil = None
            return
        if filename in self._ref_cache:
            self._ref_image_pil = self._ref_cache[filename]
            return
        ref_path = TEMPLATES_DIR / filename
        if ref_path.exists():
            try:
                img = Image.open(ref_path).convert("RGBA")
                img.thumbnail((CANVAS_SIZE, CANVAS_SIZE), Image.LANCZOS) # type: ignore
                self._ref_cache[filename] = img
                self._ref_image_pil = img
            except Exception:
                self._ref_image_pil = None
        else:
            self._ref_image_pil = None

    # ── Guides + render ───────────────────────────────────────────────────────

    def _draw_guides(self):
        self.canvas.delete("guide")
        for g in GUIDES.values():
            c    = g["color"]
            t, b = g["top"]*S, g["bottom"]*S
            l, r = g["left"]*S, g["right"]*S
            kw   = dict(fill=c, dash=(5, 4), tags="guide")
            self.canvas.create_line(0, t, DISPLAY_SIZE, t, **kw) # type: ignore
            self.canvas.create_line(0, b, DISPLAY_SIZE, b, **kw) # pyright: ignore[reportArgumentType]
            self.canvas.create_line(l, 0, l, DISPLAY_SIZE, **kw) # pyright: ignore[reportArgumentType]
            self.canvas.create_line(r, 0, r, DISPLAY_SIZE, **kw) # type: ignore

        tmpl = TEMPLATES.get(self._active_template.get(), {})
        zone = tmpl.get("zone")
        if zone and zone in GUIDES:
            g    = GUIDES[zone]
            t, b = g["top"]*S, g["bottom"]*S
            l, r = g["left"]*S, g["right"]*S
            col  = g["color"]
            self.canvas.create_rectangle(l, t, r, b, outline=col, width=3, tags="guide")
            self.canvas.create_rectangle(l, t, r, b, fill=col, stipple="gray12",
                                         outline="", tags="guide")

    def _redraw(self):
        self.canvas.delete("item")

        if self._ref_image_pil is not None:
            ref_display = self._ref_image_pil.resize((DISPLAY_SIZE, DISPLAY_SIZE), Image.LANCZOS) # pyright: ignore[reportAttributeAccessIssue]
            r, g, b, a  = ref_display.split()
            a = a.point(lambda p: int(p * 0.30))
            ref_display.putalpha(a)
            bg = Image.new("RGBA", (DISPLAY_SIZE, DISPLAY_SIZE), (255, 255, 255, 255))
            bg.paste(ref_display, mask=ref_display.split()[3])
            self._ref_tk = ImageTk.PhotoImage(bg)
            self.canvas.create_image(0, 0, anchor=tk.NW, image=self._ref_tk, tags="item")

        for item in self.items:
            x, y   = item.top_left_display()
            tk_img = item.rendered_display()
            self.canvas.create_image(x, y, anchor=tk.NW, image=tk_img, tags="item")

        if self.selected:
            x, y = self.selected.top_left_display()
            w, h = self.selected.current_size_canvas()
            self.canvas.create_rectangle(
                x-2, y-2, x+int(w*S)+2, y+int(h*S)+2,
                outline="#ffee00", width=2, dash=(5,3), tags="item")

            # Coordinates overlay — bottom-left of canvas
            lock_ind = " 🔒" if self._scale_locked.get() else ""
            info = (f"x:{self.selected.canvas_x}  "
                    f"y:{self.selected.canvas_y}  "
                    f"scale:{self.selected.scale:.3f}{lock_ind}")
            pad = 6
            self.canvas.create_rectangle(
                pad-2, DISPLAY_SIZE-18, len(info)*6+pad+4, DISPLAY_SIZE-pad,
                fill="#000000", outline="", tags="item")
            self.canvas.create_text(
                pad, DISPLAY_SIZE-12,
                text=info, anchor=tk.W,
                fill="#ffee00", font=("Courier", 8), tags="item")

        self.canvas.tag_raise("guide")

    # ── Events ────────────────────────────────────────────────────────────────

    def _on_click(self, e):
        for item in reversed(self.items):
            if item.hit_test(e.x, e.y):
                self._save_undo()           # save position before drag starts
                self.selected     = item
                self._drag_offset = (e.x - int(item.canvas_x * S),
                                     e.y - int(item.canvas_y * S))
                self._sync_scale_ui()
                self._redraw()
                self._update_layers()
                return
        self.selected = None
        self._redraw()
        self._update_layers()

    def _on_drag(self, e):
        if not self.selected:
            return
        self.selected.canvas_x = int((e.x - self._drag_offset[0]) / S)
        self.selected.canvas_y = int((e.y - self._drag_offset[1]) / S)
        self._redraw()

    def _on_drag_end(self, e):
        pass  # undo state already saved on click — no action needed

    def _on_scroll_win(self, e):
        if not self._scale_locked.get():
            self._save_undo()
            self._resize_selected(1.04 if e.delta > 0 else 0.96)

    def _on_scroll_linux_up(self,   e):
        if not self._scale_locked.get():
            self._save_undo()
            self._resize_selected(1.04)

    def _on_scroll_linux_down(self, e):
        if not self._scale_locked.get():
            self._save_undo()
            self._resize_selected(0.96)

    def _resize_selected(self, factor: float):
        if not self.selected:
            return
        self.selected.scale = max(0.02, min(4.0, self.selected.scale * factor))
        self._sync_scale_ui()
        self._redraw()

    def _on_scale_drag(self, val):
        if self.selected and not self._scale_locked.get():
            self.selected.scale = float(val)
            self._redraw()

    def _nudge_scale(self, delta: float):
        if not self.selected or self._scale_locked.get():
            return
        self._save_undo()
        self.selected.scale = max(0.02, min(4.0, self.selected.scale + delta))
        self._sync_scale_ui()
        self._redraw()

    def _nudge_pos(self, dx: int, dy: int):
        """Arrow key nudge — 1px or 10px (Shift) in canvas space."""
        if not self.selected:
            return
        self.selected.canvas_x += dx
        self.selected.canvas_y += dy
        self._redraw()

    # ── Canvas actions ────────────────────────────────────────────────────────

    def _remove_selected(self):
        if not self.selected:
            return
        self.items.remove(self.selected)
        self.selected = None
        self._redraw()
        self._update_layers()

    def _snap(self, zone: str):
        if not self.selected:
            self._status.config(text="Select an item first.")
            return
        self._save_undo()
        self.selected.snap_to_zone(zone)
        self._sync_scale_ui()
        self._redraw()

    def _align(self, axis: str):
        if not self.selected:
            return
        self._save_undo()
        if axis == "h": self.selected.center_h()
        else:           self.selected.center_v()
        self._redraw()

    # ── Source folder ─────────────────────────────────────────────────────────

    def _change_source_folder(self):
        folder = filedialog.askdirectory(title="Select source folder",
                                         initialdir=str(OUTPUT_ROOT))
        if not folder:
            return
        self._src_root = Path(folder)
        try:
            label = str(self._src_root.relative_to(BASE_DIR))
        except ValueError:
            label = str(self._src_root)
        self._src_label_var.set(f"  {label}")
        self._reload_queue()

    # ── Compose + write ───────────────────────────────────────────────────────

    def _compose(self) -> Image.Image:
        output = Image.new("RGBA", (CANVAS_SIZE, CANVAS_SIZE), (0, 0, 0, 0))
        for item in self.items:
            w, h = item.current_size_canvas()
            if w < 1 or h < 1:
                continue
            resized = item.original.resize((w, h), Image.LANCZOS) # type: ignore
            x = item.canvas_x - w // 2
            y = item.canvas_y - h // 2
            output.paste(resized, (x, y), resized)
        return output

    def _write(self, path: Path):
        composed = self._compose()
        png_path = path.with_suffix(".png")
        composed.save(png_path)

        thumb_dir = path.parent / "400"
        thumb_dir.mkdir(parents=True, exist_ok=True)
        white = Image.new("RGBA", (CANVAS_SIZE, CANVAS_SIZE), (255, 255, 255, 255))
        white.paste(composed, mask=composed.split()[3])
        white.convert("RGB").resize((400, 400), Image.LANCZOS).save( # type: ignore
            thumb_dir / png_path.name, quality=95)

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _sync_scale_ui(self):
        if self.selected:
            self._scale_var.set(round(self.selected.scale, 4))

    def _update_layers(self):
        for w in self._layer_frame.winfo_children():
            w.destroy()
        for item in self.items:
            is_sel = item is self.selected
            tk.Button(self._layer_frame,
                      text=f"{'▶ ' if is_sel else '   '}{item.label[:24]}",
                      command=lambda it=item: self._select_layer(it),
                      bg="#333" if is_sel else "#2a2a2a",
                      fg="#ffee00" if is_sel else "#cccccc",
                      activebackground="#444", relief=tk.FLAT,
                      font=("Arial", 8), anchor=tk.W, width=26
                      ).pack(fill=tk.X, pady=1)

    def _select_layer(self, item: ProductItem):
        self.selected = item
        self._sync_scale_ui()
        self._redraw()
        self._update_layers()

    def _section(self, parent, text: str):
        tk.Label(parent, text=text, bg="#252525", fg="#999999",
                 font=("Arial", 7, "bold")).pack(anchor=tk.W, padx=8, pady=(6, 2))

    def _btn(self) -> dict:
        return dict(bg="#2a2a2a", fg="white", activebackground="#3a3a3a",
                    activeforeground="white", relief=tk.FLAT,
                    font=("Arial", 9), width=22)

    def _btn_small(self) -> dict:
        return dict(bg="#2a2a2a", fg="white", activebackground="#3a3a3a",
                    activeforeground="white", relief=tk.FLAT, font=("Arial", 8))


# ── Entry point ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    root = tk.Tk()
    PlacementEditor(root)
    root.mainloop()
