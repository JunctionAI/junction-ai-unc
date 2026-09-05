import {
  Interactive,
  interpolate,
  Easing,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Frame } from "../Launch";
export const Opening = () => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const vertical = height > width;
  return (
    <Frame>
      <Interactive.Div
        name="Opening headline"
        style={{
          position: "absolute",
          top: vertical ? 440 : 255,
          left: vertical ? 84 : 100,
          right: 84,
          fontSize: vertical ? 110 : 152,
          lineHeight: 1.05,
          fontWeight: 600,
          letterSpacing: -6,
          translate: interpolate(frame, [0, 23], ["0px 60px", "0px 0px"], {
            easing: Easing.bezier(0.16, 1, 0.3, 1),
            extrapolateRight: "clamp",
          }),
          opacity: interpolate(frame, [0, 14], [0, 1], {
            extrapolateRight: "clamp",
          }),
        }}
      >
        That task
        <br />
        you keep
        <br />
        <span style={{ color: "#345d7e" }}>putting off.</span>
      </Interactive.Div>
      <Interactive.Div
        name="Task note"
        style={{
          position: "absolute",
          left: vertical ? 84 : 1190,
          top: vertical ? 1060 : 410,
          width: vertical ? 900 : 600,
          padding: 40,
          borderRadius: 24,
          background: "#eee9df",
          fontSize: vertical ? 49 : 47,
          lineHeight: 1.4,
          rotate: interpolate(frame, [15, 55], ["5deg", "-3deg"], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
          opacity: interpolate(frame, [15, 30], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        write the follow-up
        <br />
        plan the next ad test
        <br />
        finally draft that post <span style={{ color: "#345d7e" }}>↗</span>
      </Interactive.Div>
    </Frame>
  );
};
