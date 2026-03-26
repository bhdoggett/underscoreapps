import { useEffect, useRef, useState } from "react";
import AppHeader from "../../components/AppHeader";
import ActionButton from "../../components/ActionButton";
import styles from "./TextApp.module.css";

const STORAGE_KEY = "benapps.text.v1";

function formatTime(minutes: number): string {
  const totalSeconds = Math.round(minutes * 60);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

export default function TextApp() {
  const [text, setText] = useState("");
  const [status, setStatus] = useState("");
  const editorRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { v: 1; text: string };
      if (!parsed || parsed.v !== 1) return;
      if (typeof parsed.text !== "string") return;
      setText(parsed.text);
    } catch {
      // ignore invalid persisted state
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (!text) {
        window.localStorage.removeItem(STORAGE_KEY);
        return;
      }
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, text }));
    } catch {
      // ignore storage failures (private mode, quota, etc)
    }
  }, [text]);

  const wordList = text.trim() === "" ? [] : text.trim().split(/\s+/);
  const words = wordList.length;
  const chars = text.length;
  const readAloud = formatTime(words / 130);
  const sentences = words === 0 ? 0 : (text.match(/[^.!?]*[.!?]+/g) ?? [text]).length;
  // Split on em-dash/en-dash before finding longest word
  const tokens = wordList.flatMap(w => w.split(/[\u2014\u2013\-\/|]/));
  const uniqueWords = words === 0 ? 0 : new Set(wordList.map(w => w.toLowerCase().replace(/[^a-z']/g, ""))).size;
  const longestWord = words === 0 ? "—" : tokens.reduce((a, b) => b.length > a.length ? b : a);
  const avgWordLen = words === 0 ? "—" : (wordList.reduce((sum, w) => sum + w.length, 0) / words).toFixed(1);

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    e.preventDefault();
    const plain = e.clipboardData.getData("text/plain");
    const el = editorRef.current!;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const next = text.slice(0, start) + plain + text.slice(end);
    setText(next);
    requestAnimationFrame(() => {
      el.selectionStart = el.selectionEnd = start + plain.length;
    });
  }

  async function handleCopy() {
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setStatus("copied — formatting stripped");
    setTimeout(() => setStatus(""), 2000);
  }

  function handleClear() {
    setText("");
    setStatus("");
    if (typeof window !== "undefined") {
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        // ignore
      }
    }
    editorRef.current?.focus();
  }

  return (
    <div className={styles.app}>
      <div className={styles.header}>
        <AppHeader
          title="text"
          about={<>
            <p>Live word, character, sentence, and read-time stats for any block of text.</p>
            <ul>
              <li>Paste any text into the editor to see stats update in real time</li>
              <li>Click any stat value to copy it to the clipboard</li>
            </ul>
          </>}
        />
      </div>
      <div className={styles.stats}>
        <div className={styles.stat}>
          <span className={styles.statValue}>{words}</span>
          <span className={styles.statLabel}>words</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statValue}>{chars}</span>
          <span className={styles.statLabel}>chars</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statValue}>{words === 0 ? "—" : sentences}</span>
          <span className={styles.statLabel}>sentences</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statValue}>
            {words === 0 ? "—" : readAloud}
          </span>
          <span className={styles.statLabel}>read aloud</span>
        </div>
      </div>
      <div className={styles.editorWrap}>
        <textarea
          ref={editorRef}
          className={styles.editor}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={handlePaste}
          placeholder="paste or type text here…"
        />
      </div>
      <div className={styles.statsSecondary}>
        <div className={styles.stat}>
          <span className={styles.statValue}>{words === 0 ? "—" : uniqueWords}</span>
          <span className={styles.statLabel}>unique words</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statValue}>{longestWord}</span>
          <span className={styles.statLabel}>longest word</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statValue}>{avgWordLen}</span>
          <span className={styles.statLabel}>avg word len</span>
        </div>
      </div>
      <div className={styles.actions}>
        <ActionButton onClick={handleCopy}>copy</ActionButton>
        <ActionButton onClick={handleClear} muted>
          clear
        </ActionButton>
        {status && <span className={styles.copyStatus}>{status}</span>}
      </div>
    </div>
  );
}
