import LegalDocument from "@/components/legal/LegalDocument";
import { TERMS } from "@/content/legal";

export const metadata = { title: "Junction — Terms of Service", description: "The terms you agree to when you use Junction." };

export default function TermsPage() {
  return <LegalDocument doc={TERMS} />;
}
