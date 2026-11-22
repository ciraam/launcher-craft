export function normalizeVersion(raw: string): string {
  return raw.trim().replace(/^[vV]/, "");
}

function parseVersionParts(raw: string): number[] | null {
  const core = normalizeVersion(raw).split("-")[0];
  if (!core) return null;
  const parts = core.split(".").map((p) => Number.parseInt(p, 10));
  if (parts.some((n) => Number.isNaN(n))) return null;
  return parts;
}

export function compareVersions(a: string, b: string): number {
  const pa = parseVersionParts(a);
  const pb = parseVersionParts(b);
  if (!pa || !pb) {
    return normalizeVersion(a).localeCompare(normalizeVersion(b));
  }
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va !== vb) return va > vb ? 1 : -1;
  }
  return 0;
}

export function isUpdateAvailable(
  installedVersion: string | undefined,
  latestVersion: string | undefined
): boolean {
  if (!installedVersion || !latestVersion) return false;
  return compareVersions(latestVersion, installedVersion) > 0;
}

export function globMatch(pattern: string, text: string): boolean {
  const p = pattern.trim().toLowerCase();
  const t = text.toLowerCase();
  let pi = 0;
  let ti = 0;
  let starIdx = -1;
  let matchIdx = 0;

  while (ti < t.length) {
    if (pi < p.length && (p[pi] === "?" || p[pi] === t[ti])) {
      pi++;
      ti++;
    } else if (pi < p.length && p[pi] === "*") {
      starIdx = pi;
      matchIdx = ti;
      pi++;
    } else if (starIdx !== -1) {
      pi = starIdx + 1;
      matchIdx++;
      ti = matchIdx;
    } else {
      return false;
    }
  }

  while (pi < p.length && p[pi] === "*") {
    pi++;
  }
  return pi === p.length;
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 Mo";
  const units = ["o", "Ko", "Mo", "Go"];
  const idx = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / Math.pow(1024, idx);
  return `${val >= 100 || idx === 0 ? val.toFixed(0) : val.toFixed(1)} ${units[idx]}`;
}

export function formatSpeed(bytesPerSec: number): string {
  if (!bytesPerSec || bytesPerSec <= 0) return "—";
  return `${formatBytes(bytesPerSec)}/s`;
}

export function formatRelativeDate(iso?: string | null): string {
  if (!iso) return "Date inconnue";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const diffMs = Date.now() - date.getTime();
  const diffDays = Math.floor(diffMs / 86_400_000);
  if (diffDays <= 0) return "Aujourd'hui";
  if (diffDays === 1) return "Hier";
  if (diffDays < 30) return `Il y a ${diffDays} j`;
  return date.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
