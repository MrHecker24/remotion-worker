import React from "react";
import { Composition } from "remotion";
import { MainVideo, mainVideoSchema, calcMainMetadata } from "./MainVideo";

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="main"
      component={MainVideo}
      schema={mainVideoSchema}
      width={1080}
      height={1920}
      fps={30}
      durationInFrames={300}
      defaultProps={{
        scenes: [],
        outro_image_url: "",
        outro_duration: 10,
      }}
      calculateMetadata={calcMainMetadata}
    />
  );
};
