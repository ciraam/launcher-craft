use serde::{Deserialize, Serialize};
use std::collections::HashMap;

fn default_source() -> String {
    "github".to_string()
}

fn default_theme() -> String {
    "dark".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppEntry {
    pub id: String,
    pub name: String,
    pub tagline: String,
    pub description: String,
    pub category: String,
    pub repo: String,
    pub icon: String,
    pub asset_pattern: String,
    pub executable_name: String,
    #[serde(default)]
    pub accent_color: Option<String>,
    #[serde(default)]
    pub homepage: Option<String>,
    #[serde(default)]
    pub sha256: Option<String>,
    #[serde(default)]
    pub is_custom: bool,
    #[serde(default = "default_source")]
    pub source: String, // "github" | "scoop"
    #[serde(default)]
    pub scoop_bucket: Option<String>,
    #[serde(default)]
    pub scoop_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Registry {
    pub version: u32,
    #[serde(default)]
    pub updated_at: Option<String>,
    pub apps: Vec<AppEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChecksumAsset {
    pub name: String,
    pub browser_download_url: String,
    pub api_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseAsset {
    pub id: u64,
    pub name: String,
    pub size: u64,
    pub browser_download_url: String,
    pub api_url: String,
    #[serde(default)]
    pub content_type: Option<String>,
    #[serde(default)]
    pub sha256: Option<String>,
    #[serde(default)]
    pub checksum_asset: Option<ChecksumAsset>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseInfo {
    pub app_id: String,
    pub repo: String,
    pub tag_name: String,
    pub version: String,
    pub name: String,
    pub body: String,
    pub published_at: Option<String>,
    pub html_url: String,
    pub matched_asset: Option<ReleaseAsset>,
    pub checked_at: String,
    pub from_cache: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledApp {
    pub id: String,
    pub version: String,
    pub install_path: String,
    pub executable_path: String,
    pub asset_name: String,
    pub installed_at: String,
    #[serde(default)]
    pub sha256: Option<String>,
    #[serde(default)]
    pub sha256_verified: bool,
}

/// Non-secret user settings persisted to `%APPDATA%\Craft.ro\state.json`.
/// GitHub PAT is NEVER stored here — it lives exclusively in Windows Credential Manager.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub install_dir: String,
    pub registry_url: String,
    pub auto_check_updates: bool,
    #[serde(default)]
    pub require_sha256: bool,
    #[serde(default = "default_theme")]
    pub theme: String, // "dark" | "light" | "system"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedState {
    pub settings: Settings,
    #[serde(default)]
    pub installed_apps: HashMap<String, InstalledApp>,
    #[serde(default)]
    pub custom_apps: Vec<AppEntry>,
    #[serde(default)]
    pub favorites: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedReleaseEntry {
    pub etag: Option<String>,
    pub release: ReleaseInfo,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct EtagCache {
    pub entries: HashMap<String, CachedReleaseEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgressEvent {
    pub app_id: String,
    pub status: String, // "downloading" | "verifying" | "extracting" | "installing" | "completed" | "cancelled" | "error"
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub percentage: f64,
    pub speed_bytes_per_sec: f64,
    pub eta_seconds: Option<u64>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppStateSnapshot {
    pub registry: Registry,
    pub installed_apps: HashMap<String, InstalledApp>,
    pub releases: HashMap<String, ReleaseInfo>,
    pub favorites: Vec<String>,
    pub settings: Settings,
    pub has_github_token: bool,
    pub data_dir: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveCustomAppResult {
    pub registry: Registry,
    pub favorites: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckAllUpdatesResult {
    pub releases: HashMap<String, ReleaseInfo>,
    pub errors: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScoopIndexEntry {
    pub name: String,
    pub bucket: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ScoopIndex {
    pub updated_at: String,
    pub main_count: usize,
    pub extras_count: usize,
    pub entries: Vec<ScoopIndexEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScoopSearchResult {
    pub items: Vec<ScoopIndexEntry>,
    pub total_matches: usize,
    pub total_indexed: usize,
    pub main_count: usize,
    pub extras_count: usize,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScoopImportResult {
    pub app: AppEntry,
    pub release: ReleaseInfo,
    pub registry: Registry,
}
