export function createOrbitalBackdrop(canvas) {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return { isEnabled: () => false, setEnabled() {}, pulse() {}, setTheme() {} };
  }

  const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  let enabled = !prefersReduced.matches;
  let theme = "dark";
  let rafId = 0;
  let width = 0;
  let height = 0;
  let pulseEnergy = 0;
  let pulseHue = "#38bdf8";

  const nodes = Array.from({ length: 44 }, (_, idx) => ({
    xRatio: ((idx * 37 + 11) % 100) / 100,
    yRatio: ((idx * 61 + 17) % 100) / 100,
    vx: (((idx % 7) - 3) * 0.00022) || 0.00018,
    vy: ((((idx * 3) % 7) - 3) * 0.00019) || -0.00015,
    radius: 1.8 + (idx % 3) * 1.1,
    channel: idx % 3,
  }));

  const comets = Array.from({ length: 5 }, (_, idx) => ({
    angle: (idx * Math.PI * 2) / 5,
    speed: 0.32 + idx * 0.09,
    rxRatio: 0.24 + idx * 0.07,
    ryRatio: 0.14 + idx * 0.05,
    channel: idx % 3,
  }));

  const palette = () =>
    theme === "light"
      ? {
          orbs: [
            "rgba(2, 132, 199, 0.22)",
            "rgba(79, 70, 229, 0.18)",
            "rgba(13, 148, 136, 0.18)",
          ],
          ribbons: [
            "rgba(2, 132, 199, 0.20)",
            "rgba(79, 70, 229, 0.16)",
            "rgba(13, 148, 136, 0.17)",
          ],
          channels: ["#0284c7", "#4f46e5", "#0d9488"],
          line: "rgba(3, 105, 161, 0.18)",
          orbitRing: "rgba(3, 105, 161, 0.12)",
        }
      : {
          orbs: [
            "rgba(56, 189, 248, 0.28)",
            "rgba(99, 102, 241, 0.24)",
            "rgba(20, 184, 166, 0.22)",
          ],
          ribbons: [
            "rgba(56, 189, 248, 0.24)",
            "rgba(99, 102, 241, 0.20)",
            "rgba(20, 184, 166, 0.19)",
          ],
          channels: ["#38bdf8", "#818cf8", "#2dd4bf"],
          line: "rgba(125, 211, 252, 0.20)",
          orbitRing: "rgba(56, 189, 248, 0.14)",
        };

  function drawAuroraOrbs(timeSec, colors) {
    for (let i = 0; i < colors.orbs.length; i += 1) {
      const cx = width * (0.2 + i * 0.3) + Math.sin(timeSec * (0.35 + i * 0.12) + i) * (width * 0.12);
      const cy = height * (0.22 + (i % 2) * 0.45) + Math.cos(timeSec * (0.28 + i * 0.1) - i) * (height * 0.1);
      const r = Math.max(width, height) * (0.28 + pulseEnergy * 0.08);
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      grad.addColorStop(0, colors.orbs[i]);
      grad.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawRibbon(timeSec, index, color) {
    const baseY = height * (0.18 + index * 0.3);
    const amp = (34 + index * 16) * (1 + pulseEnergy * 0.6);
    const freq = 0.0024 + index * 0.0006;
    const speed = timeSec * (0.55 + index * 0.18);

    ctx.beginPath();
    ctx.moveTo(0, baseY);
    for (let x = 0; x <= width; x += 28) {
      const y =
        baseY +
        Math.sin(x * freq + speed) * amp +
        Math.cos(x * freq * 0.55 - speed * 0.75) * (amp * 0.45);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.closePath();

    const grad = ctx.createLinearGradient(0, baseY - amp * 2.2, 0, baseY + amp * 3.4);
    grad.addColorStop(0, "rgba(0, 0, 0, 0)");
    grad.addColorStop(0.45, color);
    grad.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = grad;
    ctx.fill();
  }

  function drawOrbitalComets(timeSec, colors) {
    const cx = width * 0.5;
    const cy = height * 0.46;
    for (const comet of comets) {
      const rx = width * comet.rxRatio;
      const ry = height * comet.ryRatio;

      ctx.strokeStyle = colors.orbitRing;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0.18, 0, Math.PI * 2);
      ctx.stroke();

      const theta = comet.angle + timeSec * comet.speed * (1 + pulseEnergy * 1.4);
      const px = cx + Math.cos(theta) * rx * Math.cos(0.18) - Math.sin(theta) * ry * Math.sin(0.18);
      const py = cy + Math.cos(theta) * rx * Math.sin(0.18) + Math.sin(theta) * ry * Math.cos(0.18);
      const hue = colors.channels[comet.channel];

      const glow = ctx.createRadialGradient(px, py, 0, px, py, 16);
      glow.addColorStop(0, hue);
      glow.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(px, py, 16, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawFrame(timestamp) {
    const t = timestamp * 0.001;
    ctx.clearRect(0, 0, width, height);
    const colors = palette();

    drawAuroraOrbs(t, colors);
    for (let i = 0; i < colors.ribbons.length; i += 1) {
      drawRibbon(t, i, colors.ribbons[i]);
    }
    drawOrbitalComets(t, colors);

    if (pulseEnergy > 0.01) {
      const ringRadius = (1 - pulseEnergy) * Math.max(width, height) * 0.68;
      ctx.save();
      ctx.strokeStyle = pulseHue;
      ctx.globalAlpha = pulseEnergy * 0.48;
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.arc(width * 0.5, height * 0.36, ringRadius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      pulseEnergy *= 0.94;
    } else {
      pulseEnergy = 0;
    }

    const stepFactor = enabled ? 1 + pulseEnergy * 2 : 0;
    for (const node of nodes) {
      node.xRatio = (node.xRatio + node.vx * stepFactor + 1) % 1;
      node.yRatio = (node.yRatio + node.vy * stepFactor + 1) % 1;
    }

    const maxDist = Math.min(190, Math.max(115, width * 0.15));
    ctx.lineWidth = 1;
    for (let i = 0; i < nodes.length; i += 1) {
      const a = nodes[i];
      const ax = a.xRatio * width;
      const ay = a.yRatio * height;

      for (let j = i + 1; j < nodes.length; j += 1) {
        const b = nodes[j];
        const bx = b.xRatio * width;
        const by = b.yRatio * height;
        const dist = Math.hypot(ax - bx, ay - by);
        if (dist < maxDist) {
          ctx.strokeStyle = colors.line;
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(bx, by);
          ctx.stroke();
        }
      }

      ctx.fillStyle = colors.channels[a.channel];
      ctx.beginPath();
      ctx.arc(ax, ay, a.radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawFrame(performance.now());
  };

  function loop(ts) {
    if (!enabled) return;
    drawFrame(ts);
    rafId = window.requestAnimationFrame(loop);
  }

  window.addEventListener("resize", resize);
  resize();
  if (enabled) {
    rafId = window.requestAnimationFrame(loop);
  }

  return {
    isEnabled: () => enabled,
    setEnabled(next) {
      enabled = Boolean(next);
      window.cancelAnimationFrame(rafId);
      if (enabled) {
        rafId = window.requestAnimationFrame(loop);
      } else {
        drawFrame(performance.now());
      }
    },
    setTheme(nextTheme) {
      theme = nextTheme === "light" ? "light" : "dark";
      if (!enabled) drawFrame(performance.now());
    },
    pulse(role = "coo") {
      pulseEnergy = 1;
      pulseHue =
        role === "implementer"
          ? "#818cf8"
          : role === "researcher"
            ? "#2dd4bf"
            : "#38bdf8";
      if (!enabled) drawFrame(performance.now());
    },
  };
}
