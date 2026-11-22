use crate::models::{
    AppEntry, CachedReleaseEntry, ChecksumAsset, Registry, ReleaseAsset, ReleaseInfo,
};
use crate::security::{self, USER_AGENT_VALUE};
use crate::storage;
use chrono::Utc;
use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, AUTHORIZATION, IF_NONE_MATCH, USER_AGENT};
use reqwest::StatusCode;
#[cfg(test)]
use semver::Version;
use serde::Deserialize;
use std::time::Duration;

#[derive(Debug, Deserialize)]
struct GhAsset {
    id: u64,
    name: String,
    size: u64,
    browser_download_url: String,
    url: String,
    content_type: Option<String>,
    #[serde(default)]
    digest: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GhRelease {
    tag_name: String,
    name: Option<String>,
    body: Option<String>,
    published_at: Option<String>,
    html_url: String,
    assets: Vec<GhAsset>,
}

/// Anti-SSRF & anti-DNS-rebinding redirect policy: max 5 hops, validating HTTPS + resolved IPs at EVERY hop.
fn safe_redirect_policy() -> reqwest::redirect::Policy {
    reqwest::redirect::Policy::custom(|attempt| {
        if attempt.previous().len() >= 5 {
            return attempt.error("Trop de redirections HTTP (maximum 5 autorisées).");
        }
        if let Err(reason) = security::validate_https_url_with_dns(attempt.url().as_str()) {
            return attempt.error(format!(
                "Redirection bloquée par sécurité (anti-SSRF): {reason}"
            ));
        }
        attempt.follow()
    })
}

/// API HTTP client with strict connect & read timeouts and per-hop anti-SSRF redirect policy.
pub fn build_api_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(USER_AGENT_VALUE)
        .redirect(safe_redirect_policy())
        .connect_timeout(Duration::from_secs(10))
        .read_timeout(Duration::from_secs(30))
        .timeout(Duration::from_secs(45))
        .build()
        .map_err(|e| format!("Impossible d'initialiser le client HTTP API: {e}"))
}

/// Streaming download HTTP client with connect & chunk-read timeouts and per-hop anti-SSRF redirect policy.
pub fn build_download_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(USER_AGENT_VALUE)
        .redirect(safe_redirect_policy())
        .connect_timeout(Duration::from_secs(15))
        .read_timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| format!("Impossible d'initialiser le client de téléchargement: {e}"))
}

fn build_github_headers(
    url: &url::Url,
    token: Option<&str>,
    etag: Option<&str>,
) -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert(USER_AGENT, HeaderValue::from_static(USER_AGENT_VALUE));
    headers.insert(
        ACCEPT,
        HeaderValue::from_static("application/vnd.github+json"),
    );

    if security::is_trusted_github_token_host(url) {
        if let Some(raw_tok) = token {
            let trimmed = raw_tok.trim();
            if !trimmed.is_empty() {
                if let Ok(val) = HeaderValue::from_str(&format!("Bearer {trimmed}")) {
                    headers.insert(AUTHORIZATION, val);
                }
            }
        }
    }

    if let Some(tag) = etag {
        if let Ok(val) = HeaderValue::from_str(tag) {
            headers.insert(IF_NONE_MATCH, val);
        }
    }

    headers
}

pub async fn fetch_remote_registry(
    client: &reqwest::Client,
    raw_url: &str,
    token: Option<&str>,
) -> Result<Registry, String> {
    let parsed_url = security::validate_https_url_with_dns_async(raw_url).await?;
    let mut req = client
        .get(parsed_url.clone())
        .header(USER_AGENT, USER_AGENT_VALUE);

    if security::is_trusted_github_token_host(&parsed_url) {
        if let Some(tok) = token {
            let trimmed = tok.trim();
            if !trimmed.is_empty() {
                req = req.header(AUTHORIZATION, format!("Bearer {trimmed}"));
            }
        }
    }

    let resp = req
        .send()
        .await
        .map_err(|e| format!("Impossible de charger le catalogue distant: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!(
            "Catalogue distant inaccessible (HTTP {})",
            resp.status().as_u16()
        ));
    }

    let mut reg = resp
        .json::<Registry>()
        .await
        .map_err(|e| format!("Format JSON du catalogue distant invalide: {e}"))?;

    reg.apps.retain(|a| storage::validate_app_entry(a).is_ok());
    Ok(reg)
}

/// Fetches the latest GitHub release without holding any lock on the ETag cache.
/// Returns `(ReleaseInfo, Option<String>)` where the second element is the new ETag (if updated).
pub async fn fetch_latest_release_unlocked(
    client: &reqwest::Client,
    app: &AppEntry,
    token: Option<&str>,
    cached: Option<&CachedReleaseEntry>,
    force_refresh: bool,
) -> Result<(ReleaseInfo, Option<String>), String> {
    security::validate_app_id(&app.id)?;
    security::validate_repo(&app.repo)?;

    let raw_url = format!("https://api.github.com/repos/{}/releases/latest", app.repo);
    let url = security::validate_https_url(&raw_url)?;

    let cached_etag = if force_refresh {
        None
    } else {
        cached.and_then(|c| c.etag.as_deref())
    };

    let headers = build_github_headers(&url, token, cached_etag);
    let response = client
        .get(url)
        .headers(headers)
        .send()
        .await
        .map_err(|e| format!("Erreur réseau GitHub pour {}: {e}", app.repo))?;

    if response.status() == StatusCode::NOT_MODIFIED {
        if let Some(entry) = cached {
            let mut info = entry.release.clone();
            info.app_id = app.id.clone();
            info.checked_at = Utc::now().to_rfc3339();
            info.from_cache = true;
            return Ok((info, entry.etag.clone()));
        }
    }

    if response.status() == StatusCode::FORBIDDEN
        || response.status() == StatusCode::TOO_MANY_REQUESTS
    {
        if let Some(entry) = cached {
            let mut info = entry.release.clone();
            info.app_id = app.id.clone();
            info.from_cache = true;
            return Ok((info, entry.etag.clone()));
        }
        return Err(
            "Limite d'appels API GitHub atteinte. Ajoutez un Personal Access Token dans les Paramètres."
                .into(),
        );
    }

    if response.status() == StatusCode::NOT_FOUND {
        return Err(format!(
            "Dépôt ou release introuvable pour {}. S'il est privé, configurez votre Token GitHub.",
            app.repo
        ));
    }

    if !response.status().is_success() {
        return Err(format!(
            "Erreur GitHub API ({}) pour {}",
            response.status().as_u16(),
            app.repo
        ));
    }

    let new_etag = response
        .headers()
        .get("etag")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    let gh: GhRelease = response
        .json()
        .await
        .map_err(|e| format!("Réponse GitHub invalide pour {}: {e}", app.repo))?;

    let matched_asset = select_matching_asset(&gh.assets, &app.asset_pattern, app.sha256.as_deref());
    let version = normalize_version(&gh.tag_name);

    let info = ReleaseInfo {
        app_id: app.id.clone(),
        repo: app.repo.clone(),
        tag_name: gh.tag_name.clone(),
        version,
        name: gh.name.filter(|s| !s.trim().is_empty()).unwrap_or(gh.tag_name),
        body: gh.body.unwrap_or_default(),
        published_at: gh.published_at,
        html_url: gh.html_url,
        matched_asset,
        checked_at: Utc::now().to_rfc3339(),
        from_cache: false,
    };

    Ok((info, new_etag))
}

fn select_matching_asset(
    assets: &[GhAsset],
    pattern: &str,
    registry_sha256: Option<&str>,
) -> Option<ReleaseAsset> {
    let pat = pattern.trim().to_lowercase();
    let found = assets
        .iter()
        .find(|a| glob_match(&pat, &a.name.to_lowercase()))
        .or_else(|| {
            assets.iter().find(|a| {
                let lower = a.name.to_lowercase();
                (lower.ends_with(".zip") || lower.ends_with(".exe") || lower.ends_with(".msi"))
                    && !lower.ends_with(".sha256")
                    && !lower.ends_with(".sha256sum")
                    && !lower.ends_with(".sig")
                    && !lower.ends_with(".blockmap")
            })
        })?;

    let safe_name = security::sanitize_asset_filename(&found.name).ok()?;

    // Priority 1: registry pinned sha256; Priority 2: GitHub Release Asset native `digest` field.
    let resolved_sha256 = registry_sha256
        .and_then(security::parse_sha256_hex)
        .or_else(|| found.digest.as_deref().and_then(security::parse_sha256_hex));

    // Priority 3: companion `.sha256` / `.sha256sum` / `SHA256SUMS` asset in the same release.
    let checksum_asset = find_checksum_asset(assets, &found.name);

    Some(ReleaseAsset {
        id: found.id,
        name: safe_name,
        size: found.size,
        browser_download_url: found.browser_download_url.clone(),
        api_url: found.url.clone(),
        content_type: found.content_type.clone(),
        sha256: resolved_sha256,
        checksum_asset,
    })
}

fn find_checksum_asset(assets: &[GhAsset], binary_name: &str) -> Option<ChecksumAsset> {
    let exact_sha256 = format!("{binary_name}.sha256").to_ascii_lowercase();
    let exact_sha256sum = format!("{binary_name}.sha256sum").to_ascii_lowercase();

    let found = assets
        .iter()
        .find(|a| {
            let lower = a.name.to_ascii_lowercase();
            lower == exact_sha256 || lower == exact_sha256sum
        })
        .or_else(|| {
            assets.iter().find(|a| {
                let lower = a.name.to_ascii_lowercase();
                lower == "sha256sums"
                    || lower == "sha256sums.txt"
                    || lower == "checksums.txt"
                    || lower.ends_with("sha256sums.txt")
            })
        })?;

    Some(ChecksumAsset {
        name: found.name.clone(),
        browser_download_url: found.browser_download_url.clone(),
        api_url: found.url.clone(),
    })
}

/// Fetches and parses a companion checksum asset over HTTPS (max 1 MB).
pub async fn fetch_checksum_sha256(
    client: &reqwest::Client,
    checksum: &ChecksumAsset,
    asset_name: &str,
    token: Option<&str>,
) -> Option<String> {
    let raw_url = if token.is_some_and(|t| !t.trim().is_empty()) && !checksum.api_url.is_empty() {
        &checksum.api_url
    } else {
        &checksum.browser_download_url
    };

    let url = security::validate_https_url_with_dns_async(raw_url).await.ok()?;
    let mut req = client
        .get(url.clone())
        .header(USER_AGENT, USER_AGENT_VALUE)
        .header(ACCEPT, "application/octet-stream");

    if security::is_trusted_github_token_host(&url) {
        if let Some(tok) = token {
            let trimmed = tok.trim();
            if !trimmed.is_empty() {
                req = req.header(AUTHORIZATION, format!("Bearer {trimmed}"));
            }
        }
    }

    let resp = req.send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    if resp.content_length().unwrap_or(0) > 1_048_576 {
        return None;
    }

    let text = resp.text().await.ok()?;
    security::extract_sha256_from_checksum_file(&text, asset_name)
}

/// Wildcard glob matcher supporting `*` and `?`.
pub fn glob_match(pattern: &str, text: &str) -> bool {
    let p: Vec<char> = pattern.chars().collect();
    let t: Vec<char> = text.chars().collect();
    let (mut pi, mut ti) = (0usize, 0usize);
    let mut star_idx: Option<usize> = None;
    let mut match_idx: usize = 0;

    while ti < t.len() {
        if pi < p.len() && (p[pi] == '?' || p[pi] == t[ti]) {
            pi += 1;
            ti += 1;
        } else if pi < p.len() && p[pi] == '*' {
            star_idx = Some(pi);
            match_idx = ti;
            pi += 1;
        } else if let Some(s) = star_idx {
            pi = s + 1;
            match_idx += 1;
            ti = match_idx;
        } else {
            return false;
        }
    }

    while pi < p.len() && p[pi] == '*' {
        pi += 1;
    }

    pi == p.len()
}

pub fn normalize_version(tag: &str) -> String {
    tag.trim().trim_start_matches(['v', 'V']).to_string()
}

#[cfg(test)]
pub fn parse_semver_tolerant(raw: &str) -> Option<Version> {
    let cleaned = normalize_version(raw);
    if let Ok(v) = Version::parse(&cleaned) {
        return Some(v);
    }

    let (core, pre) = match cleaned.split_once('-') {
        Some((c, p)) => (c, Some(p)),
        None => (cleaned.as_str(), None),
    };

    let parts: Vec<u64> = core
        .split('.')
        .filter_map(|p| p.parse::<u64>().ok())
        .collect();

    if parts.is_empty() {
        return None;
    }

    let major = parts[0];
    let minor = *parts.get(1).unwrap_or(&0);
    let patch = *parts.get(2).unwrap_or(&0);
    let normalized = match pre {
        Some(p) => format!("{major}.{minor}.{patch}-{p}"),
        None => format!("{major}.{minor}.{patch}"),
    };

    Version::parse(&normalized).ok()
}

#[cfg(test)]
pub fn is_update_available(installed: &str, latest: &str) -> bool {
    match (parse_semver_tolerant(installed), parse_semver_tolerant(latest)) {
        (Some(a), Some(b)) => b > a,
        _ => normalize_version(installed) != normalize_version(latest),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_glob_match() {
        assert!(glob_match(
            "*windows-x86-64.zip",
            "localsend-1.18.2-windows-x86-64.zip"
        ));
        assert!(!glob_match(
            "*windows-x86-64.zip",
            "localsend-1.18.2-windows-arm-64.zip"
        ));
        assert!(glob_match("*setup*.exe", "myapp-1.0-setup-x64.exe"));
        assert!(glob_match("*portable.zip", "flow-launcher-portable.zip"));
    }

    #[test]
    fn test_semver_comparison() {
        assert!(is_update_available("1.17.0", "v1.18.2"));
        assert!(!is_update_available("v1.18.2", "1.18.2"));
        assert!(!is_update_available("2.0.0", "1.9.9"));
        assert!(is_update_available("2.43", "2.43.2"));
    }
}
