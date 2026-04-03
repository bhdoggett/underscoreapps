import React, {
  useReducer,
  useRef,
  useEffect,
  useCallback,
  useState,
} from "react";
import AppHeader from "../../components/AppHeader";
import DragNumber from "../../components/DragNumber";
import RangeSlider from "../../components/RangeSlider";
import { hexToRgb, rgbToHsl, rgbToCmyk, hslToRgb } from "./colorUtils";
import { downloadCanvas } from "../../utils/downloadCanvas";
import CssColorPicker from "./CssColorPicker";
import styles from "./ColorApp.module.css";

const eyeDropperSupported = "EyeDropper" in window;

function makePickedColor(hex: string) {
  const { r, g, b } = hexToRgb(hex);
  return { hex, r, g, b };
}
const ORBIT_PX = 110;
const ORBIT_PCT = (ORBIT_PX / 260) * 100; // ~42.3% — scales with bar size

type PickedColor = { hex: string; r: number; g: number; b: number };
type GradientStop = { id: number; color: string; position: number };

let _nextStopId = 0;
const newStopId = () => ++_nextStopId;

type GradientGroup = {
  stops: GradientStop[];
  angle: number;
  conicAngle: number;
  gradientMode: "linear" | "conic" | "radial" | "solid";
  radialShape: "circle" | "ellipse";
  radialCenterX: number;
  radialCenterY: number;
  radialSizeX: number;
  radialSizeY: number;
  selectedStop: number | null;
  opacity: number;
};

type State = {
  pickedColor: PickedColor | null;
  uploadedImg: HTMLImageElement | null;
  showCanvas: boolean;
  error: string;
  copying: string | null;
  groups: GradientGroup[];
  activeGroup: number;
  soloGroup: number | null;
  gradientCopied: boolean;
  alpha: number;
};

type Action =
  | { type: "PICK_COLOR"; hex: string }
  | { type: "SET_ERROR"; msg: string }
  | { type: "LOAD_IMAGE"; img: HTMLImageElement }
  | { type: "CLEAR_IMAGE" }
  | { type: "SET_COPYING"; key: string | null }
  | { type: "ADD_STOP"; color: string; position: number }
  | { type: "SELECT_STOP"; index: number | null }
  | { type: "UPDATE_STOP_COLOR"; index: number; color: string }
  | { type: "UPDATE_STOP_POSITION"; index: number; position: number }
  | { type: "REMOVE_STOP"; index: number }
  | { type: "SET_ANGLE"; angle: number }
  | { type: "SET_CONIC_ANGLE"; angle: number }
  | { type: "SET_GRADIENT_MODE"; mode: "linear" | "conic" | "radial" | "solid" }
  | { type: "SET_RADIAL_SHAPE"; shape: "circle" | "ellipse" }
  | { type: "SET_RADIAL_CENTER_X"; value: number }
  | { type: "SET_RADIAL_CENTER_Y"; value: number }
  | { type: "SET_RADIAL_SIZE_X"; value: number }
  | { type: "SET_RADIAL_SIZE_Y"; value: number }
  | { type: "SET_GRADIENT_COPIED"; value: boolean }
  | { type: "SET_ALPHA"; value: number }
  | { type: "REORDER_STOPS"; from: number; to: number; insertBefore: boolean }
  | { type: "ADD_GROUP" }
  | { type: "ADD_GROUP_WITH_COLOR"; hex: string; alpha: number }
  | { type: "REMOVE_GROUP"; index: number }
  | { type: "SET_ACTIVE_GROUP"; index: number }
  | { type: "SET_SOLO_GROUP"; index: number | null }
  | { type: "SET_GROUP_OPACITY"; index: number; value: number }
  | { type: "LOAD_GROUPS"; groups: GradientGroup[] }
  | { type: "REORDER_GROUPS"; from: number; to: number };

// ── URL sharing ──────────────────────────────────────────────────────────────

type SerializedStop = { c: string; p: number };
type SerializedGroup = {
  s: SerializedStop[];
  a: number;
  ca: number;
  m: string;
  rs: string;
  cx: number;
  cy: number;
  sx: number;
  sy: number;
  o: number;
};

function serializeGroups(groups: GradientGroup[]): string {
  const data: SerializedGroup[] = groups.map((g) => ({
    s: g.stops.map((st) => ({ c: st.color, p: st.position })),
    a: g.angle,
    ca: g.conicAngle,
    m: g.gradientMode,
    rs: g.radialShape,
    cx: g.radialCenterX,
    cy: g.radialCenterY,
    sx: g.radialSizeX,
    sy: g.radialSizeY,
    o: g.opacity,
  }));
  // Use URL-safe base64 (no +, /, or = that can get mangled in URLs)
  return btoa(JSON.stringify(data))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function deserializeGroups(encoded: string): GradientGroup[] | null {
  try {
    // Restore URL-safe base64 to standard base64
    const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const data: SerializedGroup[] = JSON.parse(atob(padded));
    if (!Array.isArray(data) || data.length === 0) return null;
    return data.map((g) => ({
      stops: g.s.map((st) => ({
        id: newStopId(),
        color: st.c,
        position: st.p,
      })),
      angle: g.a ?? 90,
      conicAngle: g.ca ?? 0,
      gradientMode: (g.m ?? "linear") as GradientGroup["gradientMode"],
      radialShape: (g.rs ?? "circle") as GradientGroup["radialShape"],
      radialCenterX: g.cx ?? 50,
      radialCenterY: g.cy ?? 50,
      radialSizeX: g.sx ?? 50,
      radialSizeY: g.sy ?? 50,
      selectedStop: null,
      opacity: g.o ?? 100,
    }));
  } catch {
    return null;
  }
}

const defaultGroup: GradientGroup = {
  stops: [
    { id: newStopId(), color: "#ff0000", position: 0 },
    { id: newStopId(), color: "#0000ff", position: 100 },
  ],
  angle: 90,
  conicAngle: 0,
  gradientMode: "linear",
  radialShape: "circle",
  radialCenterX: 50,
  radialCenterY: 50,
  radialSizeX: 50,
  radialSizeY: 50,
  selectedStop: null,
  opacity: 100,
};

function randomVividHex(): string {
  const [r, g, b] = hslToRgb(Math.random() * 360, 100, 50);
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
}

const initial: State = {
  pickedColor: makePickedColor(randomVividHex()),
  uploadedImg: null,
  showCanvas: false,
  error: "",
  copying: null,
  groups: [{ ...defaultGroup }],
  activeGroup: 0,
  soloGroup: null,
  gradientCopied: false,
  alpha: 100,
};

function updateActiveGroup(
  state: State,
  updates: Partial<GradientGroup>,
): State {
  const groups = state.groups.map((g, i) =>
    i === state.activeGroup ? { ...g, ...updates } : g,
  );
  return { ...state, groups };
}

function reducer(state: State, action: Action): State {
  const ag = state.groups[state.activeGroup];
  switch (action.type) {
    case "PICK_COLOR": {
      const { r, g, b } = hexToRgb(action.hex);
      return {
        ...state,
        pickedColor: { hex: action.hex, r, g, b },
        error: "",
        alpha: 100,
      };
    }
    case "SET_ERROR":
      return { ...state, error: action.msg };
    case "LOAD_IMAGE":
      return { ...state, uploadedImg: action.img, showCanvas: true, error: "" };
    case "CLEAR_IMAGE":
      return { ...state, uploadedImg: null, showCanvas: false };
    case "SET_COPYING":
      return { ...state, copying: action.key };
    case "ADD_STOP": {
      const newStop = {
        id: newStopId(),
        color: action.color,
        position: action.position,
      };
      const stops = [...ag.stops, newStop].sort(
        (a, b) => a.position - b.position,
      );
      return updateActiveGroup(state, {
        stops,
        selectedStop: stops.findIndex((s) => s.id === newStop.id),
      });
    }
    case "SELECT_STOP":
      return updateActiveGroup(state, { selectedStop: action.index });
    case "UPDATE_STOP_COLOR": {
      const stops = ag.stops.map((s, i) =>
        i === action.index ? { ...s, color: action.color } : s,
      );
      return updateActiveGroup(state, { stops });
    }
    case "UPDATE_STOP_POSITION": {
      const stops = ag.stops.map((s, i) =>
        i === action.index
          ? { ...s, position: Math.max(0, Math.min(100, action.position)) }
          : s,
      );
      return updateActiveGroup(state, { stops });
    }
    case "REMOVE_STOP": {
      if (ag.stops.length <= 2) return state;
      const stops = ag.stops.filter((_, i) => i !== action.index);
      return updateActiveGroup(state, {
        stops,
        selectedStop: ag.selectedStop === action.index ? null : ag.selectedStop,
      });
    }
    case "SET_ANGLE":
      return updateActiveGroup(state, {
        angle: Math.max(0, Math.min(360, action.angle)),
      });
    case "SET_CONIC_ANGLE":
      return updateActiveGroup(state, {
        conicAngle: Math.max(0, Math.min(360, action.angle)),
      });
    case "SET_GRADIENT_MODE":
      return updateActiveGroup(state, { gradientMode: action.mode });
    case "SET_RADIAL_SHAPE":
      return updateActiveGroup(state, { radialShape: action.shape });
    case "SET_RADIAL_CENTER_X":
      return updateActiveGroup(state, {
        radialCenterX: Math.max(0, Math.min(100, action.value)),
      });
    case "SET_RADIAL_CENTER_Y":
      return updateActiveGroup(state, {
        radialCenterY: Math.max(0, Math.min(100, action.value)),
      });
    case "SET_RADIAL_SIZE_X":
      return updateActiveGroup(state, {
        radialSizeX: Math.max(1, Math.min(200, action.value)),
      });
    case "SET_RADIAL_SIZE_Y":
      return updateActiveGroup(state, {
        radialSizeY: Math.max(1, Math.min(200, action.value)),
      });
    case "SET_GRADIENT_COPIED":
      return { ...state, gradientCopied: action.value };
    case "SET_ALPHA":
      return { ...state, alpha: Math.max(0, Math.min(100, action.value)) };
    case "REORDER_STOPS": {
      // Calculate the final destination index (same logic as before)
      const tempArr = [...ag.stops];
      tempArr.splice(action.from, 1);
      const dstIdx = action.from < action.to ? action.to - 1 : action.to;
      const finalIdx = action.insertBefore ? dstIdx : dstIdx + 1;
      // Rotate only colors — positions stay fixed
      const next = ag.stops.map((s) => ({ ...s }));
      const fromColor = next[action.from].color;
      if (action.from < finalIdx) {
        for (let i = action.from; i < finalIdx; i++)
          next[i].color = next[i + 1].color;
      } else {
        for (let i = action.from; i > finalIdx; i--)
          next[i].color = next[i - 1].color;
      }
      next[finalIdx].color = fromColor;
      return updateActiveGroup(state, { stops: next });
    }
    case "ADD_GROUP": {
      const newGroup: GradientGroup = {
        ...defaultGroup,
        gradientMode: "solid",
        stops: [
          { id: newStopId(), color: randomHex(), position: 0 },
          { id: newStopId(), color: randomHex(), position: 100 },
        ],
        opacity: 100,
      };
      const groups = [...state.groups, newGroup];
      return { ...state, groups, activeGroup: groups.length - 1 };
    }
    case "ADD_GROUP_WITH_COLOR": {
      const newGroup: GradientGroup = {
        ...defaultGroup,
        gradientMode: "solid",
        stops: [
          { id: newStopId(), color: action.hex, position: 0 },
          { id: newStopId(), color: action.hex, position: 100 },
        ],
        opacity: action.alpha,
      };
      const groups = [...state.groups, newGroup];
      return { ...state, groups, activeGroup: groups.length - 1 };
    }
    case "REMOVE_GROUP": {
      if (state.groups.length <= 1) return state;
      const groups = state.groups.filter((_, i) => i !== action.index);
      const activeGroup = Math.min(state.activeGroup, groups.length - 1);
      const soloGroup =
        state.soloGroup === action.index
          ? null
          : state.soloGroup !== null && state.soloGroup > action.index
            ? state.soloGroup - 1
            : state.soloGroup;
      return { ...state, groups, activeGroup, soloGroup };
    }
    case "SET_ACTIVE_GROUP":
      return { ...state, activeGroup: action.index };
    case "SET_SOLO_GROUP":
      return { ...state, soloGroup: action.index };
    case "SET_GROUP_OPACITY": {
      const groups = state.groups.map((g, i) =>
        i === action.index
          ? { ...g, opacity: Math.max(0, Math.min(100, action.value)) }
          : g,
      );
      return { ...state, groups };
    }
    case "LOAD_GROUPS":
      return {
        ...state,
        groups: action.groups,
        activeGroup: 0,
        soloGroup: null,
      };
    case "REORDER_GROUPS": {
      const groups = [...state.groups];
      const [moved] = groups.splice(action.from, 1);
      groups.splice(action.to, 0, moved);
      let activeGroup = state.activeGroup;
      if (state.activeGroup === action.from) {
        activeGroup = action.to;
      } else if (action.from < action.to) {
        if (state.activeGroup > action.from && state.activeGroup <= action.to)
          activeGroup--;
      } else {
        if (state.activeGroup >= action.to && state.activeGroup < action.from)
          activeGroup++;
      }
      return { ...state, groups, activeGroup };
    }
    default:
      return state;
  }
}

function randomHex(): string {
  return (
    "#" +
    Math.floor(Math.random() * 0xffffff)
      .toString(16)
      .padStart(6, "0")
  );
}

function groupGradientCss(group: GradientGroup): string {
  if (group.gradientMode === "solid") {
    return group.stops[0]?.color ?? "#000000";
  }
  const stopsStr = [...group.stops]
    .sort((a, b) => a.position - b.position)
    .map((s) => `${s.color} ${s.position}%`)
    .join(", ");
  if (group.gradientMode === "linear") {
    return `linear-gradient(${group.angle}deg, ${stopsStr})`;
  }
  if (group.gradientMode === "radial") {
    const {
      radialShape,
      radialCenterX,
      radialCenterY,
      radialSizeX,
      radialSizeY,
    } = group;
    const at = `at ${radialCenterX}% ${radialCenterY}%`;
    if (radialShape === "ellipse") {
      return `radial-gradient(ellipse ${radialSizeX}% ${radialSizeY}% ${at}, ${stopsStr})`;
    }
    return `radial-gradient(circle ${at}, ${stopsStr})`;
  }
  return `conic-gradient(from ${group.conicAngle}deg, ${stopsStr})`;
}

export function renderGroupsToCanvas(
  groups: GradientGroup[],
  w: number,
  h: number,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext("2d")!

  for (const group of groups) {
    ctx.globalAlpha = group.opacity / 100
    const sortedStops = [...group.stops].sort((a, b) => a.position - b.position)

    if (group.gradientMode === "solid") {
      ctx.fillStyle = sortedStops[0]?.color ?? "#000000"
      ctx.fillRect(0, 0, w, h)
    } else if (group.gradientMode === "linear") {
      const rad = (group.angle * Math.PI) / 180
      const dirX = Math.sin(rad)
      const dirY = -Math.cos(rad)
      const halfLen = 0.5 * (Math.abs(dirX) * w + Math.abs(dirY) * h)
      const cx = w / 2
      const cy = h / 2
      const grad = ctx.createLinearGradient(
        cx - dirX * halfLen, cy - dirY * halfLen,
        cx + dirX * halfLen, cy + dirY * halfLen,
      )
      for (const stop of sortedStops) grad.addColorStop(stop.position / 100, stop.color)
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, w, h)
    } else if (group.gradientMode === "radial") {
      const cx = (group.radialCenterX / 100) * w
      const cy = (group.radialCenterY / 100) * h
      let r: number
      if (group.radialShape === "ellipse") {
        // Canvas has no native ellipse gradient; approximate with average of rx/ry
        r = ((group.radialSizeX / 100) * w + (group.radialSizeY / 100) * h) / 2
      } else {
        // farthest-corner (CSS default for circle)
        r = Math.max(
          Math.hypot(cx, cy),
          Math.hypot(w - cx, cy),
          Math.hypot(cx, h - cy),
          Math.hypot(w - cx, h - cy),
        )
      }
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
      for (const stop of sortedStops) grad.addColorStop(stop.position / 100, stop.color)
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, w, h)
    } else if (group.gradientMode === "conic") {
      // CSS conic starts from 12 o'clock; canvas createConicGradient starts from 3 o'clock
      const startAngle = (group.conicAngle * Math.PI) / 180 - Math.PI / 2
      const grad = ctx.createConicGradient(startAngle, w / 2, h / 2)
      for (const stop of sortedStops) grad.addColorStop(stop.position / 100, stop.color)
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, w, h)
    }
  }

  ctx.globalAlpha = 1
  return canvas
}

function gradientCss(state: State): string {
  if (state.groups.length === 1) {
    const g = state.groups[0];
    const opacity =
      g.opacity < 100 ? `\nopacity: ${(g.opacity / 100).toFixed(2)};` : "";
    return `background: ${groupGradientCss(g)};${opacity}`;
  }
  const cssRules = state.groups
    .map((g, i) => {
      const opacity =
        g.opacity < 100 ? `\n  opacity: ${(g.opacity / 100).toFixed(2)};` : "";
      return `.layer-${i + 1} {\n  background: ${groupGradientCss(g)};${opacity}\n}`;
    })
    .join("\n");
  const divs = state.groups
    .map((_, i) => `  <div class="layer-${i + 1}"></div>`)
    .join("\n");
  return `<style>\n.gradient { position: relative; }\n.gradient > div { position: absolute; inset: 0; }\n${cssRules}\n</style>\n\n<div class="gradient">\n${divs}\n</div>`;
}

const WHEEL_SIZE = 180;

function ColorWheelPicker({
  currentColor,
  onPick,
  leftSlot,
}: {
  currentColor: { r: number; g: number; b: number } | null;
  onPick: (hex: string) => void;
  leftSlot?: React.ReactNode;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [lightness, setLightness] = useState(50);
  const [hue, setHue] = useState(0);
  const [sat, setSat] = useState(100);
  const internalPickRef = useRef(false);
  const R = WHEEL_SIZE / 2;

  // Draw wheel whenever lightness changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const imageData = ctx.createImageData(WHEEL_SIZE, WHEEL_SIZE);
    const data = imageData.data;
    for (let y = 0; y < WHEEL_SIZE; y++) {
      for (let x = 0; x < WHEEL_SIZE; x++) {
        const dx = x - R,
          dy = y - R;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const h = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
        const s = Math.min((dist / R) * 100, 100);
        const [r, g, b] = hslToRgb(h, s, lightness);
        const i = (y * WHEEL_SIZE + x) * 4;
        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
        data[i + 3] = 255;
      }
    }
    ctx.putImageData(imageData, 0, 0);
  }, [lightness, R]);

  // Sync marker + lightness when color is picked externally
  useEffect(() => {
    if (!currentColor || internalPickRef.current) {
      internalPickRef.current = false;
      return;
    }
    const hsl = rgbToHsl(currentColor.r, currentColor.g, currentColor.b);
    setHue(hsl.h);
    setSat(hsl.s);
    setLightness(hsl.l);
  }, [currentColor]);

  // When lightness slider moves, re-emit the current hue/sat with new lightness
  function onLightnessChange(l: number) {
    setLightness(l);
    const [r, g, b] = hslToRgb(hue, sat, l);
    const hex =
      "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
    internalPickRef.current = true;
    onPick(hex);
  }

  function pickFromEvent(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dx = ((e.clientX - rect.left) / rect.width) * WHEEL_SIZE - R;
    const dy = ((e.clientY - rect.top) / rect.height) * WHEEL_SIZE - R;
    const h = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const s = Math.min((dist / R) * 100, 100);
    setHue(h);
    setSat(s);
    const [r, g, b] = hslToRgb(h, s, lightness);
    const hex =
      "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
    internalPickRef.current = true;
    onPick(hex);
  }

  // Marker position
  const markerRad = (hue * Math.PI) / 180;
  const markerDist = (sat / 100) * R;
  const markerX = R + markerDist * Math.cos(markerRad);
  const markerY = R + markerDist * Math.sin(markerRad);

  return (
    <div className={styles.wheelWrap}>
      <div className={styles.wheelSlot}>{leftSlot}</div>
      <div className={styles.wheelCanvasWrap}>
        <canvas
          ref={canvasRef}
          width={WHEEL_SIZE}
          height={WHEEL_SIZE}
          className={styles.wheelCanvas}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            pickFromEvent(e);
          }}
          onPointerMove={(e) => {
            if (e.buttons === 0) return;
            pickFromEvent(e);
          }}
        />
        <div
          className={styles.wheelMarker}
          style={{
            left: `${(markerX / WHEEL_SIZE) * 100}%`,
            top: `${(markerY / WHEEL_SIZE) * 100}%`,
          }}
        />
      </div>
      <div className={styles.sliderWithLabel}>
        <RangeSlider
          vertical
          size={100}
          min={0}
          max={100}
          value={lightness}
          onChange={onLightnessChange}
          className={styles.wheelLightnessSlider}
        />
        <span className={styles.sliderLabel}>lightness</span>
      </div>
    </div>
  );
}

const EXPORT_PRESETS = [
  { label: "desktop 1920×1080", w: 1920, h: 1080 },
  { label: "mobile 1080×1920", w: 1080, h: 1920 },
  { label: "square 1080×1080", w: 1080, h: 1080 },
  { label: "4k 3840×2160", w: 3840, h: 2160 },
]

export default function ColorApp() {
  const [state, dispatch] = useReducer(reducer, undefined, () => {
    const hash = window.location.hash.slice(1);
    if (hash) {
      const groups = deserializeGroups(hash);
      if (groups) return { ...initial, groups };
    }
    return initial;
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{ currentHolderId: number } | null>(null);
  const stopsRef = useRef(state.groups[state.activeGroup].stops);
  const didDragRef = useRef(false);
  const stopsDragSrc = useRef<number | null>(null);
  const groupDragSrc = useRef<number | null>(null);
  const layerTabsRef = useRef<HTMLDivElement>(null);
  const stopsListRef = useRef<HTMLDivElement>(null);
  const gradientModeRef = useRef(state.groups[state.activeGroup].gradientMode);
  const angleRef = useRef(state.groups[state.activeGroup].angle);
  const radialCenterXRef = useRef(
    state.groups[state.activeGroup].radialCenterX,
  );

  const ag = state.groups[state.activeGroup];
  stopsRef.current = ag.stops;

  const [fullscreen, setFullscreen] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [activeExport, setActiveExport] = useState<"code" | "jpg" | "png" | "webp" | null>(null)
  const [customW, setCustomW] = useState(1920)
  const [customH, setCustomH] = useState(1080)

  // Keep URL hash in sync with gradient state (debounced to avoid replaceState rate limit)
  useEffect(() => {
    const id = setTimeout(() => {
      history.replaceState(null, "", "#" + serializeGroups(state.groups));
    }, 300);
    return () => clearTimeout(id);
  }, [state.groups]);

  // Draw uploaded image onto canvas
  useEffect(() => {
    if (!state.uploadedImg || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const img = state.uploadedImg;
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext("2d")!.drawImage(img, 0, 0);
  }, [state.uploadedImg]);

  async function pickColor() {
    try {
      // @ts-expect-error EyeDropper is not in TS lib yet
      const dropper = new EyeDropper();
      const result = await dropper.open();
      dispatch({ type: "PICK_COLOR", hex: result.sRGBHex });
    } catch {
      // user cancelled — do nothing
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      dispatch({ type: "SET_ERROR", msg: "unsupported file type" });
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => dispatch({ type: "LOAD_IMAGE", img });
    img.onerror = () =>
      dispatch({ type: "SET_ERROR", msg: "could not load image" });
    img.src = url;
    e.target.value = "";
  }

  function handleCanvasClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const x = Math.round(
      e.nativeEvent.offsetX * (canvas.width / canvas.offsetWidth),
    );
    const y = Math.round(
      e.nativeEvent.offsetY * (canvas.height / canvas.offsetHeight),
    );
    const [r, g, b] = canvas.getContext("2d")!.getImageData(x, y, 1, 1).data;
    const hex =
      "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
    dispatch({ type: "PICK_COLOR", hex });
  }

  function copyValue(key: string, value: string) {
    navigator.clipboard.writeText(value).then(() => {
      dispatch({ type: "SET_COPYING", key });
      setTimeout(() => dispatch({ type: "SET_COPYING", key: null }), 1200);
    });
  }

  function addToNewLayer() {
    if (!state.pickedColor) return;
    dispatch({ type: "ADD_GROUP_WITH_COLOR", hex: state.pickedColor.hex, alpha: state.alpha });
  }

  function addToGradient() {
    if (!state.pickedColor) return;
    const positions = ag.stops.map((s) => s.position);
    const gaps: { pos: number; size: number }[] = [];
    const sorted = [...positions].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length - 1; i++) {
      gaps.push({
        pos: (sorted[i] + sorted[i + 1]) / 2,
        size: sorted[i + 1] - sorted[i],
      });
    }
    const bestGap = gaps.sort((a, b) => b.size - a.size)[0];
    dispatch({
      type: "ADD_STOP",
      color: state.pickedColor.hex,
      position: bestGap?.pos ?? 50,
    });
  }

  // Gradient handle drag
  const handleDragStart = useCallback((id: number) => {
    dragRef.current = { currentHolderId: id };
  }, []);

  useEffect(() => {
    function posFromPoint(
      clientX: number,
      clientY: number,
      rect: DOMRect,
    ): number {
      if (gradientModeRef.current === "conic") {
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const fromRad = (angleRef.current * Math.PI) / 180;
        let angleRad =
          Math.atan2(clientY - cy, clientX - cx) + Math.PI / 2 - fromRad;
        if (angleRad < 0) angleRad += 2 * Math.PI;
        return Math.round((angleRad / (2 * Math.PI)) * 100);
      } else if (gradientModeRef.current === "radial") {
        const cx_px = (radialCenterXRef.current / 100) * rect.width;
        const orbitPx = rect.width * (ORBIT_PX / 260);
        const dir = radialCenterXRef.current > 50 ? -1 : 1;
        return Math.round(
          Math.max(
            0,
            Math.min(1, (dir * (clientX - rect.left - cx_px)) / orbitPx),
          ) * 100,
        );
      } else {
        const rad = (angleRef.current * Math.PI) / 180;
        const dirX = Math.sin(rad);
        const dirY = -Math.cos(rad);
        const H = 0.5 * (Math.abs(Math.sin(rad)) + Math.abs(Math.cos(rad)));
        const relX = (clientX - rect.left) / rect.width - 0.5;
        const relY = (clientY - rect.top) / rect.height - 0.5;
        const proj = relX * dirX + relY * dirY;
        return Math.round(Math.max(0, Math.min(1, proj / (2 * H) + 0.5)) * 100);
      }
    }

    function onPointerMove(e: PointerEvent) {
      if (!dragRef.current) return;
      didDragRef.current = true;
      const bar = document.getElementById("gradient-bar");
      if (!bar) return;
      const pos = posFromPoint(
        e.clientX,
        e.clientY,
        bar.getBoundingClientRect(),
      );
      const idx = stopsRef.current.findIndex(
        (s) => s.id === dragRef.current!.currentHolderId,
      );
      if (idx === -1) return;
      dispatch({ type: "UPDATE_STOP_POSITION", index: idx, position: pos });
    }
    function onPointerUp() {
      dragRef.current = null;
      setTimeout(() => {
        didDragRef.current = false;
      }, 0);
    }
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, []);

  // Delete selected stop on Backspace/Delete key
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      if (document.activeElement && document.activeElement !== document.body)
        return;
      const ag = state.groups[state.activeGroup];
      if (ag.selectedStop !== null && ag.stops.length > 2) {
        dispatch({ type: "REMOVE_STOP", index: ag.selectedStop });
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [state.groups, state.activeGroup]);

  // Touch drag-to-reorder for stop controls
  useEffect(() => {
    const container = stopsListRef.current;
    if (!container) return;
    const handles = container.querySelectorAll<HTMLElement>(
      `.${styles.stopDragHandle}`,
    );
    const cleanups: (() => void)[] = [];
    handles.forEach((handle) => {
      const el = handle.closest<HTMLElement>("[data-stopindex]")!;
      const onTouchStart = () => {
        stopsDragSrc.current = Number(el.dataset.stopindex);
        el.classList.add(styles.dragging);
      };
      const onTouchMove = (e: TouchEvent) => {
        if (stopsDragSrc.current === null) return;
        e.preventDefault();
        const touch = e.touches[0];
        const target = document
          .elementFromPoint(touch.clientX, touch.clientY)
          ?.closest<HTMLElement>("[data-stopindex]");
        container
          .querySelectorAll("[data-stopindex]")
          .forEach((el) =>
            el.classList.remove(styles.dragAbove, styles.dragBelow),
          );
        if (
          target &&
          Number(target.dataset.stopindex) !== stopsDragSrc.current
        ) {
          const mid =
            target.getBoundingClientRect().top +
            target.getBoundingClientRect().height / 2;
          target.classList.toggle(styles.dragAbove, touch.clientY < mid);
          target.classList.toggle(styles.dragBelow, touch.clientY >= mid);
        }
      };
      const onTouchEnd = (e: TouchEvent) => {
        if (stopsDragSrc.current === null) return;
        const touch = e.changedTouches[0];
        const target = document
          .elementFromPoint(touch.clientX, touch.clientY)
          ?.closest<HTMLElement>("[data-stopindex]");
        container
          .querySelectorAll("[data-stopindex]")
          .forEach((el) =>
            el.classList.remove(
              styles.dragging,
              styles.dragAbove,
              styles.dragBelow,
            ),
          );
        const srcIdx = stopsDragSrc.current;
        if (target && Number(target.dataset.stopindex) !== srcIdx) {
          const rect = target.getBoundingClientRect();
          const insertBefore = touch.clientY < rect.top + rect.height / 2;
          dispatch({
            type: "REORDER_STOPS",
            from: srcIdx,
            to: Number(target.dataset.stopindex),
            insertBefore,
          });
        }
        stopsDragSrc.current = null;
      };
      handle.addEventListener("touchstart", onTouchStart, { passive: true });
      handle.addEventListener("touchmove", onTouchMove, { passive: false });
      handle.addEventListener("touchend", onTouchEnd);
      cleanups.push(() => {
        handle.removeEventListener("touchstart", onTouchStart);
        handle.removeEventListener("touchmove", onTouchMove);
        handle.removeEventListener("touchend", onTouchEnd);
      });
    });
    return () => cleanups.forEach((fn) => fn());
  }, [state.groups[state.activeGroup].stops.length]);

  // Touch drag-to-reorder for layer tabs
  useEffect(() => {
    const container = layerTabsRef.current;
    if (!container) return;
    const handles = container.querySelectorAll<HTMLElement>(
      `.${styles.layerDragHandle}`,
    );
    const cleanups: (() => void)[] = [];
    handles.forEach((handle) => {
      const tab = handle.closest<HTMLElement>("[data-groupindex]")!;
      const onTouchStart = () => {
        groupDragSrc.current = Number(tab.dataset.groupindex);
      };
      const onTouchMove = (e: TouchEvent) => {
        if (groupDragSrc.current === null) return;
        e.preventDefault();
        const touch = e.touches[0];
        container
          .querySelectorAll("[data-groupindex]")
          .forEach((el) =>
            el.classList.remove(styles.dragAbove, styles.dragBelow),
          );
        const target = document
          .elementFromPoint(touch.clientX, touch.clientY)
          ?.closest<HTMLElement>("[data-groupindex]");
        if (
          target &&
          Number(target.dataset.groupindex) !== groupDragSrc.current
        ) {
          const mid =
            target.getBoundingClientRect().left +
            target.getBoundingClientRect().width / 2;
          target.classList.toggle(styles.dragAbove, touch.clientX < mid);
          target.classList.toggle(styles.dragBelow, touch.clientX >= mid);
        }
      };
      const onTouchEnd = (e: TouchEvent) => {
        if (groupDragSrc.current === null) return;
        const touch = e.changedTouches[0];
        container
          .querySelectorAll("[data-groupindex]")
          .forEach((el) =>
            el.classList.remove(styles.dragAbove, styles.dragBelow),
          );
        const target = document
          .elementFromPoint(touch.clientX, touch.clientY)
          ?.closest<HTMLElement>("[data-groupindex]");
        const srcIdx = groupDragSrc.current;
        if (target && Number(target.dataset.groupindex) !== srcIdx) {
          dispatch({
            type: "REORDER_GROUPS",
            from: srcIdx,
            to: Number(target.dataset.groupindex),
          });
        }
        groupDragSrc.current = null;
      };
      handle.addEventListener("touchstart", onTouchStart, { passive: true });
      handle.addEventListener("touchmove", onTouchMove, { passive: false });
      handle.addEventListener("touchend", onTouchEnd);
      cleanups.push(() => {
        handle.removeEventListener("touchstart", onTouchStart);
        handle.removeEventListener("touchmove", onTouchMove);
        handle.removeEventListener("touchend", onTouchEnd);
      });
    });
    return () => cleanups.forEach((fn) => fn());
  }, [state.groups.length]);

  const {
    stops,
    angle,
    conicAngle,
    gradientMode,
    radialShape,
    selectedStop,
    radialCenterX,
    radialCenterY,
    radialSizeX,
    radialSizeY,
  } = ag;
  const { pickedColor, alpha } = state;

  gradientModeRef.current = gradientMode;
  angleRef.current = gradientMode === "conic" ? conicAngle : angle;
  radialCenterXRef.current = radialCenterX;

  let hsl = { h: 0, s: 0, l: 0 };
  let cmyk = { c: 0, m: 0, y: 0, k: 0 };
  if (pickedColor) {
    hsl = rgbToHsl(pickedColor.r, pickedColor.g, pickedColor.b);
    cmyk = rgbToCmyk(pickedColor.r, pickedColor.g, pickedColor.b);
  }

  const alphaHex = Math.round((alpha / 100) * 255)
    .toString(16)
    .padStart(2, "0")
    .toUpperCase();
  const formats: { key: string; label: string; value: string }[] = pickedColor
    ? [
        {
          key: "hex",
          label: "HEX",
          value:
            alpha < 100
              ? `${pickedColor.hex.toUpperCase()}${alphaHex}`
              : pickedColor.hex.toUpperCase(),
        },
        {
          key: "rgb",
          label: "RGB",
          value:
            alpha < 100
              ? `rgba(${pickedColor.r}, ${pickedColor.g}, ${pickedColor.b}, ${(alpha / 100).toFixed(2)})`
              : `rgb(${pickedColor.r}, ${pickedColor.g}, ${pickedColor.b})`,
        },
        {
          key: "hsl",
          label: "HSL",
          value:
            alpha < 100
              ? `hsla(${hsl.h}, ${hsl.s}%, ${hsl.l}%, ${(alpha / 100).toFixed(2)})`
              : `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`,
        },
        {
          key: "cmyk",
          label: "CMYK",
          value: `cmyk(${cmyk.c}%, ${cmyk.m}%, ${cmyk.y}%, ${cmyk.k}%)`,
        },
      ]
    : [];

  const gradCss = gradientCss(state);
  const previewGroups =
    state.soloGroup !== null ? [state.groups[state.soloGroup]] : state.groups;

  function handleExportClick(fmt: "code" | "jpg" | "png" | "webp") {
    setActiveExport(fmt)
    if (fmt === "code") {
      navigator.clipboard.writeText(gradCss).then(() => {
        dispatch({ type: "SET_GRADIENT_COPIED", value: true })
        setTimeout(() => dispatch({ type: "SET_GRADIENT_COPIED", value: false }), 1200)
      })
    }
  }

  function handleDownload(fmt: "jpg" | "png" | "webp", w: number, h: number) {
    const format = fmt === "jpg" ? "jpeg" : fmt
    const canvas = renderGroupsToCanvas(previewGroups, w, h)
    downloadCanvas(canvas, format as "png" | "jpeg" | "webp", "gradient")
  }

  return (
    <div className={styles.app}>
      <AppHeader
        title="color"
        about={<>
          <p>Pick and build colors with a full gradient editor. Share gradients via URL.</p>
          <ul>
            <li>Drag the spot on the color wheel to change hue &amp; saturation; drag the brightness bar to adjust lightness</li>
            <li>Click any color value (hex, rgb, hsl, cmyk) to copy it</li>
            <li>Use the eyedropper to sample from the screen (where supported)</li>
            <li>Drop an image to sample colors directly from it</li>
            <li>In the gradient editor: drag stops to reposition, click + to add a stop, click a stop to select and change its color</li>
            <li>Switch between linear, radial, conic, and solid gradient modes</li>
            <li>Drag the angle control to rotate a linear or conic gradient</li>
            <li>Add layers with the + button; drag layers to reorder them</li>
            <li>Click the eye icon to solo a layer and preview it alone</li>
            <li>Set per-layer opacity with the slider</li>
            <li>Click the CSS output to copy the full gradient value</li>
            <li>The URL encodes all layers — share or bookmark to save your gradient</li>
          </ul>
        </>}
      />

      {/* ── Phase 1: Color Picker ── */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className={styles.hiddenInput}
        onChange={handleFileChange}
      />

      <div className={styles.wheelRow}>
        {!state.showCanvas && (
          <ColorWheelPicker
            currentColor={state.pickedColor}
            onPick={(hex) => dispatch({ type: "PICK_COLOR", hex })}
            leftSlot={
              <div className={styles.wheelBtns}>
                <CssColorPicker
                  onPick={(hex) => dispatch({ type: "PICK_COLOR", hex })}
                />
                <button
                  className={styles.iconBtn}
                  title="Upload image"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <svg
                    viewBox="0 0 16 16"
                    width="16"
                    height="16"
                    fill="currentColor"
                  >
                    <path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z" />
                    <path d="M7.646 1.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1-.708.708L8.5 2.707V11.5a.5.5 0 0 1-1 0V2.707L5.354 4.854a.5.5 0 1 1-.708-.708z" />
                  </svg>
                </button>
                {eyeDropperSupported && (
                  <button
                    className={styles.iconBtn}
                    title="Eyedropper"
                    onClick={pickColor}
                  >
                    <svg
                      viewBox="0 0 16 16"
                      width="16"
                      height="16"
                      fill="currentColor"
                    >
                      <path d="M13.354.646a1.207 1.207 0 0 0-1.708 0L8.5 3.793l-.646-.647a.5.5 0 1 0-.708.708L8.293 5l-7 7V15h3l7-7 1.146 1.146a.5.5 0 0 0 .708-.708L12.5 7.207l3.147-3.146a1.207 1.207 0 0 0 0-1.707z" />
                    </svg>
                  </button>
                )}
              </div>
            }
          />
        )}

        {state.showCanvas && state.uploadedImg && (
          <div className={styles.previewWrap}>
            <div className={styles.canvasWrap}>
              <canvas
                ref={canvasRef}
                className={styles.canvas}
                onClick={handleCanvasClick}
              />
              <button
                className={styles.closeBtn}
                onClick={() => dispatch({ type: "CLEAR_IMAGE" })}
              >
                ×
              </button>
            </div>
          </div>
        )}

        {pickedColor && (
          <div className={styles.swatchGroup}>
            <div className={styles.swatch}>
              <div
                className={styles.swatchColor}
                style={{
                  backgroundColor: `rgba(${pickedColor.r}, ${pickedColor.g}, ${pickedColor.b}, ${alpha / 100})`,
                }}
              />
            </div>
            <div className={styles.sliderWithLabel}>
              <RangeSlider
                vertical
                size={72}
                min={0}
                max={100}
                value={alpha}
                onChange={(v) => dispatch({ type: "SET_ALPHA", value: v })}
                className={styles.swatchOpacitySlider}
              />
              <span className={styles.sliderLabel}>opacity</span>
            </div>
          </div>
        )}
      </div>

      {state.error && <p className={styles.errorMsg}>{state.error}</p>}

      {pickedColor && (
        <>
          <div className={styles.formatsGrid}>
            {formats.map((fmt) => (
              <div
                key={fmt.key}
                className={[
                  styles.colorBlock,
                  state.copying === fmt.key ? styles.copied : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onPointerUp={() => copyValue(fmt.key, fmt.value)}
              >
                <div className={styles.formatLabel}>{fmt.label}</div>
                <div className={styles.formatValue}>
                  {state.copying === fmt.key ? "copied" : fmt.value}
                </div>
              </div>
            ))}
          </div>

          <div className={styles.addToGradientRow}>
            <button className={styles.uploadLink} onClick={addToGradient}>
              + add to current layer
            </button>
            <button className={styles.uploadLink} onClick={addToNewLayer}>
              + add to new layer
            </button>
          </div>
        </>
      )}

      {/* ── Phase 2: Gradient Builder ── */}
      <div className={styles.gradientSection}>
        {/* Layer tabs */}
        <div className={styles.layerTabs} ref={layerTabsRef}>
          {state.groups.map((_, i) => (
            <div
              key={i}
              data-groupindex={i}
              className={[
                styles.layerTab,
                state.activeGroup === i ? styles.layerTabActive : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={() => dispatch({ type: "SET_ACTIVE_GROUP", index: i })}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (groupDragSrc.current === null || groupDragSrc.current === i)
                  return;
                dispatch({
                  type: "REORDER_GROUPS",
                  from: groupDragSrc.current,
                  to: i,
                });
                groupDragSrc.current = null;
              }}
            >
              <button
                className={[
                  styles.layerTabEye,
                  state.soloGroup === i ? styles.layerTabEyeActive : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                title={
                  state.soloGroup === i ? "show all layers" : "focus this layer"
                }
                onClick={(e) => {
                  e.stopPropagation();
                  dispatch({ type: "SET_ACTIVE_GROUP", index: i });
                  dispatch({
                    type: "SET_SOLO_GROUP",
                    index: state.soloGroup === i ? null : i,
                  });
                }}
              >
                {state.soloGroup === i ? (
                  <svg
                    viewBox="0 0 16 16"
                    width="10"
                    height="10"
                    fill="currentColor"
                  >
                    <path d="M8 3C4.5 3 1.5 5.5 0 8c1.5 2.5 4.5 5 8 5s6.5-2.5 8-5c-1.5-2.5-4.5-5-8-5zm0 8a3 3 0 1 1 0-6 3 3 0 0 1 0 6z" />
                  </svg>
                ) : (
                  <svg
                    viewBox="0 0 16 16"
                    width="10"
                    height="10"
                    fill="currentColor"
                    opacity="0.4"
                  >
                    <path d="M8 3C4.5 3 1.5 5.5 0 8c1.5 2.5 4.5 5 8 5s6.5-2.5 8-5c-1.5-2.5-4.5-5-8-5zm0 8a3 3 0 1 1 0-6 3 3 0 0 1 0 6z" />
                  </svg>
                )}
              </button>
              <span
                className={styles.layerDragHandle}
                draggable
                onDragStart={(e) => {
                  e.stopPropagation();
                  groupDragSrc.current = i;
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragEnd={() => {
                  groupDragSrc.current = null;
                }}
              >
                layer {i + 1}
              </span>
              <span
                className={styles.layerOpacityWrap}
                onMouseDown={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                onDragStart={(e) => e.stopPropagation()}
              >
                <DragNumber
                  value={state.groups[i].opacity}
                  min={0}
                  max={100}
                  className={styles.layerOpacityInput}
                  onChange={(v) =>
                    dispatch({ type: "SET_GROUP_OPACITY", index: i, value: v })
                  }
                />
              </span>
              <span className={styles.layerOpacityUnit}>%</span>
              {state.groups.length > 1 && (
                <button
                  className={styles.layerTabRemove}
                  onClick={(e) => {
                    e.stopPropagation();
                    dispatch({ type: "REMOVE_GROUP", index: i });
                  }}
                >
                  ×
                </button>
              )}
            </div>
          ))}
          {state.groups.length < 9 && (
            <button
              className={styles.uploadLink}
              onClick={() => dispatch({ type: "ADD_GROUP" })}
            >
              + layer
            </button>
          )}
        </div>

        <div className={styles.gradientHeader}>
          <span className={styles.sectionLabel}>gradient</span>
          <div className={styles.gradientModeGroup}>
            {(["linear", "conic", "radial"] as const).map((m) => (
              <button
                key={m}
                className={[
                  styles.transformBtn,
                  gradientMode === m ? styles.selected : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() =>
                  dispatch({
                    type: "SET_GRADIENT_MODE",
                    mode: gradientMode === m ? "solid" : m,
                  })
                }
              >
                {m}
              </button>
            ))}
            {gradientMode === "linear" && (
              <label className={styles.angleLabel}>
                <span className={styles.formatLabel}>angle</span>
                <DragNumber
                  value={angle}
                  min={0}
                  max={360}
                  pixelsPerUnit={1}
                  className={styles.angleInput}
                  onChange={(v) => dispatch({ type: "SET_ANGLE", angle: v })}
                />
              </label>
            )}
            {gradientMode === "radial" && (
              <div className={styles.angleLabel}>
                {(["circle", "ellipse"] as const).map((s) => (
                  <button
                    key={s}
                    className={[
                      styles.transformBtn,
                      radialShape === s ? styles.selected : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={() =>
                      dispatch({ type: "SET_RADIAL_SHAPE", shape: s })
                    }
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            {gradientMode === "conic" && (
              <label className={styles.angleLabel}>
                <span className={styles.formatLabel}>from</span>
                <DragNumber
                  value={conicAngle}
                  min={0}
                  max={360}
                  pixelsPerUnit={1}
                  className={styles.angleInput}
                  onChange={(v) =>
                    dispatch({ type: "SET_CONIC_ANGLE", angle: v })
                  }
                />
              </label>
            )}
          </div>
        </div>

        {/* Live gradient bar */}
        <div className={styles.gradientBarRow}>
          <div className={styles.gradientBarWrap}>
            <div
              className={`${styles.sliderWithLabel} ${styles.gradientBarSlider}`}
            >
              <RangeSlider
                vertical
                size={180}
                min={0}
                max={100}
                value={ag.opacity}
                onChange={(v) =>
                  dispatch({
                    type: "SET_GROUP_OPACITY",
                    index: state.activeGroup,
                    value: v,
                  })
                }
                className={styles.gradientOpacitySlider}
              />
              <span className={styles.sliderLabel}>opacity</span>
            </div>
            <div
              id="gradient-bar"
              className={styles.gradientBar}
              style={{}}
              onClick={(e) => {
                if (didDragRef.current || gradientMode === "solid") return;
                const rect = e.currentTarget.getBoundingClientRect();
                let pos: number;
                if (gradientMode === "conic") {
                  const cx = rect.left + rect.width / 2;
                  const cy = rect.top + rect.height / 2;
                  const fromRad = (conicAngle * Math.PI) / 180;
                  let a =
                    Math.atan2(e.clientY - cy, e.clientX - cx) +
                    Math.PI / 2 -
                    fromRad;
                  if (a < 0) a += 2 * Math.PI;
                  pos = Math.round((a / (2 * Math.PI)) * 100);
                } else if (gradientMode === "radial") {
                  const cx_px = (radialCenterX / 100) * rect.width;
                  const orbitPx = rect.width * (ORBIT_PX / 260);
                  const dir = radialCenterX > 50 ? -1 : 1;
                  pos = Math.round(
                    Math.max(
                      0,
                      Math.min(
                        1,
                        (dir * (e.clientX - rect.left - cx_px)) / orbitPx,
                      ),
                    ) * 100,
                  );
                } else {
                  const rad = (angle * Math.PI) / 180;
                  const dirX = Math.sin(rad);
                  const dirY = -Math.cos(rad);
                  const H =
                    0.5 * (Math.abs(Math.sin(rad)) + Math.abs(Math.cos(rad)));
                  const relX = (e.clientX - rect.left) / rect.width - 0.5;
                  const relY = (e.clientY - rect.top) / rect.height - 0.5;
                  const proj = relX * dirX + relY * dirY;
                  pos = Math.round(
                    Math.max(0, Math.min(1, proj / (2 * H) + 0.5)) * 100,
                  );
                }
                const color = randomHex();
                dispatch({ type: "ADD_STOP", color, position: pos });
              }}
            >
              {previewGroups.map((g, li) => (
                <div
                  key={li}
                  style={{
                    position: "absolute",
                    inset: 0,
                    background: groupGradientCss(g),
                    opacity: g.opacity / 100,
                    borderRadius: "inherit",
                    pointerEvents: "none",
                  }}
                />
              ))}
              {gradientMode !== "solid" &&
                stops.map((stop, i) => {
                  let handleStyle: React.CSSProperties;
                  if (gradientMode === "conic") {
                    const fromRad = (conicAngle * Math.PI) / 180 - Math.PI / 2;
                    const a = fromRad + (stop.position / 100) * 2 * Math.PI;
                    const r = 38.46;
                    const cx = 50,
                      cy = 50;
                    handleStyle = {
                      left: `${cx + r * Math.cos(a)}%`,
                      top: `${cy + r * Math.sin(a)}%`,
                    };
                  } else if (gradientMode === "radial") {
                    const dir = radialCenterX > 50 ? -1 : 1;
                    handleStyle = {
                      left: `${radialCenterX + dir * (stop.position / 100) * ORBIT_PCT}%`,
                      top: `${radialCenterY}%`,
                    };
                  } else {
                    const rad = (angle * Math.PI) / 180;
                    const dirX = Math.sin(rad);
                    const dirY = -Math.cos(rad);
                    const H =
                      0.5 * (Math.abs(Math.sin(rad)) + Math.abs(Math.cos(rad)));
                    const p = stop.position / 100;
                    const x = (0.5 - H * dirX + p * 2 * H * dirX) * 100;
                    const y = (0.5 - H * dirY + p * 2 * H * dirY) * 100;
                    handleStyle = { left: `${x}%`, top: `${y}%` };
                  }
                  return (
                    <div
                      key={i}
                      className={[
                        styles.stopHandle,
                        selectedStop === i ? styles.stopSelected : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      style={handleStyle}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        dispatch({ type: "SELECT_STOP", index: i });
                        handleDragStart(stop.id);
                      }}
                      onClick={(e) => e.stopPropagation()}
                    />
                  );
                })}
              <button
                className={styles.fullscreenBtn}
                onClick={(e) => {
                  e.stopPropagation();
                  setFullscreen(true);
                }}
                title="Fullscreen"
              >
                <svg
                  viewBox="0 0 16 16"
                  width="14"
                  height="14"
                  fill="currentColor"
                >
                  <path d="M1 1h5v1H2v4H1V1zm9 0h5v5h-1V2h-4V1zM1 10h1v4h4v1H1v-5zm14 0v5h-5v-1h4v-4h1z" />
                </svg>
              </button>
            </div>
          </div>
          {gradientMode === "radial" && (
            <div className={styles.radialControls}>
              <label className={styles.angleLabel}>
                <span className={styles.formatLabel}>center x</span>
                <DragNumber
                  value={radialCenterX}
                  min={0}
                  max={100}
                  className={styles.angleInput}
                  onChange={(v) =>
                    dispatch({ type: "SET_RADIAL_CENTER_X", value: v })
                  }
                />
                <span className={styles.formatLabel}>%</span>
              </label>
              <label className={styles.angleLabel}>
                <span className={styles.formatLabel}>center y</span>
                <DragNumber
                  value={radialCenterY}
                  min={0}
                  max={100}
                  className={styles.angleInput}
                  onChange={(v) =>
                    dispatch({ type: "SET_RADIAL_CENTER_Y", value: v })
                  }
                />
                <span className={styles.formatLabel}>%</span>
              </label>
              {radialShape === "ellipse" && (
                <>
                  <label className={styles.angleLabel}>
                    <span className={styles.formatLabel}>size x</span>
                    <DragNumber
                      value={radialSizeX}
                      min={1}
                      max={200}
                      pixelsPerUnit={1}
                      className={styles.angleInput}
                      onChange={(v) =>
                        dispatch({ type: "SET_RADIAL_SIZE_X", value: v })
                      }
                    />
                    <span className={styles.formatLabel}>%</span>
                  </label>
                  <label className={styles.angleLabel}>
                    <span className={styles.formatLabel}>size y</span>
                    <DragNumber
                      value={radialSizeY}
                      min={1}
                      max={200}
                      pixelsPerUnit={1}
                      className={styles.angleInput}
                      onChange={(v) =>
                        dispatch({ type: "SET_RADIAL_SIZE_Y", value: v })
                      }
                    />
                    <span className={styles.formatLabel}>%</span>
                  </label>
                </>
              )}
            </div>
          )}
        </div>

        <div className={styles.gradientControls} ref={stopsListRef}>
          {/* Solid color control */}
          {gradientMode === "solid" && (
            <div className={styles.stopControls}>
              <span className={styles.formatLabel}>color</span>
              <input
                type="color"
                value={stops[0].color}
                className={styles.colorInput}
                onChange={(e) =>
                  dispatch({
                    type: "UPDATE_STOP_COLOR",
                    index: 0,
                    color: e.target.value,
                  })
                }
              />
            </div>
          )}
          {/* Stop controls */}
          {gradientMode !== "solid" &&
            stops.map((stop, i) => (
              <div
                key={i}
                className={styles.stopControls}
                data-stopindex={i}
                onDragEnd={() => {
                  stopsDragSrc.current = null;
                  stopsListRef.current
                    ?.querySelectorAll("[data-stopindex]")
                    .forEach((el) =>
                      el.classList.remove(
                        styles.dragging,
                        styles.dragAbove,
                        styles.dragBelow,
                      ),
                    );
                }}
                onDragOver={(e) => {
                  if (
                    stopsDragSrc.current === null ||
                    stopsDragSrc.current === i
                  )
                    return;
                  e.preventDefault();
                  const rect = e.currentTarget.getBoundingClientRect();
                  const mid = rect.top + rect.height / 2;
                  e.currentTarget.classList.toggle(
                    styles.dragAbove,
                    e.clientY < mid,
                  );
                  e.currentTarget.classList.toggle(
                    styles.dragBelow,
                    e.clientY >= mid,
                  );
                }}
                onDragLeave={(e) =>
                  e.currentTarget.classList.remove(
                    styles.dragAbove,
                    styles.dragBelow,
                  )
                }
                onDrop={(e) => {
                  e.preventDefault();
                  if (
                    stopsDragSrc.current === null ||
                    stopsDragSrc.current === i
                  )
                    return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  const insertBefore = e.clientY < rect.top + rect.height / 2;
                  dispatch({
                    type: "REORDER_STOPS",
                    from: stopsDragSrc.current,
                    to: i,
                    insertBefore,
                  });
                  e.currentTarget.classList.remove(
                    styles.dragAbove,
                    styles.dragBelow,
                  );
                }}
              >
                <span
                  className={styles.stopDragHandle}
                  aria-hidden
                  draggable
                  onDragStart={(e) => {
                    e.stopPropagation();
                    stopsDragSrc.current = i;
                    e.dataTransfer.effectAllowed = "move";
                    const row =
                      e.currentTarget.closest<HTMLElement>("[data-stopindex]");
                    if (row)
                      setTimeout(() => row.classList.add(styles.dragging), 0);
                  }}
                >
                  ⠿
                </span>
                <span className={styles.formatLabel}>{i + 1}</span>
                <input
                  type="color"
                  value={stop.color}
                  className={styles.colorInput}
                  onChange={(e) =>
                    dispatch({
                      type: "UPDATE_STOP_COLOR",
                      index: i,
                      color: e.target.value,
                    })
                  }
                />
                <span
                  onDragStart={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <DragNumber
                    value={stop.position}
                    min={0}
                    max={100}
                    className={styles.angleInput}
                    onChange={(v) =>
                      dispatch({
                        type: "UPDATE_STOP_POSITION",
                        index: i,
                        position: v,
                      })
                    }
                  />
                </span>
                <span className={styles.formatLabel}>%</span>
                <button
                  className={styles.transformBtn}
                  onClick={() => dispatch({ type: "REMOVE_STOP", index: i })}
                  disabled={stops.length <= 2}
                >
                  remove
                </button>
              </div>
            ))}

          {gradientMode !== "solid" && (
            <div className={styles.addStopRow}>
              <button
                className={styles.uploadLink}
                onClick={() => {
                  const color = randomHex();
                  const positions = stops
                    .map((s) => s.position)
                    .sort((a, b) => a - b);
                  const gaps: { pos: number; size: number }[] = [];
                  for (let i = 0; i < positions.length - 1; i++) {
                    gaps.push({
                      pos: (positions[i] + positions[i + 1]) / 2,
                      size: positions[i + 1] - positions[i],
                    });
                  }
                  const best = gaps.sort((a, b) => b.size - a.size)[0];
                  dispatch({
                    type: "ADD_STOP",
                    color,
                    position: Math.round(best?.pos ?? 50),
                  });
                }}
              >
                + add stop
              </button>
            </div>
          )}
        </div>

        {/* CSS output */}
        <pre
          className={[
            styles.cssOutput,
            state.gradientCopied ? styles.copied : "",
          ]
            .filter(Boolean)
            .join(" ")}
          onClick={() => {
            navigator.clipboard.writeText(gradCss).then(() => {
              dispatch({ type: "SET_GRADIENT_COPIED", value: true });
              setTimeout(
                () => dispatch({ type: "SET_GRADIENT_COPIED", value: false }),
                1200,
              );
            });
          }}
        >
          {state.gradientCopied ? "copied" : gradCss}
        </pre>
        <div className={styles.shareRow}>
          <button
            className={styles.uploadLink}
            onClick={() => {
              navigator.clipboard.writeText(window.location.href).then(() => {
                setLinkCopied(true);
                setTimeout(() => setLinkCopied(false), 1200);
              });
            }}
          >
            {linkCopied ? "copied" : "copy link"}
          </button>
        </div>
      </div>

      {fullscreen && (
        <div className={styles.fullscreenOverlay}>
          {previewGroups.map((g, li) => (
            <div
              key={li}
              style={{
                position: "absolute",
                inset: 0,
                background: groupGradientCss(g),
                opacity: g.opacity / 100,
              }}
            />
          ))}
          <button
            className={styles.fullscreenClose}
            onClick={() => setFullscreen(false)}
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
