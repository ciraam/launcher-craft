export type AppCategory = "Outils" | "Créativité" | "Dev" | "Utilitaires" | string;
export type AppSource = "github" | "scoop";
export type ThemeMode = "dark" | "light" | "system";

export interface AppEntry {
  id: string;
  name: string;
  tagline: string;
  description: string;
  category: AppCategory;
  repo: string;
  icon: string;
  assetPattern: string;
  executableName: string;
  accentColor?: string;
  homepage?: string;
  sha256?: string | null;
  isCustom?: boolean;
  source?: AppSource;
  scoopBucket?: string | null;
  scoopName?: string | null;
}

export interface Registry {
  version: number;
  updatedAt?: string;
  apps: AppEntry[];
}

export interface ChecksumAsset {
  name: string;
  browserDownloadUrl: string;
  apiUrl: string;
}

export interface ReleaseAsset {
  id: number;
  name: string;
  size: number;
  browserDownloadUrl: string;
  apiUrl: string;
  contentType?: string;
  sha256?: string | null;
  checksumAsset?: ChecksumAsset | null;
}

export interface ReleaseInfo {
  appId: string;
  repo: string;
  tagName: string;
  version: string;
  name: string;
  body: string;
  publishedAt?: string;
  htmlUrl: string;
  matchedAsset?: ReleaseAsset | null;
  checkedAt: string;
  fromCache: boolean;
}

export interface InstalledApp {
  id: string;
  version: string;
  installPath: string;
  executablePath: string;
  assetName: string;
  installedAt: string;
  sha256?: string | null;
  sha256Verified: boolean;
}

/**
 * Non-secret settings only. The GitHub PAT is stored exclusively in
 * Windows Credential Manager via the Rust `keyring` backend.
 */
export interface Settings {
  installDir: string;
  registryUrl: string;
  autoCheckUpdates: boolean;
  requireSha256: boolean;
  theme: ThemeMode;
  minimizeToTray: boolean;
}

export type DownloadStatus =
  | "downloading"
  | "verifying"
  | "extracting"
  | "installing"
  | "completed"
  | "cancelled"
  | "error";

export interface DownloadProgressEvent {
  appId: string;
  status: DownloadStatus;
  downloadedBytes: number;
  totalBytes: number;
  percentage: number;
  speedBytesPerSec: number;
  etaSeconds?: number | null;
  message?: string | null;
}

export interface AppStateSnapshot {
  registry: Registry;
  installedApps: Record<string, InstalledApp>;
  releases: Record<string, ReleaseInfo>;
  favorites: string[];
  settings: Settings;
  hasGithubToken: boolean;
  dataDir: string;
}

export interface RemoveCustomAppResult {
  registry: Registry;
  favorites: string[];
}

export interface CheckAllUpdatesResult {
  releases: Record<string, ReleaseInfo>;
  errors: Record<string, string>;
}

export interface ScoopIndexEntry {
  name: string;
  bucket: "Main" | "Extras" | string;
}

export interface ScoopSearchResult {
  items: ScoopIndexEntry[];
  totalMatches: number;
  totalIndexed: number;
  mainCount: number;
  extrasCount: number;
  updatedAt: string;
}

export interface ScoopImportResult {
  app: AppEntry;
  release: ReleaseInfo;
  registry: Registry;
}

export type SortOption =
  | "default"
  | "name-asc"
  | "name-desc"
  | "updates-first"
  | "installed-first"
  | "release-date";

export type StatusFilter = "all" | "installed" | "updates" | "not-installed";
export type SourceFilter = "all" | "catalog" | "custom" | "scoop";

export type NavView =
  | { kind: "collection" }
  | { kind: "scoop" }
  | { kind: "installed" }
  | { kind: "updates" }
  | { kind: "category"; category: string }
  | { kind: "settings" };

export interface ToastNotice {
  id: string;
  title: string;
  description?: string;
  variant?: "default" | "success" | "error";
}
