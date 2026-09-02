import LegalDocument from "@/components/legal/LegalDocument";
import { PRIVACY } from "@/content/legal";

export const metadata = { title: "Junction — Privacy Policy", description: "How Junction handles your data and your customers' data." };

export default function PrivacyPage() {
  return <LegalDocument doc={PRIVACY} />;
}
