import { useRef, useState } from "react";
import BackLink from "../../components/BackLink";
import AppHeader from "../../components/AppHeader";
import ActionButton from "../../components/ActionButton";
import styles from "./TextApp.module.css";

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

  const words = text.trim() === "" ? 0 : text.trim().split(/\s+/).length;
  const chars = text.length;
  const readAloud = formatTime(words / 130);
  const readSilent = formatTime(words / 238);

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
    editorRef.current?.focus();
  }

  return (
    <div className={styles.app}>
      <BackLink />
      <div className={styles.header}>
        <AppHeader title="text" />
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
          <span className={styles.statValue}>
            {words === 0 ? "—" : readAloud}
          </span>
          <span className={styles.statLabel}>read aloud</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statValue}>
            {words === 0 ? "—" : readSilent}
          </span>
          <span className={styles.statLabel}>reading</span>
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
