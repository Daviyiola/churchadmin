const FRIENDLY_TIMEZONE_NAMES: Record<string, string> = {
  "America/New_York": "Eastern Time",
  "America/Chicago": "Central Time",
  "America/Denver": "Mountain Time",
  "America/Phoenix": "Mountain Time — Arizona",
  "America/Los_Angeles": "Pacific Time",
  "America/Anchorage": "Alaska Time",
  "Pacific/Honolulu": "Hawaii Time",
  "America/Halifax": "Atlantic Time",
  UTC: "Coordinated Universal Time (UTC)",
  "Europe/London": "United Kingdom Time",
  "Europe/Paris": "Central European Time",
  "Africa/Lagos": "West Africa Time",
  "Africa/Johannesburg": "South Africa Time",
  "Africa/Nairobi": "East Africa Time",
  "Asia/Dubai": "Gulf Standard Time",
  "Asia/Kolkata": "India Standard Time",
  "Asia/Tokyo": "Japan Standard Time",
  "Australia/Sydney": "Australian Eastern Time",
  "Pacific/Auckland": "New Zealand Time",
};

export function friendlyTimezoneName(value: string) {
  if (FRIENDLY_TIMEZONE_NAMES[value]) return FRIENDLY_TIMEZONE_NAMES[value];
  const [region, ...locationParts] = value.split("/");
  const location = locationParts.join(" / ").replaceAll("_", " ");
  return location
    ? `${location} (${region.replaceAll("_", " ")})`
    : value.replaceAll("_", " ");
}

export function timezoneOptions() {
  const supported =
    typeof Intl.supportedValuesOf === "function"
      ? Intl.supportedValuesOf("timeZone")
      : [];
  const preferred = Object.keys(FRIENDLY_TIMEZONE_NAMES);
  const all = [...new Set(["UTC", ...supported])];

  return all.sort((a, b) => {
    const aPreferred = preferred.indexOf(a);
    const bPreferred = preferred.indexOf(b);
    if (aPreferred !== -1 || bPreferred !== -1) {
      if (aPreferred === -1) return 1;
      if (bPreferred === -1) return -1;
      return aPreferred - bPreferred;
    }
    return friendlyTimezoneName(a).localeCompare(friendlyTimezoneName(b));
  });
}

export function isValidTimezone(value: string) {
  if (!value) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}
