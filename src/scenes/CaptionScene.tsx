import React from "react";
import { AbsoluteFill, Video, useCurrentFrame, interpolate, spring } from "remotion";
import { loadFont } from "@remotion/google-fonts/Montserrat";
import type { z } from "zod";
import type { sceneSchema } from "../MainVideo";

const { fontFamily } = loadFont("normal", { weights: ["900"], subsets: ["latin", "latin-ext"] });

type Scene = z.infer<typeof sceneSchema>;

const EMOTION_COLOR: Record<Scene["emotion"], string> = {
  hook: "#FF3B3B",
  emphasis: "#FFB020",
  punchline: "#FFE600",
  cta: "#22E27A",
};

function normalizeWord(w: string): string {
  return w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function chunkCaption(caption: string, highlightSet: Set<string>): string[] {
  const words = caption.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const out: string[] = [];
  let i = 0;
  while (i < words.length) {
    const w = words[i];
    const nw = normalizeWord(w);
    if (highlightSet.has(nw)) {
      out.push(w);
      i++;
      continue;
    }
    const next = words[i + 1];
    const nextNorm = next ? normalizeWord(next) : "";
    const nextIsHi = next && highlightSet.has(nextNorm);
    if (next && !nextIsHi && w.length + next.length <= 11) {
      out.push(`${w} ${next}`);
      i += 2;
    } else {
      out.push(w);
      i++;
    }
  }
  return out;
}

export const CaptionScene: React.FC<{
  scene: Scene;
  durationInFrames: number;
  fps: number;
}> = ({ scene, durationInFrames, fps }) => {
  const frame = useCurrentFrame();
  const accent = EMOTION_COLOR[scene.emotion] ?? "#FFB020";
  const highlightSet = new Set(scene.highlight_words.map(normalizeWord).filter(Boolean));
  const chunks = chunkCaption(scene.caption, highlightSet);

  // Ken-burns zoom on b-roll
  const zoom = interpolate(frame, [0, durationInFrames], [1.0, 1.12], {
    extrapolateRight: "clamp",
  });

  // Per-chunk timing
  const perChunkFrames = chunks.length
    ? Math.max(Math.round(0.28 * fps), Math.floor(durationInFrames / chunks.length))
    : durationInFrames;

  return (
    <AbsoluteFill>
      {/* B-roll background */}
      <AbsoluteFill style={{ transform: `scale(${zoom})`, overflow: "hidden" }}>
        <Video
          src={scene.video_url}
          muted
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
          // Loop in case b-roll is shorter than scene
          loop
        />
      </AbsoluteFill>
      {/* Subtle dark vignette for caption readability */}
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(to bottom, transparent 40%, rgba(0,0,0,0.55) 100%)",
        }}
      />
      {/* Captions */}
      {chunks.map((chunk, idx) => {
        const start = idx * perChunkFrames;
        const end = Math.min(start + perChunkFrames + 2, durationInFrames);
        if (frame < start || frame >= end) return null;
        return (
          <CaptionChunk
            key={idx}
            chunk={chunk}
            idx={idx}
            startFrame={start}
            accent={accent}
            baseSize={scene.text_size}
            highlightSet={highlightSet}
            fps={fps}
          />
        );
      })}
    </AbsoluteFill>
  );
};

const CaptionChunk: React.FC<{
  chunk: string;
  idx: number;
  startFrame: number;
  accent: string;
  baseSize: number;
  highlightSet: Set<string>;
  fps: number;
}> = ({ chunk, idx, startFrame, accent, baseSize, highlightSet, fps }) => {
  const frame = useCurrentFrame();
  const local = frame - startFrame;

  const wordsInChunk = chunk.split(/\s+/).map(normalizeWord);
  const isHighlighted = wordsInChunk.some((w) => highlightSet.has(w));
  const fill = isHighlighted ? accent : "#FFFFFF";
  const size = isHighlighted ? Math.min(140, baseSize + 28) : baseSize;
  const stroke = isHighlighted ? 8 : 5;
  const shadowBlur = isHighlighted ? 22 : 14;
  const yPct = isHighlighted ? 70 : 72 + (idx % 2 === 0 ? -1 : 1);

  // Entry animation
  const opacity = interpolate(local, [0, 3], [0, 1], { extrapolateRight: "clamp" });

  let transform = "";
  if (isHighlighted) {
    const s = spring({ frame: local, fps, config: { damping: 8, stiffness: 200 } });
    const scale = interpolate(s, [0, 1], [0.2, 1]);
    const shake = Math.sin(local * 0.8) * Math.max(0, 6 - local * 0.5);
    transform = `translate(-50%, -50%) translateX(${shake}px) scale(${scale})`;
  } else {
    const variant = idx % 4;
    if (variant === 0) {
      const s = spring({ frame: local, fps, config: { damping: 14, stiffness: 180 } });
      const y = interpolate(s, [0, 1], [40, 0]);
      transform = `translate(-50%, calc(-50% + ${y}px))`;
    } else if (variant === 1) {
      const s = spring({ frame: local, fps, config: { damping: 12, stiffness: 200 } });
      const scale = interpolate(s, [0, 1], [0.6, 1]);
      transform = `translate(-50%, -50%) scale(${scale})`;
    } else if (variant === 2) {
      const x = interpolate(local, [0, 6], [80, 0], { extrapolateRight: "clamp" });
      transform = `translate(calc(-50% + ${x}px), -50%)`;
    } else {
      const x = interpolate(local, [0, 6], [-80, 0], { extrapolateRight: "clamp" });
      transform = `translate(calc(-50% + ${x}px), -50%)`;
    }
  }

  // Text-stroke fallback via multiple shadows
  const strokeShadow = Array.from({ length: 8 })
    .map((_, k) => {
      const angle = (k / 8) * Math.PI * 2;
      const dx = Math.cos(angle) * stroke;
      const dy = Math.sin(angle) * stroke;
      return `${dx}px ${dy}px 0 #000`;
    })
    .join(", ");

  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        top: `${yPct}%`,
        transform,
        opacity,
        fontFamily,
        fontWeight: 900,
        fontSize: size,
        color: fill,
        letterSpacing: isHighlighted ? "0.02em" : "0em",
        textAlign: "center",
        whiteSpace: "nowrap",
        textShadow: `${strokeShadow}, 0 5px ${shadowBlur}px rgba(0,0,0,0.8)`,
        textTransform: "uppercase",
        lineHeight: 1,
      }}
    >
      {chunk}
      {isHighlighted && (
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "100%",
            transform: "translate(-50%, 8px)",
            width: "70%",
            height: 8,
            background: accent,
            borderRadius: 4,
            boxShadow: `0 0 24px ${accent}`,
          }}
        />
      )}
    </div>
  );
};
