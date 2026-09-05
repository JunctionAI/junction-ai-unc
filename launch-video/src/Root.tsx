import "./index.css";
import { Composition, Still } from "remotion";
import { Launch, Cover } from "./Launch";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="Junction-Launch"
        component={Launch}
        durationInFrames={900}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="Junction-Vertical"
        component={Launch}
        durationInFrames={900}
        fps={30}
        width={1080}
        height={1920}
      />
      <Still id="Junction-Cover" component={Cover} width={1920} height={1080} />
      <Still
        id="Junction-Social"
        component={Cover}
        width={1080}
        height={1350}
      />
    </>
  );
};
