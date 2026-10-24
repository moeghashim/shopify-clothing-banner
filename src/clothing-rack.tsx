"use client";

import { type CSSProperties, type PointerEvent, type ReactNode, useEffect, useRef, useState } from "react";

import "./clothing-rack.css";

const REST_TURN = 64;
const FRONT_SLOT = 0.82;
const LAYOUT_K = 102;
const LAYOUT_C = 19;
const SPIN_K = 62;
const SPIN_C = 7;
const PEND_W = 4.9;
const PEND_Z = 0.26;
const PEND_GAIN = 0.12;
const PEND_LIMIT = 9;
const STEP = 1 / 120;
const ROD_Y = 0.036;
const HOOK_W = 46;
const HOOK_H = 26;
const HOOK_AXIS = HOOK_W / 2;
const HOOK_ROD_Y = 9.8;
const HOOK_ROD_TOP = HOOK_ROD_Y - 5.75;
const HOOK_CURL = 7.5;
const HOOK_RISE = 7;
const CHROME_TUBE =
  "linear-gradient(to bottom, #2a2d31 0%, #6c7178 8%, #f4f6f8 20%, #ffffff 26%, #c4c9cf 36%, #7c828a 46%, #2f3236 54%, #5a5f66 60%, #b9bec5 70%, #eef0f2 80%, #aab0b7 90%, #3b3e43 100%)";
const CHROME_SMEAR =
  "linear-gradient(to right, rgba(255,255,255,0) 0%, rgba(255,255,255,0.28) 6%, rgba(255,255,255,0) 14%, rgba(0,0,0,0) 30%, rgba(0,0,0,0.38) 38%, rgba(0,0,0,0.5) 47%, rgba(0,0,0,0.28) 56%, rgba(0,0,0,0) 64%, rgba(255,255,255,0.22) 82%, rgba(255,255,255,0) 90%, rgba(255,255,255,0.3) 97%, rgba(255,255,255,0) 100%)";

interface Geometry {
  pad: number;
  rack: number;
  slot: number;
  w: number;
}

export interface RackItem {
  /** Stable key for the garment. */
  id: string;
  /** Shown under the rack while the garment is selected, and used as its accessible name. */
  name: string;
  /** Front-facing photo: transparent background, garment on its hanger. */
  image: string;
  /** Optional photo of the same garment turned away from the camera; the front photo is turned edge-on when omitted. */
  sideImage?: string;
  /** Opened when the garment is selected and `onSelect` is not provided. */
  href?: string;
}

export interface RackImageProps {
  src: string;
  /** True for photos visible at first paint. */
  priority: boolean;
}

export interface ClothingRackProps {
  items: RackItem[];
  /** Hangs the first item on the right and mirrors the swing. */
  rtl?: boolean;
  /** Ignores hover and touch while something else (a dialog, for example) is in front. */
  disabled?: boolean;
  /** Called when a garment is clicked or tapped. */
  onSelect?: (index: number, item: RackItem) => void;
  /** Hint shown next to the name on touch devices. */
  tapHint?: string;
  /** Replace the plain `<img>` (for example with `next/image`). */
  renderImage?: (props: RackImageProps) => ReactNode;
  className?: string;
  /** Largest garment width in px on wide containers. */
  maxGarmentWidth?: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const ramp = (v: number, lo: number, hi: number) => {
  const t = clamp((v - lo) / (hi - lo), 0, 1);
  return t * t * (3 - 2 * t);
};
const slotOrder = (ar: boolean, n: number, k: number) => (ar ? n - 1 - k : k);

function hookPaths(openness: number) {
  const curl = HOOK_CURL * Math.sin((clamp(Math.abs(openness), 0, 90) * Math.PI) / 180);
  const x = HOOK_AXIS;
  const top = HOOK_ROD_Y - HOOK_RISE;
  const c = curl.toFixed(2);
  const left = (x - curl).toFixed(2);
  return {
    back: `M${x} ${top} A${c} ${HOOK_RISE} 0 0 0 ${left} ${HOOK_ROD_Y} L${left} ${HOOK_ROD_Y + 3.4}`,
    front: `M${x} ${HOOK_H} L${x} 21 C${x} 17 ${x + curl} 17 ${x + curl} 13 L${x + curl} ${HOOK_ROD_Y} A${c} ${HOOK_RISE} 0 0 0 ${x} ${top}`,
  };
}

export function ClothingRack({
  items,
  rtl = false,
  disabled = false,
  onSelect,
  tapHint = "Tap to view",
  renderImage,
  className,
  maxGarmentWidth = 300,
}: ClothingRackProps) {
  const ar = rtl;
  const locked = disabled;
  const select = (index: number) => {
    const item = items[index];
    if (onSelect) onSelect(index, item);
    else if (item.href) window.location.assign(item.href);
  };
  const n = items.length;
  const initial = Math.floor((n - 1) / 2);
  const [caption, setCaption] = useState<number>(initial);
  const [warm, setWarm] = useState(false);
  const [coarse, setCoarse] = useState(false);
  const touch = useRef({ dragged: false, startX: 0 });
  const rack = useRef<HTMLUListElement>(null);
  const wakeRef = useRef<() => void>(() => {});
  const swings = useRef<(HTMLDivElement | null)[]>([]);
  const sides = useRef<(HTMLSpanElement | null)[]>([]);
  const fronts = useRef<(HTMLSpanElement | null)[]>([]);
  const anchors = useRef<(HTMLLIElement | null)[]>([]);
  const hooks = useRef<(SVGGElement | null)[]>([]);
  const sim = useRef({
    alpha: new Array<number>(n).fill(0),
    alphaV: new Array<number>(n).fill(0),
    centers: [] as number[],
    frame: 0,
    last: 0,
    openness: Array.from({ length: n }, (_, i): number => (i === initial ? 1 : 0)),
    opennessV: new Array<number>(n).fill(0),
    phi: Array.from({ length: n }, (_, i): number => (i === initial ? 0 : REST_TURN)),
    phiV: new Array<number>(n).fill(0),
    pointerT: 0,
    pointerVx: 0,
    pointerX: 0,
    prevDelta: new Array<number>(n).fill(0),
    prevVx: new Array<number>(n).fill(0),
    slots: [] as number[],
    target: initial,
  });
  const dir = ar ? -1 : 1;

  useEffect(() => {
    const s = sim.current;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");

    const measure = (): Geometry => {
      const ul = rack.current;
      const css = ul ? getComputedStyle(ul) : null;
      const read = (name: string, fallback: number) =>
        css ? Number.parseFloat(css.getPropertyValue(name)) || fallback : fallback;
      const slot = read("--slot", 0.4);
      const pad = read("--pad", 0.7);
      const rackFactor = n * slot + (FRONT_SLOT - slot) + pad;
      return { pad, rack: rackFactor, slot, w: ul ? ul.offsetWidth / rackFactor : 300 };
    };
    let cached = measure();
    const width = () => cached;
    const lastHook = new Array<number>(n).fill(Number.NaN);
    const lastZ = new Array<number>(n).fill(Number.NaN);

    const layout = ({ pad, rack: rackFactor, slot: side, w }: Geometry) => {
      const restPad = (FRONT_SLOT - side + pad) / 2;
      const slots = s.openness.map((o) => (side + (FRONT_SLOT - side) * clamp(o, 0, 1.04)) * w);
      let x = (rackFactor * w - slots.reduce((a, b) => a + b, 0)) / 2;
      for (let k = 0; k < n; k++) {
        const i = slotOrder(ar, n, k);
        s.slots[i] = slots[i];
        s.centers[i] = x + slots[i] / 2;
        x += slots[i];
      }
      return (i: number) => s.centers[i] - (restPad + (slotOrder(ar, n, i) + 0.5) * side) * w;
    };

    const step = (h: number, g: Geometry) => {
      const restDelta = layout(g);
      const arm = 0.9 * 1.2 * g.w;
      for (let i = 0; i < n; i++) {
        const open = s.target === i;
        const a = LAYOUT_K * ((open ? 1 : 0) - s.openness[i]) - LAYOUT_C * s.opennessV[i];
        s.opennessV[i] += a * h;
        s.openness[i] += s.opennessV[i] * h;
        const spin = SPIN_K * ((open ? 0 : REST_TURN) - s.phi[i]) - SPIN_C * s.phiV[i];
        s.phiV[i] += spin * h;
        s.phi[i] = clamp(s.phi[i] + s.phiV[i] * h, -34, 86);
      }
      layout(g);
      for (let i = 0; i < n; i++) {
        const delta = restDelta(i);
        const vx = (delta - s.prevDelta[i]) / h;
        const ax = (vx - s.prevVx[i]) / h;
        s.prevDelta[i] = delta;
        s.prevVx[i] = vx;
        const push = -((ax / arm) * 57.3 * PEND_GAIN);
        const pend = push - PEND_W * PEND_W * s.alpha[i] - 2 * PEND_Z * PEND_W * s.alphaV[i];
        s.alphaV[i] += pend * h;
        s.alpha[i] = clamp(s.alpha[i] + s.alphaV[i] * h, -PEND_LIMIT, PEND_LIMIT);
      }
    };

    const render = (g: Geometry) => {
      const delta = layout(g);
      for (let i = 0; i < n; i++) {
        const o = clamp(s.openness[i], 0, 1.04);
        const phi = s.phi[i];
        const turn = Math.abs(phi);
        const anchor = anchors.current[i];
        const swing = swings.current[i];
        const side = sides.current[i];
        const front = fronts.current[i];
        const hook = hooks.current[i];
        if (anchor) {
          const z = Math.round(o * 10);
          if (z !== lastZ[i]) {
            lastZ[i] = z;
            anchor.style.zIndex = String(z);
          }
        }
        if (swing) {
          const lag = clamp(-s.phiV[i] * dir * 0.03, -6, 6);
          swing.style.transform = `translate(${delta(i).toFixed(2)}px, 0) rotate(${s.alpha[i].toFixed(3)}deg) skewX(${lag.toFixed(3)}deg)`;
        }
        if (front) {
          front.style.transform = `perspective(2400px) rotateY(${(dir * phi).toFixed(2)}deg) scale(${(1 + 0.02 * o).toFixed(4)})`;
          if (side) {
            const opacity = 1 - ramp(turn, 0.5 * REST_TURN, 1.05 * REST_TURN);
            front.style.opacity = String(opacity);
            front.style.visibility = opacity < 0.01 ? "hidden" : "visible";
          }
        }
        if (side) {
          const opacity = ramp(turn, 0.05 * REST_TURN, 0.85 * REST_TURN);
          side.style.opacity = String(opacity);
          side.style.visibility = opacity < 0.01 ? "hidden" : "visible";
          side.style.transform = `perspective(2400px) rotateY(${(dir * phi).toFixed(2)}deg)`;
        }
        if (hook && !(Math.abs(phi - lastHook[i]) < 0.3)) {
          lastHook[i] = phi;
          const d = hookPaths(phi);
          for (const path of hook.querySelectorAll("path")) {
            path.setAttribute("d", path.dataset.part === "back" ? d.back : d.front);
          }
        }
      }
    };

    const tick = (now: number) => {
      const g = width();
      const dt = Math.min(1 / 30, (now - s.last) / 1000 || 1 / 60);
      s.last = now;
      if (reduce.matches) {
        for (let i = 0; i < n; i++) {
          const open = s.target === i;
          s.openness[i] = open ? 1 : 0;
          s.phi[i] = open ? 0 : REST_TURN;
          s.opennessV[i] = s.phiV[i] = s.alpha[i] = s.alphaV[i] = 0;
        }
        layout(g);
        render(g);
        s.frame = 0;
        rack.current?.removeAttribute("data-moving");
        return;
      }
      const steps = Math.max(1, Math.ceil(dt / STEP));
      for (let k = 0; k < steps; k++) step(dt / steps, g);
      render(g);
      let moving = false;
      for (let i = 0; i < n; i++) {
        const open = s.target === i;
        if (
          Math.abs((open ? 1 : 0) - s.openness[i]) > 0.001 ||
          Math.abs(s.opennessV[i]) > 0.01 ||
          Math.abs((open ? 0 : REST_TURN) - s.phi[i]) > 0.08 ||
          Math.abs(s.phiV[i]) > 0.4 ||
          Math.abs(s.alpha[i]) > 0.02 ||
          Math.abs(s.alphaV[i]) > 0.1
        )
          moving = true;
      }
      if (moving) s.frame = requestAnimationFrame(tick);
      else {
        s.frame = 0;
        rack.current?.removeAttribute("data-moving");
      }
    };

    const wake = () => {
      if (!s.frame) {
        rack.current?.setAttribute("data-moving", "true");
        s.last = performance.now();
        s.frame = requestAnimationFrame(tick);
      }
    };

    wakeRef.current = wake;
    const onResize = () => {
      cached = measure();
      wake();
    };
    const start = layout(width());
    for (let i = 0; i < n; i++) s.prevDelta[i] = start(i);
    render(width());
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      if (s.frame) cancelAnimationFrame(s.frame);
      s.frame = 0;
    };
  }, [ar, n, dir]);

  const aim = (target: number, push = 0) => {
    const s = sim.current;
    if (s.target === target) return;
    const previous = s.target;
    s.target = target;
    const kick = clamp(push, -45, 45);
    if (target !== null) s.alphaV[target] += kick;
    if (previous !== null) s.alphaV[previous] += kick * 0.6;
    setCaption(target);
    wakeRef.current();
  };

  useEffect(() => {
    const idle = window as Window & {
      cancelIdleCallback?: (handle: number) => void;
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
    };
    if (idle.requestIdleCallback) {
      const handle = idle.requestIdleCallback(() => setWarm(true), { timeout: 2500 });
      return () => idle.cancelIdleCallback?.(handle);
    }
    const handle = window.setTimeout(() => setWarm(true), 1500);
    return () => window.clearTimeout(handle);
  }, []);

  useEffect(() => {
    const query = window.matchMedia("(hover: none)");
    const sync = () => setCoarse(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  const hit = (clientX: number) => {
    const ul = rack.current;
    const s = sim.current;
    if (!ul || s.centers.length === 0) return null;
    const x = clientX - ul.getBoundingClientRect().left;
    for (let i = 0; i < n; i++) {
      if (Math.abs(x - s.centers[i]) <= s.slots[i] / 2) return i;
    }
    return null;
  };

  const move = (e: PointerEvent<HTMLUListElement>) => {
    if (locked) return;
    const s = sim.current;
    if (e.pointerType !== "mouse" && Math.abs(e.clientX - touch.current.startX) > 8) {
      touch.current.dragged = true;
    }
    const now = e.timeStamp;
    const dt = now - s.pointerT;
    if (dt > 0 && dt < 120)
      s.pointerVx = 0.6 * s.pointerVx + 0.4 * ((e.clientX - s.pointerX) / dt) * 1000;
    s.pointerT = now;
    s.pointerX = e.clientX;
    const found = hit(e.clientX);
    if (found !== null) aim(found, s.pointerVx * 0.012);
  };

  const press = (e: PointerEvent<HTMLUListElement>) => {
    touch.current = { dragged: false, startX: e.clientX };
    if (e.pointerType === "mouse" || locked) return;
    setWarm(true);
    const s = sim.current;
    s.pointerT = e.timeStamp;
    s.pointerX = e.clientX;
    s.pointerVx = 0;
    const found = hit(e.clientX);
    if (found !== null) aim(found);
  };

  return (
    <section
      className={className ? `cr-stage ${className}` : "cr-stage"}
      style={{ "--cr-max": `${maxGarmentWidth}px` } as CSSProperties}
    >
      <div className="cr-inner">
      <div
        className="cr-root"
        style={
          {
            "--n": n,
            "--rack": "calc(var(--n) * var(--slot) + 0.82 - var(--slot) + var(--pad))",
            "--rod": "calc(var(--w) * 0.05)",
          } as CSSProperties
        }
      >
        <div
          className="cr-rod"
          style={{ top: `calc(var(--w) * 1.2 * ${ROD_Y} - var(--rod) / 2)` }}
          aria-hidden
        >
          <div
            className="cr-rod-shadow"
            style={{ height: "calc(var(--rod) * 0.8)", top: "calc(var(--rod) * 0.95)" }}
          />
          <div
            className="cr-rod-tube"
            style={{
              backgroundImage: `${CHROME_SMEAR}, ${CHROME_TUBE}`,
              borderRadius: "calc(var(--rod) * 0.08)",
              boxShadow: "0 1px 2px rgba(0,0,0,0.4)",
              height: "var(--rod)",
            }}
          >
            <div
              className="cr-rod-gloss"
              style={{
                backgroundImage:
                  "linear-gradient(to right, transparent, rgba(255,255,255,0.95) 7%, rgba(255,255,255,0.95) 93%, transparent)",
                height: "max(1px, calc(var(--rod) * 0.07))",
                top: "calc(var(--rod) * 0.2)",
              }}
            />
          </div>
          {(["left", "right"] as const).map((side) => (
            <div key={side}>
              <div
                className="cr-abs"
                style={{
                  [side]: "calc(var(--rod) * -1.75)",
                  backgroundImage: "linear-gradient(135deg, #f6f7f9, #c6cace 55%, #9fa4ab)",
                  borderRadius: "calc(var(--rod) * 0.14)",
                  boxShadow: "0 2px 4px rgba(20,24,40,0.35), 0 0 0 1px rgba(110,116,124,0.7) inset",
                  height: "calc(var(--rod) * 3.7)",
                  top: "calc(var(--rod) * -1.35)",
                  width: "calc(var(--rod) * 1.55)",
                }}
              >
                {(["top", "bottom"] as const).map((edge) => (
                  <span
                    key={edge}
                    className="cr-screw"
                    style={{
                      [edge]: "calc(var(--rod) * 0.3)",
                      backgroundImage: "radial-gradient(circle at 35% 30%, #e9ebee, #7d838a)",
                      height: "calc(var(--rod) * 0.34)",
                      width: "calc(var(--rod) * 0.34)",
                    }}
                  />
                ))}
              </div>
              <div
                className="cr-abs"
                style={{
                  [side]: "calc(var(--rod) * -0.3)",
                  backgroundImage: `repeating-linear-gradient(to right, rgba(0,0,0,0.22) 0 1px, transparent 1px calc(var(--rod) * 0.28)), ${CHROME_TUBE}`,
                  borderRadius: "calc(var(--rod) * 0.12)",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.4)",
                  height: "calc(var(--rod) * 1.4)",
                  top: "calc(var(--rod) * -0.2)",
                  width: "calc(var(--rod) * 1.1)",
                }}
              />
            </div>
          ))}
        </div>

        <ul
          ref={rack}
          className="cr-rack"
          style={{
            height: "calc(var(--w) * 1.2)",
            touchAction: "pan-y",
            width: "calc(var(--w) * var(--rack))",
          }}
          onClick={(e) => {
            if (touch.current.dragged) {
              touch.current.dragged = false;
              return;
            }
            const found = hit(e.clientX);
            if (found !== null) select(found);
          }}
          onPointerDown={press}
          onPointerEnter={() => setWarm(true)}
          onPointerLeave={(e) => {
            if (e.pointerType === "mouse") aim(initial);
          }}
          onPointerMove={move}
        >
          {items.map((item, i) => {
            const k = slotOrder(ar, n, i);
            const isDefault = i === initial;
            const sign = k < slotOrder(ar, n, initial) ? -1 : 1;
            const sideNeeded = !isDefault;
            const frontNeeded = isDefault || !item.sideImage;
            const rest = `perspective(2400px) rotateY(${dir * REST_TURN}deg)`;
            const hookD = hookPaths(isDefault ? 0 : REST_TURN);
            const clip = `hook-back-${item.id}`;
            const label = item.name;
            return (
              <li
                key={item.id}
                ref={(el) => {
                  anchors.current[i] = el;
                }}
                className="cr-item"
                style={{
                  left: `calc(var(--w) * ((0.82 - var(--slot) + var(--pad)) / 2 + ${k + 0.5} * var(--slot)))`,
                  zIndex: isDefault ? 10 : 0,
                }}
              >
                <div
                  ref={(el) => {
                    swings.current[i] = el;
                  }}
                  className="cr-swing"
                  style={{
                    transform: isDefault
                      ? undefined
                      : `translate(calc(var(--w) * ${sign * 0.5} * (0.82 - var(--slot))), 0)`,
                    transformOrigin: `50% ${ROD_Y * 100}%`,
                  }}
                >
                  {item.sideImage && (sideNeeded || warm) ? (
                    <span
                      ref={(el) => {
                        sides.current[i] = el;
                      }}
                      className="cr-layer cr-layer-side"
                      style={{
                        opacity: isDefault ? 0 : 1,
                        transform: rest,
                        visibility: isDefault ? "hidden" : "visible",
                      }}
                    >
                      {renderImage ? (
                        renderImage({ priority: false, src: item.sideImage })
                      ) : (
                        <img
                          alt=""
                          className="cr-img"
                          decoding="async"
                          draggable={false}
                          fetchPriority="low"
                          height={960}
                          loading="eager"
                          src={item.sideImage}
                          width={800}
                        />
                      )}
                    </span>
                  ) : null}
                  {frontNeeded || warm ? (
                    <span
                      ref={(el) => {
                        fronts.current[i] = el;
                      }}
                      className="cr-layer"
                      style={{
                        opacity: isDefault || !item.sideImage ? 1 : 0,
                        transform: isDefault
                          ? "perspective(2400px) rotateY(0deg) scale(1.02)"
                          : rest,
                        visibility: isDefault || !item.sideImage ? "visible" : "hidden",
                      }}
                    >
                      {renderImage ? (
                        renderImage({ priority: isDefault, src: item.image })
                      ) : (
                        <img
                          alt=""
                          className="cr-img"
                          decoding="async"
                          draggable={false}
                          fetchPriority={isDefault ? "high" : "low"}
                          height={960}
                          loading="eager"
                          src={item.image}
                          width={800}
                        />
                      )}
                    </span>
                  ) : null}
                  <svg
                    viewBox={`0 0 ${HOOK_W} ${HOOK_H}`}
                    className="cr-hook"
                    style={{ height: "calc(var(--w) * 0.115)", width: "calc(var(--w) * 0.2)" }}
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <defs>
                      <clipPath id={clip}>
                        <rect x="-30" y="-30" width={HOOK_W + 60} height={HOOK_ROD_TOP + 30} />
                      </clipPath>
                    </defs>
                    <g
                      ref={(el) => {
                        hooks.current[i] = el;
                      }}
                    >
                      <g clipPath={`url(#${clip})`}>
                        <path d={hookD.back} data-part="back" stroke="#555b62" strokeWidth="2.1" />
                        <path d={hookD.back} data-part="back" stroke="#eef1f4" strokeWidth="0.8" />
                      </g>
                      <path d={hookD.front} data-part="front" stroke="#555b62" strokeWidth="2.1" />
                      <path d={hookD.front} data-part="front" stroke="#eef1f4" strokeWidth="0.8" />
                    </g>
                    <rect
                      x="20.7"
                      y="22.4"
                      width="4.6"
                      height="3.8"
                      rx="1.1"
                      fill="#b9bec5"
                      stroke="#6c7279"
                      strokeWidth="0.5"
                    />
                  </svg>
                </div>
                <button
                  type="button"
                  onBlur={() => aim(initial)}
                  onClick={(e) => {
                    e.stopPropagation();
                    select(i);
                  }}
                  onFocus={() => aim(i)}
                  tabIndex={locked ? -1 : 0}
                  className="cr-button"
                  style={{ height: "calc(var(--w) * 1.2)" }}
                  aria-label={label}
                />
              </li>
            );
          })}
        </ul>
      </div>
      <p
        className="cr-caption"
        aria-hidden
      >
        {`${items[caption].name}${coarse ? ` · ${tapHint}` : ""}`}
      </p>
      </div>
    </section>
  );
}
