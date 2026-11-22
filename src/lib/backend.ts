import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type {
  AppEntry,
  AppStateSnapshot,
  CheckAllUpdatesResult,
  DownloadProgressEvent,
  InstalledApp,
  Registry,
  ReleaseAsset,
  ReleaseInfo,
  RemoveCustomAppResult,
  ScoopImportResult,
  ScoopIndexEntry,
  ScoopSearchResult,
  Settings,
} from "@/types/launcher";
import { globMatch, normalizeVersion } from "@/lib/semver";
import { readCachedTheme } from "@/lib/theme";

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

const DESKTOP_REQUIRED_ERROR =
  "Cette action requiert l'application native Craft.ro Desktop (Tauri v2). La simulation web factice est désactivée.";

// ---------- Read-only GitHub & Scoop index viewer when opened outside Tauri ----------
interface GhApiAsset {
  id: number;
  name: string;
  size: number;
  browser_download_url: string;
  url: string;
  content_type?: string;
  digest?: string | null;
}

interface GhApiRelease {
  tag_name: string;
  name?: string;
  body?: string;
  published_at?: string;
  html_url: string;
  assets: GhApiAsset[];
}

interface WebScoopCache {
  updatedAt: string;
  mainCount: number;
  extrasCount: number;
  entries: ScoopIndexEntry[];
}

let webScoopIndexCache: WebScoopCache | null = null;

function parseSha256(raw?: string | null): string | null {
  if (!raw) return null;
  const cleaned = raw.trim().replace(/^sha256:/i, "").trim();
  return /^[a-f0-9]{64}$/i.test(cleaned) ? cleaned.toLowerCase() : null;
}

async function fetchPublicGithubReleaseReadOnly(app: AppEntry): Promise<ReleaseInfo> {
  const resp = await fetch(`https://api.github.com/repos/${app.repo}/releases/latest`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!resp.ok) {
    throw new Error(`GitHub API HTTP ${resp.status} pour ${app.repo}`);
  }
  const data = (await resp.json()) as GhApiRelease;
  const rawAsset =
    data.assets.find((a) => globMatch(app.assetPattern, a.name)) ??
    data.assets.find((a) => /\.(zip|exe|msi)$/i.test(a.name));

  const checksumCandidate = rawAsset
    ? data.assets.find((a) => {
        const l = a.name.toLowerCase();
        return (
          l === `${rawAsset.name.toLowerCase()}.sha256` ||
          l === `${rawAsset.name.toLowerCase()}.sha256sum` ||
          l === "sha256sums" ||
          l === "sha256sums.txt"
        );
      })
    : undefined;

  const matchedAsset: ReleaseAsset | null = rawAsset
    ? {
        id: rawAsset.id,
        name: rawAsset.name,
        size: rawAsset.size,
        browserDownloadUrl: rawAsset.browser_download_url,
        apiUrl: rawAsset.url,
        contentType: rawAsset.content_type,
        sha256: parseSha256(app.sha256) ?? parseSha256(rawAsset.digest),
        checksumAsset: checksumCandidate
          ? {
              name: checksumCandidate.name,
              browserDownloadUrl: checksumCandidate.browser_download_url,
              apiUrl: checksumCandidate.url,
            }
          : null,
      }
    : null;

  return {
    appId: app.id,
    repo: app.repo,
    tagName: data.tag_name,
    version: normalizeVersion(data.tag_name),
    name: data.name?.trim() ? data.name : data.tag_name,
    body: data.body ?? "",
    publishedAt: data.published_at,
    htmlUrl: data.html_url,
    matchedAsset,
    checkedAt: new Date().toISOString(),
    fromCache: false,
  };
}

function searchWebScoopCache(
  cache: WebScoopCache,
  query: string,
  bucket?: string,
  limit = 60
): ScoopSearchResult {
  const q = query.trim().toLowerCase();
  const b = bucket && bucket !== "all" && bucket !== "Tous" ? bucket.toLowerCase() : null;
  const exact: ScoopIndexEntry[] = [];
  const prefix: ScoopIndexEntry[] = [];
  const contains: ScoopIndexEntry[] = [];

  for (const item of cache.entries) {
    if (b && item.bucket.toLowerCase() !== b) continue;
    if (!q) {
      prefix.push(item);
      continue;
    }
    const lower = item.name.toLowerCase();
    if (lower === q) exact.push(item);
    else if (lower.startsWith(q)) prefix.push(item);
    else if (lower.includes(q)) contains.push(item);
  }

  const all = [...exact, ...prefix, ...contains];
  return {
    items: all.slice(0, limit),
    totalMatches: all.length,
    totalIndexed: cache.entries.length,
    mainCount: cache.mainCount,
    extrasCount: cache.extrasCount,
    updatedAt: cache.updatedAt,
  };
}

// ---------- Public Native-First API ----------

export async function getAppState(): Promise<AppStateSnapshot> {
  if (isTauriRuntime()) {
    return invoke<AppStateSnapshot>("get_app_state");
  }

  const res = await fetch("./registry.json");
  const registry = (await res.json()) as Registry;
  return {
    registry,
    installedApps: {},
    releases: {},
    favorites: [],
    settings: {
      installDir: "%LOCALAPPDATA%\\Craft.ro\\Apps",
      registryUrl: "",
      autoCheckUpdates: true,
      requireSha256: false,
      theme: readCachedTheme(),
    },
    hasGithubToken: false,
    dataDir: "%APPDATA%\\Craft.ro",
  };
}

export async function refreshRegistry(): Promise<Registry> {
  if (isTauriRuntime()) {
    return invoke<Registry>("refresh_registry");
  }
  const res = await fetch("./registry.json");
  return (await res.json()) as Registry;
}

export async function checkRelease(appId: string, force = false): Promise<ReleaseInfo> {
  if (isTauriRuntime()) {
    return invoke<ReleaseInfo>("check_release", { appId, force });
  }
  const reg = await refreshRegistry();
  const app = reg.apps.find((a) => a.id === appId);
  if (!app) throw new Error(`Application introuvable: ${appId}`);
  return fetchPublicGithubReleaseReadOnly(app);
}

export async function checkAllUpdates(force = false): Promise<CheckAllUpdatesResult> {
  if (isTauriRuntime()) {
    return invoke<CheckAllUpdatesResult>("check_all_updates", { force });
  }
  const reg = await refreshRegistry();
  const releases: Record<string, ReleaseInfo> = {};
  const errors: Record<string, string> = {};

  await Promise.all(
    reg.apps.map(async (app) => {
      try {
        releases[app.id] = await fetchPublicGithubReleaseReadOnly(app);
      } catch (err) {
        errors[app.id] = err instanceof Error ? err.message : "Erreur réseau GitHub";
      }
    })
  );

  return { releases, errors };
}

export async function installOrUpdateApp(appId: string): Promise<InstalledApp> {
  if (!isTauriRuntime()) {
    throw new Error(DESKTOP_REQUIRED_ERROR);
  }
  return invoke<InstalledApp>("install_or_update_app", { appId });
}

export async function cancelDownload(appId: string): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  return invoke<boolean>("cancel_download", { appId });
}

export async function launchApp(appId: string): Promise<void> {
  if (!isTauriRuntime()) {
    throw new Error(DESKTOP_REQUIRED_ERROR);
  }
  return invoke<void>("launch_app", { appId });
}

export async function openInstallFolder(appId: string): Promise<void> {
  if (!isTauriRuntime()) {
    throw new Error(DESKTOP_REQUIRED_ERROR);
  }
  return invoke<void>("open_install_folder", { appId });
}

export async function uninstallApp(appId: string): Promise<void> {
  if (!isTauriRuntime()) {
    throw new Error(DESKTOP_REQUIRED_ERROR);
  }
  return invoke<void>("uninstall_app", { appId });
}

export async function saveSettings(settings: Settings): Promise<Settings> {
  if (!isTauriRuntime()) {
    // Allow non-secret UI theme persistence in web preview without faking desktop backend settings
    return settings;
  }
  return invoke<Settings>("save_settings", { settings });
}

export async function setGithubToken(token: string): Promise<boolean> {
  if (!isTauriRuntime()) {
    throw new Error(DESKTOP_REQUIRED_ERROR);
  }
  return invoke<boolean>("set_github_token", { token });
}

export async function clearGithubToken(): Promise<boolean> {
  if (!isTauriRuntime()) {
    throw new Error(DESKTOP_REQUIRED_ERROR);
  }
  return invoke<boolean>("clear_github_token");
}

export async function addCustomApp(app: AppEntry): Promise<Registry> {
  if (!isTauriRuntime()) {
    throw new Error(DESKTOP_REQUIRED_ERROR);
  }
  return invoke<Registry>("add_custom_app", { app });
}

export async function toggleFavorite(appId: string): Promise<string[]> {
  if (!isTauriRuntime()) {
    throw new Error(DESKTOP_REQUIRED_ERROR);
  }
  return invoke<string[]>("toggle_favorite", { appId });
}

export async function removeCustomApp(appId: string): Promise<RemoveCustomAppResult> {
  if (!isTauriRuntime()) {
    throw new Error(DESKTOP_REQUIRED_ERROR);
  }
  return invoke<RemoveCustomAppResult>("remove_custom_app", { appId });
}

// ---------- Scoop Catalog API ----------

export async function syncScoopIndex(force = false): Promise<ScoopSearchResult> {
  if (isTauriRuntime()) {
    return invoke<ScoopSearchResult>("sync_scoop_index", { force });
  }

  if (webScoopIndexCache && !force) {
    return searchWebScoopCache(webScoopIndexCache, "", undefined, 60);
  }

  const entries: ScoopIndexEntry[] = [];
  let mainCount = 0;
  let extrasCount = 0;

  for (const bucket of ["Main", "Extras"] as const) {
    const resp = await fetch(
      `https://api.github.com/repos/ScoopInstaller/${bucket}/git/trees/master?recursive=1`,
      { headers: { Accept: "application/vnd.github+json" } }
    );
    if (!resp.ok) {
      throw new Error(`Synchronisation Scoop ${bucket} impossible (HTTP ${resp.status})`);
    }
    const data = (await resp.json()) as { tree: { path: string; type: string }[] };
    for (const item of data.tree) {
      if (item.type !== "blob" || !item.path.startsWith("bucket/") || !item.path.endsWith(".json")) {
        continue;
      }
      const name = item.path.slice("bucket/".length, -".json".length);
      if (name.includes("/") || !/^[a-zA-Z0-9_.-]+$/.test(name)) continue;
      if (bucket === "Main") mainCount++;
      else extrasCount++;
      entries.push({ name, bucket });
    }
  }

  entries.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  webScoopIndexCache = {
    updatedAt: new Date().toISOString(),
    mainCount,
    extrasCount,
    entries,
  };
  return searchWebScoopCache(webScoopIndexCache, "", undefined, 60);
}

export async function searchScoopApps(
  query: string,
  bucket?: string,
  limit = 60
): Promise<ScoopSearchResult> {
  if (isTauriRuntime()) {
    return invoke<ScoopSearchResult>("search_scoop_apps", { query, bucket, limit });
  }
  if (!webScoopIndexCache) {
    return {
      items: [],
      totalMatches: 0,
      totalIndexed: 0,
      mainCount: 0,
      extrasCount: 0,
      updatedAt: "",
    };
  }
  return searchWebScoopCache(webScoopIndexCache, query, bucket, limit);
}

export async function importScoopApp(bucket: string, name: string): Promise<ScoopImportResult> {
  if (!isTauriRuntime()) {
    throw new Error(DESKTOP_REQUIRED_ERROR);
  }
  return invoke<ScoopImportResult>("import_scoop_app", { bucket, name });
}

export async function pickInstallDirectory(defaultPath?: string): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  const selected = await openDialog({
    directory: true,
    multiple: false,
    defaultPath,
    title: "Choisir le dossier d'installation Craft.ro",
  });
  return typeof selected === "string" ? selected : null;
}

export async function subscribeDownloadProgress(
  handler: (event: DownloadProgressEvent) => void
): Promise<UnlistenFn> {
  if (isTauriRuntime()) {
    return listen<DownloadProgressEvent>("download-progress", (e) => handler(e.payload));
  }
  return () => {};
}

export const windowControls = {
  async minimize() {
    if (isTauriRuntime()) {
      await getCurrentWindow().minimize();
    }
  },
  async toggleMaximize(): Promise<boolean> {
    if (isTauriRuntime()) {
      const win = getCurrentWindow();
      await win.toggleMaximize();
      return win.isMaximized();
    }
    return false;
  },
  async close() {
    if (isTauriRuntime()) {
      await getCurrentWindow().close();
    }
  },
  async startDragging() {
    if (isTauriRuntime()) {
      await getCurrentWindow().startDragging();
    }
  },
};
