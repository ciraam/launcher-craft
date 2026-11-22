use crate::models::{AppEntry, EtagCache, PersistedState, Registry, ScoopIndex, Settings};
use crate::security;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

const BUNDLED_REGISTRY: &str = include_str!("../../public/registry.json");

pub fn app_data_dir() -> PathBuf {
    let base = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    let dir = base.join("Craft.ro");
    let _ = fs::create_dir_all(&dir);
    dir
}

pub fn default_install_dir() -> PathBuf {
    let base = dirs::data_local_dir()
        .or_else(dirs::home_dir)
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("Craft.ro").join("Apps")
}

pub fn state_file_path() -> PathBuf {
    app_data_dir().join("state.json")
}

pub fn etag_cache_path() -> PathBuf {
    app_data_dir().join("etag_cache.json")
}

pub fn scoop_index_path() -> PathBuf {
    app_data_dir().join("scoop_index.json")
}

pub fn default_settings() -> Settings {
    Settings {
        install_dir: default_install_dir().to_string_lossy().to_string(),
        registry_url: String::new(),
        auto_check_updates: true,
        require_sha256: false,
        theme: "dark".to_string(),
    }
}

pub fn validate_app_entry(app: &AppEntry) -> Result<(), String> {
    security::validate_app_id(&app.id)?;
    security::validate_repo(&app.repo)?;
    security::validate_executable_name(&app.executable_name)?;
    if let Some(ref hash) = app.sha256 {
        if !hash.trim().is_empty() && security::parse_sha256_hex(hash).is_none() {
            return Err(format!(
                "Empreinte SHA-256 invalide pour '{}'.",
                app.name
            ));
        }
    }
    Ok(())
}

pub fn load_bundled_registry() -> Result<Registry, String> {
    let mut reg = serde_json::from_str::<Registry>(BUNDLED_REGISTRY)
        .map_err(|e| format!("Impossible de lire registry.json embarqué: {e}"))?;
    reg.apps.retain(|a| validate_app_entry(a).is_ok());
    Ok(reg)
}

pub fn load_persisted_state() -> PersistedState {
    let path = state_file_path();
    if let Ok(raw) = fs::read_to_string(&path) {
        if let Ok(mut parsed) = serde_json::from_str::<PersistedState>(&raw) {
            if parsed.settings.install_dir.trim().is_empty() {
                parsed.settings.install_dir = default_install_dir().to_string_lossy().to_string();
            }
            parsed.custom_apps.retain(|a| validate_app_entry(a).is_ok());
            let mut dedup_favs = Vec::new();
            for fav in parsed.favorites {
                if security::validate_app_id(&fav).is_ok() && !dedup_favs.contains(&fav) {
                    dedup_favs.push(fav);
                }
            }
            parsed.favorites = dedup_favs;
            return parsed;
        }
    }

    PersistedState {
        settings: default_settings(),
        installed_apps: HashMap::new(),
        custom_apps: Vec::new(),
        favorites: Vec::new(),
    }
}

/// Toggles an application ID in `state.favorites` after strict ID validation.
pub fn toggle_favorite_in_state(
    state: &mut PersistedState,
    app_id: &str,
) -> Result<Vec<String>, String> {
    security::validate_app_id(app_id)?;
    if let Some(pos) = state.favorites.iter().position(|id| id == app_id) {
        state.favorites.remove(pos);
    } else {
        state.favorites.push(app_id.to_string());
    }
    Ok(state.favorites.clone())
}

/// Removes a custom app from `state.custom_apps`, `registry.apps`, and `state.favorites`,
/// refusing to remove built-in catalog apps or currently installed apps.
pub fn remove_custom_app_from_state(
    state: &mut PersistedState,
    registry: &mut Registry,
    app_id: &str,
) -> Result<(), String> {
    security::validate_app_id(app_id)?;

    if state.installed_apps.contains_key(app_id) {
        return Err(
            "Désinstallez d'abord cette application avant de la retirer du catalogue.".into(),
        );
    }

    let existed = state.custom_apps.iter().any(|a| a.id == app_id);
    if !existed {
        return Err(
            "Seuls les dépôts personnalisés ou importés peuvent être retirés du catalogue.".into(),
        );
    }

    state.custom_apps.retain(|a| a.id != app_id);
    registry.apps.retain(|a| a.id != app_id);
    state.favorites.retain(|id| id != app_id);
    Ok(())
}

pub fn save_persisted_state(state: &PersistedState) -> Result<(), String> {
    let path = state_file_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Impossible de créer le dossier de données: {e}"))?;
    }
    let json = serde_json::to_string_pretty(state)
        .map_err(|e| format!("Erreur de sérialisation de l'état: {e}"))?;
    fs::write(&path, json).map_err(|e| format!("Impossible d'écrire state.json: {e}"))
}

pub fn load_etag_cache() -> EtagCache {
    let path = etag_cache_path();
    if let Ok(raw) = fs::read_to_string(&path) {
        if let Ok(parsed) = serde_json::from_str::<EtagCache>(&raw) {
            return parsed;
        }
    }
    EtagCache::default()
}

pub fn save_etag_cache(cache: &EtagCache) -> Result<(), String> {
    let path = etag_cache_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Impossible de créer le dossier de cache: {e}"))?;
    }
    let json = serde_json::to_string_pretty(cache)
        .map_err(|e| format!("Erreur de sérialisation du cache ETag: {e}"))?;
    fs::write(&path, json).map_err(|e| format!("Impossible d'écrire etag_cache.json: {e}"))
}

pub fn load_scoop_index() -> ScoopIndex {
    let path = scoop_index_path();
    if let Ok(raw) = fs::read_to_string(&path) {
        if let Ok(parsed) = serde_json::from_str::<ScoopIndex>(&raw) {
            return parsed;
        }
    }
    ScoopIndex::default()
}

pub fn save_scoop_index(index: &ScoopIndex) -> Result<(), String> {
    let path = scoop_index_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Impossible de créer le dossier Scoop: {e}"))?;
    }
    let json = serde_json::to_string(index)
        .map_err(|e| format!("Erreur de sérialisation de scoop_index.json: {e}"))?;
    fs::write(&path, json).map_err(|e| format!("Impossible d'écrire scoop_index.json: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_app(id: &str, is_custom: bool) -> AppEntry {
        AppEntry {
            id: id.to_string(),
            name: id.to_string(),
            tagline: "Demo".to_string(),
            description: "Demo".to_string(),
            category: "Outils".to_string(),
            repo: "owner/repo".to_string(),
            icon: "custom".to_string(),
            asset_pattern: "*.zip".to_string(),
            executable_name: "demo.exe".to_string(),
            accent_color: None,
            homepage: None,
            sha256: None,
            is_custom,
            source: "github".to_string(),
            scoop_bucket: None,
            scoop_name: None,
        }
    }

    #[test]
    fn test_toggle_favorite_validation_and_persistence() {
        let mut state = PersistedState {
            settings: default_settings(),
            installed_apps: HashMap::new(),
            custom_apps: Vec::new(),
            favorites: Vec::new(),
        };

        assert!(toggle_favorite_in_state(&mut state, "../evil").is_err());
        assert!(toggle_favorite_in_state(&mut state, "INVALID_ID").is_err());

        let favs = toggle_favorite_in_state(&mut state, "localsend").unwrap();
        assert_eq!(favs, vec!["localsend"]);

        let favs = toggle_favorite_in_state(&mut state, "ripgrep").unwrap();
        assert_eq!(favs, vec!["localsend", "ripgrep"]);

        // Toggling existing favorite removes only that favorite
        let favs = toggle_favorite_in_state(&mut state, "localsend").unwrap();
        assert_eq!(favs, vec!["ripgrep"]);
    }

    #[test]
    fn test_remove_custom_app_preserves_other_apps() {
        let builtin = sample_app("localsend", false);
        let custom_a = sample_app("custom-alpha", true);
        let custom_b = sample_app("custom-beta", true);

        let mut state = PersistedState {
            settings: default_settings(),
            installed_apps: HashMap::new(),
            custom_apps: vec![custom_a.clone(), custom_b.clone()],
            favorites: vec![
                "localsend".to_string(),
                "custom-alpha".to_string(),
                "custom-beta".to_string(),
            ],
        };

        let mut registry = Registry {
            version: 1,
            updated_at: None,
            apps: vec![builtin, custom_a, custom_b],
        };

        // Built-in catalog app must not be removable
        assert!(remove_custom_app_from_state(&mut state, &mut registry, "localsend").is_err());

        // Removing custom-alpha removes it from custom_apps, registry, and favorites only
        assert!(remove_custom_app_from_state(&mut state, &mut registry, "custom-alpha").is_ok());

        assert_eq!(state.custom_apps.len(), 1);
        assert_eq!(state.custom_apps[0].id, "custom-beta");
        assert_eq!(registry.apps.len(), 2);
        assert!(registry.apps.iter().any(|a| a.id == "localsend"));
        assert!(registry.apps.iter().any(|a| a.id == "custom-beta"));
        assert_eq!(state.favorites, vec!["localsend", "custom-beta"]);
    }
}
