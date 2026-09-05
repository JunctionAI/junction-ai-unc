import {
  Interactive,
  interpolate,
  Easing,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Frame } from "../Launch";
export const Context = () => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const vertical = height > width;
  return (
    <Frame>
      <Interactive.Div
        name="Context headline"
        style={{
          position: "absolute",
          top: vertical ? 370 : 205,
          left: vertical ? 84 : 100,
          right: 84,
          fontSize: vertical ? 108 : 128,
          fontWeight: 600,
          lineHeight: 1.05,
          letterSpacing: -5,
          opacity: interpolate(frame, [0, 15], [0, 1], {
            extrapolateRight: "clamp",
          }),
        }}
      >
        Your business.
        <br />
        <span style={{ color: "#345d7e" }}>Not a blank prompt.</span>
      </Interactive.Div>
      <div
        style={{
          position: "absolute",
          top: vertical ? 870 : 580,
          left: vertical ? 84 : 100,
          right: 84,
          display: "flex",
          flexDirection: vertical ? "column" : "row",
          gap: 24,
        }}
      >
        {["Your offer", "Your audience", "Your source data"].map((text, i) => (
          <Interactive.Div
            key={text}
            name={text}
            style={{
              flex: 1,
              padding: vertical ? 42 : 44,
              borderRadius: 22,
              background: i === 2 ? "#345d7e" : "#eae7df",
              color: i === 2 ? "white" : "#1b2740",
              fontSize: vertical ? 56 : 49,
              fontWeight: 600,
              translate: interpolate(
                frame,
                [20 + i * 14, 48 + i * 14],
                ["0px 80px", "0px 0px"],
                {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                  easing: Easing.bezier(0.16, 1, 0.3, 1),
                },
              ),
              opacity: interpolate(frame, [20 + i * 14, 36 + i * 14], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              }),
            }}
          >
            {text}
            <div style={{ fontSize: 28, marginTop: 20, opacity: 0.7 }}>
              {
                ["What you sell", "Who you help", "What the work is based on"][
                  i
                ]
              }
            </div>
          </Interactive.Div>
        ))}
      </div>
      <Interactive.Div
        name="Context qualifier"
        style={{
          position: "absolute",
          bottom: vertical ? 250 : 163,
          left: vertical ? 84 : 100,
          fontSize: 30,
          opacity: 0.65,
        }}
      >
        Supported connections confirmed during setup.
      </Interactive.Div>
    </Frame>
  );
};
