import {
  Interactive,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Frame } from "../Launch";
export const Invite = ({ still = false }: { still?: boolean }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const vertical = height > width;
  const content = (
    <>
      <Interactive.Div
        name="Final invitation"
        style={{
          position: "absolute",
          top: vertical ? height * 0.26 : 240,
          left: vertical ? 84 : 100,
          right: 84,
          fontSize: vertical ? 107 : 145,
          fontWeight: 600,
          lineHeight: 1.08,
          letterSpacing: -5,
          opacity: still
            ? 1
            : interpolate(frame, [0, 16], [0, 1], {
                extrapolateRight: "clamp",
              }),
        }}
      >
        Bring one task.
        <br />
        <span style={{ color: "#345d7e" }}>Let’s put it to work.</span>
      </Interactive.Div>
      <Interactive.Div
        name="Website CTA"
        style={{
          position: "absolute",
          left: vertical ? 84 : 100,
          top: vertical ? height * 0.58 : 650,
          background: "#345d7e",
          color: "white",
          padding: "28px 44px",
          borderRadius: 60,
          fontSize: vertical ? 62 : 65,
          fontWeight: 600,
        }}
      >
        getjunction.ai <span style={{ marginLeft: 24 }}>↗</span>
      </Interactive.Div>
      <Interactive.Div
        name="Call details"
        style={{
          position: "absolute",
          left: vertical ? 84 : 100,
          top: vertical ? height * 0.72 : 817,
          right: 84,
          fontSize: vertical ? 43 : 42,
          lineHeight: 1.5,
        }}
      >
        Book a 20-minute call with Tom.
        <br />
        Find your first useful workflow.
      </Interactive.Div>
    </>
  );
  return still ? content : <Frame>{content}</Frame>;
};
