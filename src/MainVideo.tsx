import React from "react";
import { AbsoluteFill, Audio, Sequence } from "remotion";
import { z } from "zod";
import { CaptionScene } from "./scenes/CaptionScene";
import { OutroScene } from "./scenes/OutroScene";

export const sceneSchema = z.object({
  scene: z.number(),
  caption: z.string(),
  narration: z.string(),
  emotion: z.enum(["hook", "emphasis", "punchline", "cta"]),
  duration: z.number(),
  video_url: z.string(),
  narration_url: z.string(),
  highlight_words: z.array(z.string()).default([]),
  text_size: z.number().default(80),
});

export const mainVideoSchema = z.object({
  scenes: z.array(sceneSchema),
  outro_image_url: z.string(),
  outro_duration: z.number().default(10),
});

export type MainVideoProps = z.infer<typeof mainVideoSchema>;

const FPS = 30;

function totalSceneFrames(scenes: MainVideoProps["scenes"]) {
  return scenes.reduce((acc, s) => acc + Math.round(s.duration * FPS), 0);
}

export const calcMainMetadata = async ({
  props,
}: {
  props: MainVideoProps;
}) => {
  const sceneFrames = totalSceneFrames(props.scenes);
  const outroFrames = Math.round((props.outro_duration ?? 10) * FPS);
  return {
    durationInFrames: Math.max(sceneFrames + outroFrames, 30),
    fps: FPS,
    width: 1080,
    height: 1920,
  };
};

export const MainVideo: React.FC<MainVideoProps> = ({
  scenes,
  outro_image_url,
  outro_duration,
}) => {
  let cursor = 0;
  const sceneFrames = totalSceneFrames(scenes);
  const outroFrames = Math.round((outro_duration ?? 10) * FPS);

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {scenes.map((s) => {
        const dur = Math.round(s.duration * FPS);
        const from = cursor;
        cursor += dur;
        return (
          <Sequence key={s.scene} from={from} durationInFrames={dur}>
            <CaptionScene scene={s} durationInFrames={dur} fps={FPS} />
            <Audio src={s.narration_url} />
          </Sequence>
        );
      })}
      <Sequence from={sceneFrames} durationInFrames={outroFrames}>
        <OutroScene imageUrl={outro_image_url} fps={FPS} />
      </Sequence>
    </AbsoluteFill>
  );
};
