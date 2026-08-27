const GSM_BASIC = "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ ÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM_EXTENDED = "^{}\\[~]|€";

export type SmsSegmentEstimate = {
  encoding: "gsm7" | "unicode";
  characters: number;
  units: number;
  segments: number;
  limit: number;
};

export function estimateSmsSegments(message: string): SmsSegmentEstimate {
  let gsm = true;
  let units = 0;
  for (const char of message) {
    if (GSM_BASIC.includes(char)) units += 1;
    else if (GSM_EXTENDED.includes(char)) units += 2;
    else {
      gsm = false;
      break;
    }
  }

  const characters = Array.from(message).length;
  if (!gsm) {
    const unicodeUnits = Array.from(message).reduce((total, char) => total + (char.length === 2 ? 2 : 1), 0);
    return {
      encoding: "unicode",
      characters,
      units: unicodeUnits,
      segments: unicodeUnits === 0 ? 0 : unicodeUnits <= 70 ? 1 : Math.ceil(unicodeUnits / 67),
      limit: unicodeUnits <= 70 ? 70 : 67,
    };
  }
  return {
    encoding: "gsm7",
    characters,
    units,
    segments: units === 0 ? 0 : units <= 160 ? 1 : Math.ceil(units / 153),
    limit: units <= 160 ? 160 : 153,
  };
}

export function renderSmsPersonalization(template: string, firstName: string) {
  return template.replaceAll("{{first_name}}", firstName.trim() || "there");
}
