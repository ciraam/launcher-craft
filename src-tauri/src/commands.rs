use crate::github;
use crate::installer;
use crate::models::{
    AppEntry, AppStateSnapshot, CachedReleaseEntry, CheckAllUpdatesResult, EtagCache,
    InstalledApp, PersistedState, Registry, ReleaseInfo, RemoveCustomAppResult, ScoopImportResult,
    ScoopIndex, ScoopSearchResult, Settings,
};
use crate::scoop;
use crate::security;
use crate::storage;
use futures_util::stream::{self, StreamExt};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, State};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

pub struct LauncherState {
    pub api_http: reqwest::Client,
    pub download_http: reqwest::Client,
    pub persisted: Mutex<PersistedState>,
    pub registry: Mutex<Registry>,
    pub etag_cache: Mutex<EtagCache>,
    pub scoop_index: Mutex<ScoopIndex>,
    pub active_downloads: Mutex<HashMap<String, CancellationToken>>,
}

fn cache_key_for_app(app: &AppEntry) -> String {
    if app.source == "scoop" {
        let bucket = app.scoop_bucket.as_deref().unwrap_or("Main");
        let name = app.scoop_name.as_deref().unwrap_or(&app.id);
        format!("scoop:{bucket}/{name}")
    } else {
        app.repo.clone()
    }
}

async fn fetch_release_for_app(
    client: &reqwest::Client,
    app: &AppEntry,
    token: Option<&str>,
    cached: Option<&CachedReleaseEntry>,
    force_refresh: bool,
) -> Result<(ReleaseInfo, Option<String>), String> {
    if app.source == "scoop" {
        let bucket = app
            .scoop_bucket
            .as_deref()
            .ok_or_else(|| format!("Bucket Scoop manquant pour {}", app.name))?;
        let name = app
            .scoop_name
            .as_deref()
            .ok_or_else(|| format!("Nom Scoop manquant pour {}", app.name))?;
        let (_, mut rel) = scoop::fetch_scoop_manifest(client, bucket, name, token).await?;
        rel.app_id = app.id.clone();
        Ok((rel, None))
    } else {
        github::fetch_latest_release_unlocked(client, app, token, cached, force_refresh).await
    }
}

impl LauncherState {
    pub fn initialize() -> Result<Self, String> {
        let api_http = github::build_api_client()?;
        let download_http = github::build_download_client()?;
        let persisted = storage::load_persisted_state();
        let mut registry = storage::load_bundled_registry()?;
        let etag_cache = storage::load_etag_cache();
        let scoop_index = storage::load_scoop_index();

        for custom in &persisted.custom_apps {
            if !registry.apps.iter().any(|a| a.id == custom.id) {
                registry.apps.push(custom.clone());
            }
        }

        Ok(Self {
            api_http,
            download_http,
            persisted: Mutex::new(persisted),
            registry: Mutex::new(registry),
            etag_cache: Mutex::new(etag_cache),
            scoop_index: Mutex::new(scoop_index),
            active_downloads: Mutex::new(HashMap::new()),
        })
    }
}

#[tauri::command]
pub async fn get_app_state(
    state: State<'_, Arc<LauncherState>>,
) -> Result<AppStateSnapshot, String> {
    let persisted = state.persisted.lock().await;
    let registry = state.registry.lock().await;
    let cache = state.etag_cache.lock().await;

    let mut releases = HashMap::new();
    for app in &registry.apps {
        let key = cache_key_for_app(app);
        if let Some(entry) = cache.entries.get(&key) {
            let mut rel = entry.release.clone();
            rel.app_id = app.id.clone();
            releases.insert(app.id.clone(), rel);
        }
    }

    Ok(AppStateSnapshot {
        registry: registry.clone(),
        installed_apps: persisted.installed_apps.clone(),
        releases,
        favorites: persisted.favorites.clone(),
        settings: persisted.settings.clone(),
        has_github_token: security::has_github_token(),
        data_dir: storage::app_data_dir().to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub async fn refresh_registry(state: State<'_, Arc<LauncherState>>) -> Result<Registry, String> {
    let (remote_url, custom_apps) = {
        let p = state.persisted.lock().await;
        (p.settings.registry_url.clone(), p.custom_apps.clone())
    };
    let token = security::load_github_token();

    let mut reg = if !remote_url.trim().is_empty() {
        github::fetch_remote_registry(&state.api_http, remote_url.trim(), token.as_deref()).await?
    } else {
        storage::load_bundled_registry()?
    };

    for custom in custom_apps {
        if !reg.apps.iter().any(|a| a.id == custom.id) {
            reg.apps.push(custom);
        }
    }

    let mut guard = state.registry.lock().await;
    *guard = reg.clone();
    Ok(reg)
}

#[tauri::command]
pub async fn check_release(
    state: State<'_, Arc<LauncherState>>,
    app_id: String,
    force: Option<bool>,
) -> Result<ReleaseInfo, String> {
    security::validate_app_id(&app_id)?;

    let app_entry = {
        let reg = state.registry.lock().await;
        reg.apps
            .iter()
            .find(|a| a.id == app_id)
            .cloned()
            .ok_or_else(|| format!("Application inconnue: {app_id}"))?
    };

    let key = cache_key_for_app(&app_entry);

    // Snapshot cache entry and release the Mutex BEFORE performing the HTTP call.
    let cached_entry = {
        let cache = state.etag_cache.lock().await;
        cache.entries.get(&key).cloned()
    };

    let token = security::load_github_token();
    let (info, new_etag) = fetch_release_for_app(
        &state.api_http,
        &app_entry,
        token.as_deref(),
        cached_entry.as_ref(),
        force.unwrap_or(false),
    )
    .await?;

    {
        let mut cache = state.etag_cache.lock().await;
        cache.entries.insert(
            key,
            CachedReleaseEntry {
                etag: new_etag,
                release: info.clone(),
            },
        );
        let _ = storage::save_etag_cache(&cache);
    }

    Ok(info)
}

#[tauri::command]
pub async fn check_all_updates(
    state: State<'_, Arc<LauncherState>>,
    force: Option<bool>,
) -> Result<CheckAllUpdatesResult, String> {
    let apps = {
        let reg = state.registry.lock().await;
        reg.apps.clone()
    };

    // Snapshot existing cache entries and release lock before concurrent HTTP requests.
    let cache_snapshot: HashMap<String, CachedReleaseEntry> = {
        let cache = state.etag_cache.lock().await;
        cache.entries.clone()
    };

    let token = Arc::new(security::load_github_token());
    let force_flag = force.unwrap_or(false);
    let client = state.api_http.clone();

    let fetched = stream::iter(apps.into_iter().map(|app| {
        let client = client.clone();
        let token = Arc::clone(&token);
        let key = cache_key_for_app(&app);
        let cached = cache_snapshot.get(&key).cloned();
        async move {
            let res = fetch_release_for_app(
                &client,
                &app,
                token.as_deref(),
                cached.as_ref(),
                force_flag,
            )
            .await;
            (app, key, res)
        }
    }))
    .buffer_unordered(4)
    .collect::<Vec<_>>()
    .await;

    let mut releases = HashMap::new();
    let mut errors = HashMap::new();

    {
        let mut cache = state.etag_cache.lock().await;
        for (app, key, outcome) in fetched {
            match outcome {
                Ok((info, new_etag)) => {
                    cache.entries.insert(
                        key,
                        CachedReleaseEntry {
                            etag: new_etag,
                            release: info.clone(),
                        },
                    );
                    releases.insert(app.id, info);
                }
                Err(err) => {
                    errors.insert(app.id, err);
                }
            }
        }
        let _ = storage::save_etag_cache(&cache);
    }

    Ok(CheckAllUpdatesResult { releases, errors })
}

#[tauri::command]
pub async fn install_or_update_app(
    app_handle: AppHandle,
    state: State<'_, Arc<LauncherState>>,
    app_id: String,
) -> Result<InstalledApp, String> {
    security::validate_app_id(&app_id)?;

    let app_entry = {
        let reg = state.registry.lock().await;
        reg.apps
            .iter()
            .find(|a| a.id == app_id)
            .cloned()
            .ok_or_else(|| format!("Application introuvable: {app_id}"))?
    };

    let (install_dir, require_sha256, existing_executable) = {
        let p = state.persisted.lock().await;
        (
            PathBuf::from(&p.settings.install_dir),
            p.settings.require_sha256,
            p.installed_apps
                .get(&app_id)
                .map(|a| PathBuf::from(&a.executable_path)),
        )
    };
    let token = security::load_github_token();
    let key = cache_key_for_app(&app_entry);

    // Release ETag cache lock before HTTP fetch.
    let cached_entry = {
        let cache = state.etag_cache.lock().await;
        cache.entries.get(&key).cloned()
    };

    let (release, new_etag) = fetch_release_for_app(
        &state.api_http,
        &app_entry,
        token.as_deref(),
        cached_entry.as_ref(),
        false,
    )
    .await?;

    {
        let mut cache = state.etag_cache.lock().await;
        cache.entries.insert(
            key,
            CachedReleaseEntry {
                etag: new_etag,
                release: release.clone(),
            },
        );
        let _ = storage::save_etag_cache(&cache);
    }

    let cancel_token = CancellationToken::new();
    {
        let mut active = state.active_downloads.lock().await;
        if let Some(prev) = active.insert(app_id.clone(), cancel_token.clone()) {
            prev.cancel();
        }
    }

    // Scoop downloads come from third-party hosts; never pass GitHub PAT to Scoop binary downloads.
    let download_token = if app_entry.source == "scoop" {
        None
    } else {
        token
    };

    let result = installer::download_and_install(
        app_handle,
        state.api_http.clone(),
        state.download_http.clone(),
        app_entry,
        release,
        install_dir,
        existing_executable,
        download_token,
        require_sha256,
        cancel_token,
    )
    .await;

    {
        let mut active = state.active_downloads.lock().await;
        active.remove(&app_id);
    }

    let installed = result?;

    {
        let mut persisted = state.persisted.lock().await;
        persisted
            .installed_apps
            .insert(app_id.clone(), installed.clone());
        storage::save_persisted_state(&persisted)?;
    }

    Ok(installed)
}

#[tauri::command]
pub async fn cancel_download(
    state: State<'_, Arc<LauncherState>>,
    app_id: String,
) -> Result<bool, String> {
    security::validate_app_id(&app_id)?;
    let mut active = state.active_downloads.lock().await;
    if let Some(token) = active.remove(&app_id) {
        token.cancel();
        Ok(true)
    } else {
        Ok(false)
    }
}

#[tauri::command]
pub async fn launch_app(
    state: State<'_, Arc<LauncherState>>,
    app_id: String,
) -> Result<(), String> {
    security::validate_app_id(&app_id)?;
    let (installed, install_root) = {
        let persisted = state.persisted.lock().await;
        let inst = persisted
            .installed_apps
            .get(&app_id)
            .cloned()
            .ok_or_else(|| "Cette application n'est pas installée".to_string())?;
        (inst, PathBuf::from(&persisted.settings.install_dir))
    };

    installer::launch_executable(
        &installed.executable_path,
        &installed.install_path,
        &install_root,
    )
}

#[tauri::command]
pub async fn open_install_folder(
    state: State<'_, Arc<LauncherState>>,
    app_id: String,
) -> Result<(), String> {
    security::validate_app_id(&app_id)?;
    let (install_path, install_root) = {
        let persisted = state.persisted.lock().await;
        let path = persisted
            .installed_apps
            .get(&app_id)
            .map(|a| a.install_path.clone())
            .ok_or_else(|| "Dossier d'installation introuvable".to_string())?;
        (path, PathBuf::from(&persisted.settings.install_dir))
    };

    installer::open_folder_in_explorer(&install_path, &install_root)
}

#[tauri::command]
pub async fn uninstall_app(
    state: State<'_, Arc<LauncherState>>,
    app_id: String,
) -> Result<(), String> {
    security::validate_app_id(&app_id)?;
    let (installed_info, install_root) = {
        let persisted = state.persisted.lock().await;
        (
            persisted
                .installed_apps
                .get(&app_id)
                .map(|a| (a.install_path.clone(), a.executable_path.clone())),
            PathBuf::from(&persisted.settings.install_dir),
        )
    };

    if let Some((path, exe_path)) = installed_info {
        installer::uninstall_directory(&path, Some(&exe_path), &install_root)?;
    }

    let mut persisted = state.persisted.lock().await;
    persisted.installed_apps.remove(&app_id);
    storage::save_persisted_state(&persisted)?;
    Ok(())
}

#[tauri::command]
pub async fn save_settings(
    state: State<'_, Arc<LauncherState>>,
    settings: Settings,
) -> Result<Settings, String> {
    if !settings.registry_url.trim().is_empty() {
        security::validate_https_url(&settings.registry_url)?;
    }
    if settings.install_dir.trim().is_empty() {
        return Err("Le dossier d'installation ne peut pas être vide.".into());
    }
    if !matches!(settings.theme.as_str(), "dark" | "light" | "system") {
        return Err(format!("Thème invalide : '{}'.", settings.theme));
    }

    let mut persisted = state.persisted.lock().await;
    persisted.settings = settings.clone();
    storage::save_persisted_state(&persisted)?;
    Ok(settings)
}

#[tauri::command]
pub async fn set_github_token(token: String) -> Result<bool, String> {
    security::store_github_token(&token)
}

#[tauri::command]
pub async fn clear_github_token() -> Result<bool, String> {
    security::delete_github_token()?;
    Ok(false)
}

#[tauri::command]
pub async fn add_custom_app(
    state: State<'_, Arc<LauncherState>>,
    mut app: AppEntry,
) -> Result<Registry, String> {
    storage::validate_app_entry(&app)?;
    app.is_custom = true;
    {
        let mut persisted = state.persisted.lock().await;
        persisted.custom_apps.retain(|a| a.id != app.id);
        persisted.custom_apps.push(app.clone());
        storage::save_persisted_state(&persisted)?;
    }
    {
        let mut reg = state.registry.lock().await;
        reg.apps.retain(|a| a.id != app.id);
        reg.apps.push(app);
        Ok(reg.clone())
    }
}

#[tauri::command]
pub async fn toggle_favorite(
    state: State<'_, Arc<LauncherState>>,
    app_id: String,
) -> Result<Vec<String>, String> {
    let mut persisted = state.persisted.lock().await;
    let updated = storage::toggle_favorite_in_state(&mut persisted, &app_id)?;
    storage::save_persisted_state(&persisted)?;
    Ok(updated)
}

#[tauri::command]
pub async fn remove_custom_app(
    state: State<'_, Arc<LauncherState>>,
    app_id: String,
) -> Result<RemoveCustomAppResult, String> {
    let mut persisted = state.persisted.lock().await;
    let mut reg = state.registry.lock().await;
    storage::remove_custom_app_from_state(&mut persisted, &mut reg, &app_id)?;
    storage::save_persisted_state(&persisted)?;
    Ok(RemoveCustomAppResult {
        registry: reg.clone(),
        favorites: persisted.favorites.clone(),
    })
}

// ---------- Scoop Catalog Commands ----------

#[tauri::command]
pub async fn sync_scoop_index(
    state: State<'_, Arc<LauncherState>>,
    force: Option<bool>,
) -> Result<ScoopSearchResult, String> {
    let should_fetch = {
        let existing = state.scoop_index.lock().await;
        force.unwrap_or(false) || existing.entries.is_empty()
    };

    if should_fetch {
        let token = security::load_github_token();
        let fresh = scoop::fetch_scoop_index(&state.api_http, token.as_deref()).await?;
        let _ = storage::save_scoop_index(&fresh);
        let mut guard = state.scoop_index.lock().await;
        *guard = fresh;
    }

    let index = state.scoop_index.lock().await;
    Ok(scoop::search_scoop_index(&index, "", None, 60))
}

#[tauri::command]
pub async fn search_scoop_apps(
    state: State<'_, Arc<LauncherState>>,
    query: String,
    bucket: Option<String>,
    limit: Option<usize>,
) -> Result<ScoopSearchResult, String> {
    if let Some(ref b) = bucket {
        let trimmed = b.trim();
        if !trimmed.is_empty()
            && !trimmed.eq_ignore_ascii_case("all")
            && !trimmed.eq_ignore_ascii_case("tous")
        {
            scoop::validate_scoop_bucket(trimmed)?;
        }
    }

    let index = state.scoop_index.lock().await;
    Ok(scoop::search_scoop_index(
        &index,
        &query,
        bucket.as_deref(),
        limit.unwrap_or(60),
    ))
}

#[tauri::command]
pub async fn import_scoop_app(
    state: State<'_, Arc<LauncherState>>,
    bucket: String,
    name: String,
) -> Result<ScoopImportResult, String> {
    let token = security::load_github_token();
    let (app, release) =
        scoop::fetch_scoop_manifest(&state.api_http, &bucket, &name, token.as_deref()).await?;
    storage::validate_app_entry(&app)?;

    let key = cache_key_for_app(&app);
    {
        let mut cache = state.etag_cache.lock().await;
        cache.entries.insert(
            key,
            CachedReleaseEntry {
                etag: None,
                release: release.clone(),
            },
        );
        let _ = storage::save_etag_cache(&cache);
    }

    {
        let mut persisted = state.persisted.lock().await;
        persisted.custom_apps.retain(|a| a.id != app.id);
        persisted.custom_apps.push(app.clone());
        storage::save_persisted_state(&persisted)?;
    }

    let registry = {
        let mut reg = state.registry.lock().await;
        reg.apps.retain(|a| a.id != app.id);
        reg.apps.push(app.clone());
        reg.clone()
    };

    Ok(ScoopImportResult {
        app,
        release,
        registry,
    })
}
