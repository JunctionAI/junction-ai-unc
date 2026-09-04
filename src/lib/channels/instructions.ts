import { telegramDeepLink } from "./adapters/telegram";
import { smsDeepLink } from "./adapters/twilio";
import { whatsappDeepLink } from "./adapters/whatsapp";
import type { Channel } from "./types";
import type { channelAvailability } from "./server";

/** Human instructions for completing a channel link. Kept outside the route module because
 * Next.js route files may only export HTTP handlers and supported route configuration. */
export function instructionFor(channel: Channel, code: string, avail: ReturnType<typeof channelAvailability>): { url: string | null; text: string } {
  const a = avail.find((x) => x.channel === channel);
  switch (channel) {
    case "telegram":
      return { url: a?.botUsername ? telegramDeepLink(a.botUsername, code) : null, text: a?.botUsername ? `Open @${a.botUsername} in Telegram and press Start — or send it ${code}.` : `Send ${code} to the Unc bot in Telegram.` };
    case "whatsapp":
      return { url: a?.number ? whatsappDeepLink(a.number, code) : null, text: a?.number ? `Message +${a.number} on WhatsApp with ${code}.` : `Send ${code} to Unc on WhatsApp.` };
    case "sms":
      return { url: a?.number ? smsDeepLink(a.number, code) : null, text: a?.number ? `Text ${code} to ${a.number}.` : `Text ${code} to Unc.` };
    case "slack":
      return { url: "/api/channels/slack/start", text: "Add Unc to your Slack workspace — that links you, no code needed." };
    case "email":
      return { url: null, text: "Not switched on yet — I'll tell you the moment it is." };
    case "apple":
      return { url: null, text: "Apple Messages is not ready yet. Use app chat while we finish provider verification." };
  }
}
