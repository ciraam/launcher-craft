interface NavigatorWithUAData extends Navigator {
  userAgentData?: {
    platform?: string;
  };
}

export function isMacOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as NavigatorWithUAData;
  const platform =
    nav.userAgentData?.platform || navigator.platform || navigator.userAgent || "";
  return /mac|darwin|iphone|ipad/i.test(platform);
}

export function getShortcutDisplay(key: string): string {
  const upper = key.toUpperCase();
  return isMacOS() ? `⌘${upper}` : `Ctrl+${upper}`;
}
