import {
  Interactive,
  interpolate,
  Easing,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Frame } from "../Launch";
export const Meet = () => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const vertical = height > width;
  return (
    <Frame dark>
      <Interactive.Div
        name="Meet Junction"
        style={{
          position: "absolute",
          top: vertical ? 400 : 250,
          left: vertical ? 84 : 100,
          right: 84,
          fontSize: vertical ? 118 : 172,
          lineHeight: 1.03,
          fontWeight: 600,
          letterSpacing: -6,
          translate: interpolate(frame, [0, 24], ["0px 60px", "0px 0px"], {
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        meet
        <br />
        <span style={{ color: "#86d8ed" }}>junction.</span>
      </Interactive.Div>
      <Interactive.Div
        name="Specialists"
        style={{
          position: "absolute",
          top: vertical ? 900 : 290,
          left: vertical ? 84 : 1090,
          right: 84,
          fontSize: vertical ? 65 : 63,
          lineHeight: 1.48,
          fontWeight: 400,
          opacity: interpolate(frame, [15, 35], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
          translate: interpolate(frame, [15, 35], ["50px 0px", "0px 0px"], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        sales.
        <br />
        content.
        <br />
        paid ads.
        <br />
        seo.
        <br />
        email.
      </Interactive.Div>
    </Frame>
  );
};
