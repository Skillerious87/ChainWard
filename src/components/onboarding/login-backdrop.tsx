"use client";

import { useEffect, useRef } from "react";

/**
 * A slow node-and-link field behind the sign-in card — the "chain" motif in the
 * product name, kept low-contrast so it never competes with the form. Honours
 * reduced-motion (one static frame), pauses on a hidden tab, and is purely
 * decorative.
 */
export function LoginBackdrop() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const accent = readAccent();

    let width = 0;
    let height = 0;
    let dpr = 1;
    let nodes: Node[] = [];
    let frame = 0;
    let pulses: Pulse[] = [];
    let nextPulseAt = 0;
    let running = true;

    function resize(): void {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas!.clientWidth;
      height = canvas!.clientHeight;
      canvas!.width = Math.floor(width * dpr);
      canvas!.height = Math.floor(height * dpr);
      context!.setTransform(dpr, 0, 0, dpr, 0, 0);

      const target = Math.round(Math.min(76, Math.max(26, (width * height) / 26_000)));
      nodes = Array.from({ length: target }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.16,
        vy: (Math.random() - 0.5) * 0.16,
        r: 0.8 + Math.random() * 1.4,
      }));
      pulses = [];
    }

    const LINK_DISTANCE = 168;

    function neighbours(index: number): number[] {
      const from = nodes[index]!;
      const found: Array<{ i: number; d: number }> = [];
      for (let i = 0; i < nodes.length; i += 1) {
        if (i === index) continue;
        const other = nodes[i]!;
        const d = Math.hypot(from.x - other.x, from.y - other.y);
        if (d < LINK_DISTANCE) found.push({ i, d });
      }
      return found.sort((a, b) => a.d - b.d).slice(0, 3).map((n) => n.i);
    }

    function spawnPulse(): void {
      if (nodes.length < 6) return;
      const path = [Math.floor(Math.random() * nodes.length)];
      for (let step = 0; step < 5; step += 1) {
        const options = neighbours(path[path.length - 1]!).filter((i) => !path.includes(i));
        if (options.length === 0) break;
        path.push(options[Math.floor(Math.random() * options.length)]!);
      }
      if (path.length >= 3) pulses.push({ path, segment: 0, t: 0 });
    }

    function drawStatic(): void {
      context!.clearRect(0, 0, width, height);
      for (let i = 0; i < nodes.length; i += 1) {
        const a = nodes[i]!;
        for (const j of neighbours(i)) {
          if (j <= i) continue;
          const b = nodes[j]!;
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          context!.strokeStyle = withAlpha(accent, 0.05 * (1 - d / LINK_DISTANCE));
          context!.lineWidth = 1;
          context!.beginPath();
          context!.moveTo(a.x, a.y);
          context!.lineTo(b.x, b.y);
          context!.stroke();
        }
      }
      for (const node of nodes) {
        context!.fillStyle = withAlpha(accent, 0.28);
        context!.beginPath();
        context!.arc(node.x, node.y, node.r, 0, Math.PI * 2);
        context!.fill();
      }
    }

    function step(now: number): void {
      if (!running) return;
      frame = window.requestAnimationFrame(step);
      context!.clearRect(0, 0, width, height);

      for (const node of nodes) {
        node.x += node.vx;
        node.y += node.vy;
        if (node.x < -20) node.x = width + 20;
        if (node.x > width + 20) node.x = -20;
        if (node.y < -20) node.y = height + 20;
        if (node.y > height + 20) node.y = -20;
      }

      // Links.
      for (let i = 0; i < nodes.length; i += 1) {
        const a = nodes[i]!;
        for (const j of neighbours(i)) {
          if (j <= i) continue;
          const b = nodes[j]!;
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          context!.strokeStyle = withAlpha(accent, 0.06 * (1 - d / LINK_DISTANCE));
          context!.lineWidth = 1;
          context!.beginPath();
          context!.moveTo(a.x, a.y);
          context!.lineTo(b.x, b.y);
          context!.stroke();
        }
      }

      // Pulses travelling along a path of nodes.
      if (now >= nextPulseAt) {
        spawnPulse();
        nextPulseAt = now + 2200 + Math.random() * 2600;
      }
      pulses = pulses.filter((pulse) => {
        const from = nodes[pulse.path[pulse.segment]!];
        const to = nodes[pulse.path[pulse.segment + 1]!];
        if (!from || !to) return false;
        pulse.t += 0.022;
        if (pulse.t >= 1) {
          pulse.t = 0;
          pulse.segment += 1;
          return pulse.segment < pulse.path.length - 1;
        }
        const x = from.x + (to.x - from.x) * pulse.t;
        const y = from.y + (to.y - from.y) * pulse.t;

        context!.strokeStyle = withAlpha(accent, 0.4);
        context!.lineWidth = 1.4;
        context!.beginPath();
        context!.moveTo(from.x, from.y);
        context!.lineTo(x, y);
        context!.stroke();

        const glow = context!.createRadialGradient(x, y, 0, x, y, 16);
        glow.addColorStop(0, withAlpha(accent, 0.55));
        glow.addColorStop(1, withAlpha(accent, 0));
        context!.fillStyle = glow;
        context!.beginPath();
        context!.arc(x, y, 16, 0, Math.PI * 2);
        context!.fill();
        return true;
      });

      // Nodes.
      for (const node of nodes) {
        context!.fillStyle = withAlpha(accent, 0.32);
        context!.beginPath();
        context!.arc(node.x, node.y, node.r, 0, Math.PI * 2);
        context!.fill();
      }
    }

    resize();
    if (reduceMotion) {
      drawStatic();
    } else {
      nextPulseAt = performance.now() + 900;
      frame = window.requestAnimationFrame(step);
    }

    const onResize = () => resize();
    const onVisibility = () => {
      if (document.hidden) {
        running = false;
        window.cancelAnimationFrame(frame);
      } else if (!reduceMotion && !running) {
        running = true;
        nextPulseAt = performance.now() + 600;
        frame = window.requestAnimationFrame(step);
      }
    };
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      running = false;
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <div className="login-backdrop" aria-hidden="true">
      <canvas ref={canvasRef} className="login-backdrop__canvas" />
      <span className="login-backdrop__aurora" />
      <span className="login-backdrop__grid" />
      <span className="login-backdrop__vignette" />
    </div>
  );
}

interface Node { x: number; y: number; vx: number; vy: number; r: number }
interface Pulse { path: number[]; segment: number; t: number }

function readAccent(): [number, number, number] {
  if (typeof window === "undefined") return [145, 230, 83];
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--accent-rgb").trim();
  const parts = raw.split(",").map((value) => Number.parseInt(value.trim(), 10));
  if (parts.length === 3 && parts.every((value) => Number.isFinite(value))) return [parts[0]!, parts[1]!, parts[2]!];
  return [145, 230, 83];
}

function withAlpha([r, g, b]: [number, number, number], alpha: number): string {
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;
}
