import {
  Interactive,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Frame } from "../Launch";
export const Judgment = () => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const vertical = height > width;
  return (
    <Frame>
      <Interactive.Div
        name="Human judgment"
        style={{
          position: "absolute",
          top: vertical ? 450 : 275,
          left: vertical ? 84 : 100,
          right: 84,
          fontSize: vertical ? 112 : 144,
          fontWeight: 600,
          lineHeight: 1.1,
          letterSpacing: -6,
        }}
      >
        Agents do the prep.
        <br />
        <span
          style={{
            color: "#345d7e",
            opacity: interpolate(frame, [15, 29], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
          }}
        >
          You call the shots.
        </span>
      </Interactive.Div>
      <Interactive.Div
        name="Approval boundary"
        style={{
          position: "absolute",
          left: vertical ? 84 : 100,
          right: 84,
          top: vertical ? 1180 : 720,
          fontSize: vertical ? 48 : 45,
          lineHeight: 1.5,
          opacity: interpolate(frame, [30, 44], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        Initial beta: research and drafts.
        <br />
        No publishing, customer sends or ad changes.
      </Interactive.Div>
    </Frame>
  );
};
