import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAbout } from "../../contexts/AboutContext";
import styles from "./Landing.module.css";

const STORAGE_KEY = "landing_prefix";
const STARRED_KEY = "landing_starred_v1";

const apps = [
  // text & data
  { path: "/list", name: "list" },
  { path: "/count", name: "count" },
  { path: "/text", name: "text" },
  // media
  { path: "/image", name: "image" },
  { path: "/audio", name: "audio" },
  { path: "/color", name: "color" },
  { path: "/draw", name: "draw" },
  // audio & music
  { path: "/decibels", name: "decibels" },
  { path: "/tuner", name: "tuner" },
  { path: "/metronome", name: "metronome" },
  // tools & time
  { path: "/timer", name: "timer" },
  { path: "/location", name: "location" },
  { path: "/dice", name: "dice" },
];

function loadStarred(): string[] {
  try {
    const raw = localStorage.getItem(STARRED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function saveStarred(paths: string[]) {
  localStorage.setItem(STARRED_KEY, JSON.stringify(paths));
}

export default function Landing() {
  const { setContent, setIsOpen } = useAbout();
  const [prefix, setPrefix] = useState(
    () => localStorage.getItem(STORAGE_KEY) ?? "",
  );
  const [starred, setStarred] = useState<string[]>(loadStarred);
  const starredRef = useRef(starred);
  starredRef.current = starred;

  const sizerRef = useRef<HTMLSpanElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Drag state — all in a ref to avoid re-renders during drag
  const dragRef = useRef<{
    srcPath: string;
    startY: number;
    hasMoved: boolean;
    lastOverLi: HTMLLIElement | null;
  } | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;

    root.style.zoom = "";
    body.style.zoom = "";
    root.style.transform = "";
    body.style.transform = "";
    root.style.transformOrigin = "";
    body.style.transformOrigin = "";
  }, []);

  useEffect(() => {
    setContent(
      <>
        <p>
          A library of aesthetically-simple, single-purpose utility apps. Simple
          UI, no accounts, no data collection.
        </p>
        <p>
          Click the _ to make it yours — try "my", "dad's", "the world's
          okayest", "dastardly".
        </p>
        <p>
          Star apps to pin favorites to the top, then drag the handle to reorder
          them.
        </p>
        <p>
          Requests or feedback?{" "}
          <a
            href="https://github.com/bhdoggett/benapps/issues"
            target="_blank"
            rel="noreferrer"
          >
            Open an issue on GitHub.
          </a>
        </p>
      </>,
    );
    return () => {
      setContent(null);
      setIsOpen(false);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    const sizer = sizerRef.current;
    const input = inputRef.current;
    if (!sizer || !input) return;
    const sync = () => { input.style.width = sizer.offsetWidth + 4 + "px"; };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(sizer);
    return () => ro.disconnect();
  }, [prefix]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setPrefix(val);
    localStorage.setItem(STORAGE_KEY, val);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
  }

  function toggleStar(path: string) {
    setStarred(prev => {
      const next = prev.includes(path)
        ? prev.filter(p => p !== path)
        : [...prev, path];
      saveStarred(next);
      return next;
    });
  }

  function clearDragClasses() {
    listRef.current?.querySelectorAll("li[data-path]").forEach(el => {
      el.classList.remove(styles.dragging, styles.insertAbove, styles.insertBelow);
    });
  }

  function getLiForPath(path: string): HTMLLIElement | null {
    return listRef.current?.querySelector<HTMLLIElement>(`li[data-path="${path}"]`) ?? null;
  }

  function handleDragPointerDown(e: React.PointerEvent<HTMLSpanElement>, path: string) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);

    dragRef.current = { srcPath: path, startY: e.clientY, hasMoved: false, lastOverLi: null };

    const srcLi = getLiForPath(path);

    function onMove(ev: PointerEvent) {
      const drag = dragRef.current;
      if (!drag) return;
      if (!drag.hasMoved && Math.abs(ev.clientY - drag.startY) < 3) return;
      drag.hasMoved = true;

      if (srcLi) srcLi.classList.add(styles.dragging);

      // Find which starred li the pointer is over
      const starred = starredRef.current;
      let overLi: HTMLLIElement | null = null;
      let insertAbove = true;

      for (const p of starred) {
        if (p === drag.srcPath) continue;
        const li = getLiForPath(p);
        if (!li) continue;
        const rect = li.getBoundingClientRect();
        if (ev.clientY >= rect.top && ev.clientY < rect.bottom) {
          overLi = li;
          insertAbove = ev.clientY < rect.top + rect.height / 2;
          break;
        }
      }

      if (drag.lastOverLi && drag.lastOverLi !== overLi) {
        drag.lastOverLi.classList.remove(styles.insertAbove, styles.insertBelow);
      }
      if (overLi) {
        overLi.classList.toggle(styles.insertAbove, insertAbove);
        overLi.classList.toggle(styles.insertBelow, !insertAbove);
      }
      drag.lastOverLi = overLi;
    }

    function onUp(ev: PointerEvent) {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);

      const drag = dragRef.current;
      dragRef.current = null;

      clearDragClasses();

      if (!drag?.hasMoved || !drag.lastOverLi) return;

      const overPath = drag.lastOverLi.dataset.path!;
      const overLiEl = drag.lastOverLi;
      const rect = overLiEl.getBoundingClientRect();
      const before = ev.clientY < rect.top + rect.height / 2;

      setStarred(prev => {
        const next = [...prev];
        const srcIdx = next.indexOf(drag.srcPath);
        if (srcIdx === -1) return prev;
        next.splice(srcIdx, 1);
        let dstIdx = next.indexOf(overPath);
        if (dstIdx === -1) return prev;
        if (!before) dstIdx += 1;
        next.splice(dstIdx, 0, drag.srcPath);
        saveStarred(next);
        return next;
      });
    }

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
  }

  const starredApps = starred
    .map(path => apps.find(a => a.path === path))
    .filter((a): a is typeof apps[0] => a !== undefined);
  const unstarredApps = apps.filter(a => !starred.includes(a.path));

  return (
    <div className={styles.body}>
      <div className={styles.inner}>
        <span ref={sizerRef} className={styles.prefixSizer} aria-hidden="true">
          {prefix || "_"}
        </span>
        <h1 className={styles.title}>
          <input
            ref={inputRef}
            className={styles.prefixInput}
            value={prefix}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder="_"
            maxLength={20}
            autoCapitalize="none"
            aria-label="Customize title"
          />
          <span className={styles.appsSpan}>apps</span>
        </h1>
        <ul className={styles.appList} ref={listRef}>
          {starredApps.map((app) => (
            <li key={app.path} data-path={app.path} className={styles.appRow}>
              <span
                className={styles.dragHandle}
                onPointerDown={e => handleDragPointerDown(e, app.path)}
                aria-hidden
              >⠿</span>
              <Link
                className={styles.appLink}
                to={app.path}
                onClick={e => { if (dragRef.current?.hasMoved) e.preventDefault(); }}
              >
                <span className={styles.appName}>{app.name}</span>
                <span className={styles.arrow}>→</span>
              </Link>
              <button
                className={[styles.starBtn, styles.isStarred].join(" ")}
                onClick={() => toggleStar(app.path)}
                aria-label={`Unstar ${app.name}`}
              >★</button>
            </li>
          ))}

          {unstarredApps.map((app) => (
            <li key={app.path} data-path={app.path} className={styles.appRow}>
              <Link className={styles.appLink} to={app.path}>
                <span className={styles.appName}>{app.name}</span>
                <span className={styles.arrow}>→</span>
              </Link>
              <button
                className={styles.starBtn}
                onClick={() => toggleStar(app.path)}
                aria-label={`Star ${app.name}`}
              >☆</button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
