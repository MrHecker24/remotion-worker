import React from "react";
import { AbsoluteFill, Img, useCurrentFrame, interpolate, spring } from "remotion";

export const OutroScene: React.FC<{ imageUrl: string; fps: number }> = ({
  imageUrl,
  fps,
}) => {
  const frame = useCurrentFrame();
  const s = spring({ frame, fps, config: { damping: 14, stiffness: 120 } });
  const scale = interpolate(s, [0, 1], [0.85, 1]);
  const opacity = interpolate(frame, [0, 12], [0, 1], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ backgroundColor: "#0a0a0a" }}>
      {imageUrl ? (
        <AbsoluteFill
          style={{
            alignItems: "center",
            justifyContent: "center",
            opacity,
            transform: `scale(${scale})`,
          }}
        >
          <Img
            src={imageUrl}
            style={{
              maxWidth: "85%",
              maxHeight: "85%",
              objectFit: "contain",
              boxShadow: "0 30px 80px rgba(0,0,0,0.6)",
            }}
          />
        </AbsoluteFill>
      ) : null}
    </AbsoluteFill>
  );
};
