import {
  AbsoluteFill,
  Interactive,
  staticFile,
  useVideoConfig,
} from "remotion";
import { Audio } from "@remotion/media";
import { TransitionSeries } from "@remotion/transitions";
import { Opening } from "./scenes/Opening";
import { Meet } from "./scenes/Meet";
import { Context } from "./scenes/Context";
import { Work } from "./scenes/Work";
import { Judgment } from "./scenes/Judgment";
import { Invite } from "./scenes/Invite";

export const Brand = () => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: 18,
      fontSize: 34,
      fontWeight: 700,
    }}
  >
    <svg width="48" height="48" viewBox="0 0 48 48">
      <rect width="48" height="48" rx="14" fill="#1b2740" />
      <path
        d="m12 14 13 10-13 10"
        fill="none"
        stroke="#69cee9"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <path
        d="M27 24h10"
        stroke="#e5ab54"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
    Junction AI
  </div>
);
export const Frame = ({
  children,
  dark = false,
}: {
  children: React.ReactNode;
  dark?: boolean;
}) => {
  const { width, height } = useVideoConfig();
  return (
    <AbsoluteFill
      style={{
        background: dark ? "#1b2740" : "#f7f4ec",
        color: dark ? "#f7f4ec" : "#1b2740",
        fontFamily: "Manrope, sans-serif",
        overflow: "hidden",
      }}
    >
      <style>{`@font-face{font-family:Manrope;src:url('${staticFile("fonts/manrope-400.woff2")}');font-weight:400}@font-face{font-family:Manrope;src:url('${staticFile("fonts/manrope-600.woff2")}');font-weight:600}@font-face{font-family:Manrope;src:url('${staticFile("fonts/manrope-700.woff2")}');font-weight:700}`}</style>
      <div
        style={{
          position: "absolute",
          top: height > width ? 110 : 64,
          left: width > height ? 100 : 84,
        }}
      >
        <Brand />
      </div>
      {children}
      <Interactive.Div
        name="Beta status"
        style={{
          position: "absolute",
          bottom: height > width ? 112 : 58,
          left: width > height ? 100 : 84,
          fontSize: 25,
          letterSpacing: 1.5,
          opacity: 0.65,
        }}
      >
        PRIVATE BETA · BUILT AROUND YOUR BUSINESS
      </Interactive.Div>
    </AbsoluteFill>
  );
};
export const Launch = () => (
  <>
    <Audio src={staticFile("junction-pulse.wav")} volume={0.75} />
    <TransitionSeries>
      <TransitionSeries.Sequence durationInFrames={135} name="The task">
        <Opening />
      </TransitionSeries.Sequence>
      <TransitionSeries.Sequence durationInFrames={135} name="Meet Junction">
        <Meet />
      </TransitionSeries.Sequence>
      <TransitionSeries.Sequence durationInFrames={180} name="Business context">
        <Context />
      </TransitionSeries.Sequence>
      <TransitionSeries.Sequence durationInFrames={180} name="Useful work">
        <Work />
      </TransitionSeries.Sequence>
      <TransitionSeries.Sequence durationInFrames={120} name="Your judgment">
        <Judgment />
      </TransitionSeries.Sequence>
      <TransitionSeries.Sequence durationInFrames={150} name="Book a call">
        <Invite />
      </TransitionSeries.Sequence>
    </TransitionSeries>
  </>
);
export const Cover = () => (
  <Frame>
    <Invite still />
  </Frame>
);
