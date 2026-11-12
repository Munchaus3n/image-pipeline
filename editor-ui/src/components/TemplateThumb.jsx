import { useEffect, useRef, useState } from "react";
import { templateRefUrl } from "../api.js";

// Reference images are stored as full-size base64 inside the templates file (some are
// several MB). Rows show a small copy made once, only when the row scrolls into view.
const cache = new Map();

async function makeThumb(ref, px) {
  const src = templateRefUrl(ref);
  if (!src) return "";
  try {
    const img = new Image();
    img.decoding = "async";
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error("image failed to load"));
      img.src = src;
    });
    const scale = Math.min(1, px / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    // Downscale off the main thread when the browser can; otherwise draw directly.
    let source = img;
    try {
      source = await createImageBitmap(img, { resizeWidth: w, resizeHeight: h, resizeQuality: "medium" });
    } catch {
      source = img;
    }
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d").drawImage(source, 0, 0, w, h);
    source.close?.();
    return canvas.toDataURL("image/png");
  } catch {
    // Cross-origin images taint the canvas; show the original instead.
    return src;
  }
}

export default function TemplateThumb({ refImage, size = 32 }) {
  const wrapRef = useRef(null);
  const [visible, setVisible] = useState(false);
  const [, setFilled] = useState(0);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: "160px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !refImage || cache.has(refImage)) return undefined;
    let cancelled = false;
    makeThumb(refImage, size * 2).then((url) => {
      cache.set(refImage, url);
      if (!cancelled) setFilled((n) => n + 1);
    });
    return () => { cancelled = true; };
  }, [visible, refImage, size]);

  const url = refImage ? cache.get(refImage) : "";
  return (
    <span ref={wrapRef} className="template-thumb" style={{ width: size, height: size }}>
      {url ? <img src={url} alt="" decoding="async" /> : null}
    </span>
  );
}
