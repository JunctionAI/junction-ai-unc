import {
  Interactive,
  interpolate,
  Easing,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Frame } from "../Launch";
export const Work = () => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const vertical = height > width;
  return (
    <Frame dark>
      <Interactive.Div
        name="Work headline"
        style={{
          position: "absolute",
          top: vertical ? 330 : 220,
          left: vertical ? 84 : 100,
          right: 84,
          fontSize: vertical ? 105 : 120,
          fontWeight: 600,
          lineHeight: 1.08,
          letterSpacing: -5,
        }}
      >
        Useful work.
        <br />
        <span style={{ color: "#86d8ed" }}>Ready for review.</span>
      </Interactive.Div>
      <Interactive.Div
        name="Illustrative work pack"
        style={{
          position: "absolute",
          top: vertical ? 840 : 550,
          left: vertical ? 84 : 100,
          right: vertical ? 84 : 100,
          borderRadius: 26,
          padding: vertical ? 44 : 48,
          background: "#f7f4ec",
          color: "#1b2740",
          scale: interpolate(frame, [10, 40], [0.94, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
          opacity: interpolate(frame, [10, 24], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        <div
          style={{
            fontSize: 24,
            letterSpacing: 2,
            color: "#52616d",
            marginBottom: 28,
          }}
        >
          ILLUSTRATIVE WORK PACK · NOT A LIVE CLIENT RESULT
        </div>
        <div
          style={{
            display: "flex",
            gap: 30,
            flexDirection: vertical ? "column" : "row",
          }}
        >
          {["Research", "Recommendations", "Drafts"].map((t, i) => (
            <div
              key={t}
              style={{
                flex: 1,
                borderTop: "2px solid #cbd3d7",
                paddingTop: 24,
                fontSize: vertical ? 49 : 45,
                fontWeight: 600,
              }}
            >
              <span style={{ color: "#345d7e" }}>0{i + 1} </span>
              {t}
            </div>
          ))}
        </div>
        <div
          style={{
            marginTop: 40,
            fontSize: vertical ? 40 : 35,
            color: "#345d7e",
          }}
        >
          Sources attached. A clear next step.
        </div>
      </Interactive.Div>
    </Frame>
  );
};
