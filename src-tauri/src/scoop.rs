use crate::models::{
    AppEntry, ReleaseAsset, ReleaseInfo, ScoopIndex, ScoopIndexEntry, ScoopSearchResult,
};
use crate::security::{self, USER_AGENT_VALUE};
use chrono::Utc;
use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, AUTHORIZATION, USER_AGENT};
use serde::Deserialize;
use serde_json::Value;

const ALLOWED_SCOOP_BUCKETS: &[&str] = &["Main", "Extras"];

#[derive(Debug, Deserialize)]
struct GitTreeEntry {
    path: String,
    #[serde(rename = "type")]
    kind: String,
}

#[derive(Debug, Deserialize)]
struct GitTreeResponse {
    tree: Vec<GitTreeEntry>,
}

/// Strictly validates Scoop bucket against the allowlist (`Main`, `Extras`).
pub fn validate_scoop_bucket(bucket: &str) -> Result<&'static str, String> {
    let trimmed = bucket.trim();
    for &allowed in ALLOWED_SCOOP_BUCKETS {
        if trimmed.eq_ignore_ascii_case(allowed) {
            return Ok(allowed);
        }
    }
    Err(format!(
        "Bucket Scoop non autorisé '{bucket}'. Seuls Main et Extras sont autorisés."
    ))
}

/// Strictly validates Scoop app name against `^[a-zA-Z0-9_.-]+$` with no path traversal.
pub fn validate_scoop_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty()
        || trimmed.len() > 100
        || trimmed == "."
        || trimmed == ".."
        || trimmed.contains("..")
        || !trimmed
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'.' || b == b'-')
    {
        return Err(format!(
            "Nom d'application Scoop invalide '{name}' : seuls A-Z, a-z, 0-9, '_', '.' et '-' sont autorisés."
        ));
    }
    Ok(trimmed.to_string())
}

/// Converts a Scoop manifest name into a valid Craft.ro `app.id` (`^[a-z0-9-]+$`).
pub fn scoop_app_id(bucket: &str, name: &str) -> String {
    let bucket_slug = bucket.to_ascii_lowercase();
    let mut name_slug = String::new();
    let mut prev_dash = false;
    for ch in name.chars() {
        if ch.is_ascii_alphanumeric() {
            name_slug.push(ch.to_ascii_lowercase());
            prev_dash = false;
        } else if !prev_dash {
            name_slug.push('-');
            prev_dash = true;
        }
    }
    let clean = name_slug.trim_matches('-');
    let full = format!("scoop-{bucket_slug}-{clean}");
    let truncated: String = full.chars().take(64).collect();
    truncated.trim_end_matches('-').to_string()
}

fn build_github_api_headers(url: &url::Url, token: Option<&str>) -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert(USER_AGENT, HeaderValue::from_static(USER_AGENT_VALUE));
    headers.insert(
        ACCEPT,
        HeaderValue::from_static("application/vnd.github+json"),
    );

    if security::is_trusted_github_token_host(url) {
        if let Some(raw) = token {
            let trimmed = raw.trim();
            if !trimmed.is_empty() {
                if let Ok(val) = HeaderValue::from_str(&format!("Bearer {trimmed}")) {
                    headers.insert(AUTHORIZATION, val);
                }
            }
        }
    }

    headers
}

/// Fetches the complete manifest index of `ScoopInstaller/Main` and `ScoopInstaller/Extras`
/// using only 1 GitHub API request per bucket (`git/trees/master?recursive=1`).
pub async fn fetch_scoop_index(
    client: &reqwest::Client,
    token: Option<&str>,
) -> Result<ScoopIndex, String> {
    let mut entries = Vec::new();
    let mut main_count = 0usize;
    let mut extras_count = 0usize;

    for &bucket in ALLOWED_SCOOP_BUCKETS {
        let raw_url = format!(
            "https://api.github.com/repos/ScoopInstaller/{bucket}/git/trees/master?recursive=1"
        );
        let url = security::validate_https_url_with_dns_async(&raw_url).await?;
        let headers = build_github_api_headers(&url, token);

        let resp = client
            .get(url)
            .headers(headers)
            .send()
            .await
            .map_err(|e| format!("Erreur réseau lors de la synchronisation Scoop ({bucket}): {e}"))?;

        if !resp.status().is_success() {
            return Err(format!(
                "Impossible de synchroniser le bucket Scoop {bucket} (HTTP {}).",
                resp.status().as_u16()
            ));
        }

        let tree_resp: GitTreeResponse = resp
            .json()
            .await
            .map_err(|e| format!("Arborescence Scoop invalide ({bucket}): {e}"))?;

        for item in tree_resp.tree {
            if item.kind != "blob" {
                continue;
            }
            let Some(rest) = item.path.strip_prefix("bucket/") else {
                continue;
            };
            let Some(stem) = rest.strip_suffix(".json") else {
                continue;
            };
            // Ignore nested subdirectories inside bucket/
            if stem.contains('/') || validate_scoop_name(stem).is_err() {
                continue;
            }

            if bucket == "Main" {
                main_count += 1;
            } else {
                extras_count += 1;
            }

            entries.push(ScoopIndexEntry {
                name: stem.to_string(),
                bucket: bucket.to_string(),
            });
        }
    }

    entries.sort_by(|a, b| {
        a.name
            .to_ascii_lowercase()
            .cmp(&b.name.to_ascii_lowercase())
            .then_with(|| a.bucket.cmp(&b.bucket))
    });

    Ok(ScoopIndex {
        updated_at: Utc::now().to_rfc3339(),
        main_count,
        extras_count,
        entries,
    })
}

/// Instant local search across the cached Scoop index with exact > prefix > substring ranking.
pub fn search_scoop_index(
    index: &ScoopIndex,
    query: &str,
    bucket_filter: Option<&str>,
    limit: usize,
) -> ScoopSearchResult {
    let q = query.trim().to_ascii_lowercase();
    let bucket_norm = bucket_filter
        .map(|b| b.trim())
        .filter(|b| !b.is_empty() && !b.eq_ignore_ascii_case("all") && !b.eq_ignore_ascii_case("tous"));

    let mut exact = Vec::new();
    let mut prefix = Vec::new();
    let mut contains = Vec::new();

    for entry in &index.entries {
        if let Some(b) = bucket_norm {
            if !entry.bucket.eq_ignore_ascii_case(b) {
                continue;
            }
        }
        if q.is_empty() {
            prefix.push(entry.clone());
            continue;
        }
        let lower = entry.name.to_ascii_lowercase();
        if lower == q {
            exact.push(entry.clone());
        } else if lower.starts_with(&q) {
            prefix.push(entry.clone());
        } else if lower.contains(&q) {
            contains.push(entry.clone());
        }
    }

    let total_matches = exact.len() + prefix.len() + contains.len();
    let cap = limit.clamp(1, 200);
    let mut items = Vec::with_capacity(cap.min(total_matches));
    for group in [exact, prefix, contains] {
        for item in group {
            if items.len() >= cap {
                break;
            }
            items.push(item);
        }
    }

    ScoopSearchResult {
        items,
        total_matches,
        total_indexed: index.entries.len(),
        main_count: index.main_count,
        extras_count: index.extras_count,
        updated_at: index.updated_at.clone(),
    }
}

#[derive(Debug, Clone)]
pub struct ParsedScoopManifest {
    pub version: String,
    pub description: String,
    pub homepage: Option<String>,
    pub download_url: String,
    pub asset_name: String,
    pub sha256: Option<String>,
    pub executable_name: String,
}

fn value_to_string_list(val: Option<&Value>) -> Vec<String> {
    match val {
        Some(Value::String(s)) => vec![s.clone()],
        Some(Value::Array(arr)) => arr
            .iter()
            .filter_map(|v| v.as_str().map(|s| s.to_string()))
            .collect(),
        _ => Vec::new(),
    }
}

fn extract_bin_executable(val: Option<&Value>) -> Option<String> {
    let raw_candidate = match val {
        Some(Value::String(s)) => Some(s.as_str()),
        Some(Value::Array(arr)) => arr.iter().find_map(|item| match item {
            Value::String(s) => Some(s.as_str()),
            Value::Array(inner) => inner.first().and_then(|v| v.as_str()),
            _ => None,
        }),
        _ => None,
    }?;

    let leaf = raw_candidate.rsplit(['/', '\\']).next().unwrap_or(raw_candidate).trim();
    security::sanitize_asset_filename(leaf).ok()
}

/// Strips Scoop `#/custom_name.ext` download fragment and resolves `(clean_url, safe_filename)`.
fn parse_scoop_url_and_filename(raw_url: &str, fallback_stem: &str) -> Result<(String, String), String> {
    let trimmed = raw_url.trim();
    let (clean_url, fragment) = match trimmed.split_once('#') {
        Some((u, frag)) => (u.trim(), Some(frag.trim())),
        None => (trimmed, None),
    };

    let parsed = security::validate_https_url(clean_url)?;

    let frag_name = fragment
        .and_then(|f| f.strip_prefix('/'))
        .and_then(|f| security::sanitize_asset_filename(f).ok());

    let path_name = parsed
        .path_segments()
        .and_then(|mut s| s.next_back())
        .and_then(|seg| security::sanitize_asset_filename(seg).ok());

    let asset_name = frag_name
        .or(path_name)
        .unwrap_or_else(|| format!("{fallback_stem}.zip"));

    Ok((clean_url.to_string(), asset_name))
}

/// Parses a Scoop JSON manifest preferring `architecture.64bit` over root fields.
pub fn parse_scoop_manifest(name: &str, manifest: &Value) -> Result<ParsedScoopManifest, String> {
    let version = manifest
        .get("version")
        .and_then(|v| v.as_str())
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| format!("Champ 'version' absent dans le manifeste Scoop '{name}'."))?
        .to_string();

    let description = manifest
        .get("description")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| format!("Application Windows du catalogue Scoop ({name})"));

    let homepage = manifest
        .get("homepage")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| s.starts_with("https://") || s.starts_with("http://"));

    let arch64 = manifest
        .get("architecture")
        .and_then(|a| a.get("64bit"));

    let urls_64 = value_to_string_list(arch64.and_then(|a| a.get("url")));
    let hashes_64 = value_to_string_list(arch64.and_then(|a| a.get("hash")));

    let (urls, hashes) = if !urls_64.is_empty() {
        (urls_64, hashes_64)
    } else {
        (
            value_to_string_list(manifest.get("url")),
            value_to_string_list(manifest.get("hash")),
        )
    };

    if urls.is_empty() {
        return Err(format!(
            "Aucune URL de téléchargement compatible 64-bit trouvée dans '{name}'."
        ));
    }

    // Prefer a Windows archive/installer URL (.zip, .exe, .msi), otherwise index 0.
    let selected_idx = urls
        .iter()
        .position(|u| {
            let l = u.to_ascii_lowercase();
            l.contains(".zip") || l.contains(".exe") || l.contains(".msi")
        })
        .unwrap_or(0);

    let raw_url = &urls[selected_idx];
    let (download_url, asset_name) = parse_scoop_url_and_filename(raw_url, name)?;

    // Scoop hashes without prefix are SHA-256; reject md5:/sha1:/sha512: cleanly.
    let raw_hash = hashes.get(selected_idx).or_else(|| hashes.first());
    let sha256 = raw_hash.and_then(|h| {
        let lower = h.trim().to_ascii_lowercase();
        if lower.starts_with("md5:") || lower.starts_with("sha1:") || lower.starts_with("sha512:") {
            None
        } else {
            security::parse_sha256_hex(h)
        }
    });

    let bin_exe = extract_bin_executable(arch64.and_then(|a| a.get("bin")))
        .or_else(|| extract_bin_executable(manifest.get("bin")));

    let executable_name = bin_exe
        .or_else(|| {
            if asset_name.to_ascii_lowercase().ends_with(".exe") {
                Some(asset_name.clone())
            } else {
                None
            }
        })
        .unwrap_or_else(|| format!("{name}.exe"));

    security::validate_executable_name(&executable_name)?;

    Ok(ParsedScoopManifest {
        version,
        description,
        homepage,
        download_url,
        asset_name,
        sha256,
        executable_name,
    })
}

/// Fetches and validates a Scoop manifest from `raw.githubusercontent.com/ScoopInstaller/{bucket}/master/bucket/{name}.json`.
pub async fn fetch_scoop_manifest(
    client: &reqwest::Client,
    bucket: &str,
    name: &str,
    token: Option<&str>,
) -> Result<(AppEntry, ReleaseInfo), String> {
    let valid_bucket = validate_scoop_bucket(bucket)?;
    let valid_name = validate_scoop_name(name)?;

    let manifest_raw_url = format!(
        "https://raw.githubusercontent.com/ScoopInstaller/{valid_bucket}/master/bucket/{valid_name}.json"
    );
    let manifest_url = security::validate_https_url_with_dns_async(&manifest_raw_url).await?;

    let mut req = client
        .get(manifest_url.clone())
        .header(USER_AGENT, USER_AGENT_VALUE);
    if security::is_trusted_github_token_host(&manifest_url) {
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
        .map_err(|e| format!("Impossible de lire le manifeste Scoop '{valid_name}': {e}"))?;

    if !resp.status().is_success() {
        return Err(format!(
            "Manifeste Scoop '{valid_name}' introuvable dans {valid_bucket} (HTTP {}).",
            resp.status().as_u16()
        ));
    }

    let json: Value = resp
        .json()
        .await
        .map_err(|e| format!("JSON Scoop invalide pour '{valid_name}': {e}"))?;

    let parsed = parse_scoop_manifest(&valid_name, &json)?;

    // Validate the download target URL with DNS rebinding protection BEFORE returning it!
    let _ = security::validate_https_url_with_dns_async(&parsed.download_url).await?;

    let app_id = scoop_app_id(valid_bucket, &valid_name);
    security::validate_app_id(&app_id)?;

    let category = if valid_bucket == "Main" {
        "Dev".to_string()
    } else {
        "Utilitaires".to_string()
    };

    let accent = if valid_bucket == "Main" {
        "#38BDF8".to_string()
    } else {
        "#A78BFA".to_string()
    };

    let display_name = prettify_scoop_name(&valid_name);
    let repo = format!("ScoopInstaller/{valid_bucket}");

    let app_entry = AppEntry {
        id: app_id.clone(),
        name: display_name.clone(),
        tagline: parsed.description.clone(),
        description: parsed.description.clone(),
        category,
        repo: repo.clone(),
        icon: "scoop".to_string(),
        asset_pattern: parsed.asset_name.clone(),
        executable_name: parsed.executable_name.clone(),
        accent_color: Some(accent),
        homepage: parsed.homepage.clone(),
        sha256: parsed.sha256.clone(),
        is_custom: true,
        source: "scoop".to_string(),
        scoop_bucket: Some(valid_bucket.to_string()),
        scoop_name: Some(valid_name.clone()),
    };

    let html_url = format!(
        "https://github.com/ScoopInstaller/{valid_bucket}/blob/master/bucket/{valid_name}.json"
    );

    let body = format!(
        "### Manifeste Scoop ({valid_bucket})\n\n{}\n\n- **Paquet** : `{valid_name}`\n- **Version** : `{}`\n- **Binaire** : `{}`\n- **SHA-256** : `{}`{}",
        parsed.description,
        parsed.version,
        parsed.asset_name,
        parsed.sha256.as_deref().unwrap_or("Non fourni"),
        parsed
            .homepage
            .as_deref()
            .map(|h| format!("\n- **Site officiel** : [{h}]({h})"))
            .unwrap_or_default()
    );

    let release_info = ReleaseInfo {
        app_id,
        repo,
        tag_name: format!("v{}", parsed.version.trim_start_matches(['v', 'V'])),
        version: parsed.version.trim_start_matches(['v', 'V']).to_string(),
        name: format!("{display_name} {}", parsed.version),
        body,
        published_at: None,
        html_url,
        matched_asset: Some(ReleaseAsset {
            id: 0,
            name: parsed.asset_name,
            size: 0,
            browser_download_url: parsed.download_url,
            api_url: String::new(),
            content_type: None,
            sha256: parsed.sha256,
            checksum_asset: None,
        }),
        checked_at: Utc::now().to_rfc3339(),
        from_cache: false,
    };

    Ok((app_entry, release_info))
}

fn prettify_scoop_name(raw: &str) -> String {
    raw.split(['-', '_'])
        .filter(|s| !s.is_empty())
        .map(|part| {
            let mut chars = part.chars();
            match chars.next() {
                Some(first) => format!("{}{}", first.to_ascii_uppercase(), chars.as_str()),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_validate_scoop_bucket_and_name() {
        assert_eq!(validate_scoop_bucket("Main").unwrap(), "Main");
        assert_eq!(validate_scoop_bucket("extras").unwrap(), "Extras");
        assert!(validate_scoop_bucket("nonportable").is_err());
        assert!(validate_scoop_bucket("../evil").is_err());

        assert!(validate_scoop_name("7zip").is_ok());
        assert!(validate_scoop_name("vscode-insiders").is_ok());
        assert!(validate_scoop_name("node.js").is_ok());
        assert!(validate_scoop_name("../secret").is_err());
        assert!(validate_scoop_name("a/b").is_err());
        assert!(validate_scoop_name("app?x=1").is_err());
    }

    #[test]
    fn test_parse_scoop_manifest_64bit_and_arrays() {
        let hash64 = "a3f5c8d2e1b40976f123456789abcdef0123456789abcdef0123456789abcdef";
        let manifest = json!({
            "version": "2.10.0",
            "description": "Outil de test Scoop",
            "homepage": "https://example.org/tool",
            "architecture": {
                "64bit": {
                    "url": [
                        "https://example.org/downloads/tool-2.10.0-x64.zip#/dl.zip",
                        "https://example.org/downloads/readme.txt"
                    ],
                    "hash": [
                        hash64,
                        "md5:00000000000000000000000000000000"
                    ],
                    "bin": [
                        ["bin/tool-cli.exe", "tool"]
                    ]
                }
            }
        });

        let parsed = parse_scoop_manifest("demo-tool", &manifest).unwrap();
        assert_eq!(parsed.version, "2.10.0");
        assert_eq!(parsed.download_url, "https://example.org/downloads/tool-2.10.0-x64.zip");
        assert_eq!(parsed.asset_name, "dl.zip");
        assert_eq!(parsed.sha256.as_deref(), Some(hash64));
        assert_eq!(parsed.executable_name, "tool-cli.exe");
    }

    #[test]
    fn test_parse_scoop_manifest_rejects_http_and_weak_hash() {
        let http_manifest = json!({
            "version": "1.0.0",
            "url": "http://insecure.example.org/app.zip",
            "hash": "a3f5c8d2e1b40976f123456789abcdef0123456789abcdef0123456789abcdef"
        });
        assert!(parse_scoop_manifest("bad-http", &http_manifest).is_err());

        let md5_manifest = json!({
            "version": "1.0.0",
            "url": "https://example.org/app.zip",
            "hash": "md5:d41d8cd98f00b204e9800998ecf8427e",
            "bin": "app.exe"
        });
        let parsed = parse_scoop_manifest("weak-hash", &md5_manifest).unwrap();
        assert!(parsed.sha256.is_none());
        assert_eq!(parsed.executable_name, "app.exe");
    }

    #[test]
    fn test_scoop_index_search_ranking() {
        let index = ScoopIndex {
            updated_at: "2026-11-22T00:00:00Z".into(),
            main_count: 2,
            extras_count: 2,
            entries: vec![
                ScoopIndexEntry { name: "my-git-tool".into(), bucket: "Extras".into() },
                ScoopIndexEntry { name: "git".into(), bucket: "Main".into() },
                ScoopIndexEntry { name: "git-lfs".into(), bucket: "Main".into() },
                ScoopIndexEntry { name: "github-desktop".into(), bucket: "Extras".into() },
            ],
        };

        let all = search_scoop_index(&index, "git", None, 10);
        assert_eq!(all.total_matches, 4);
        assert_eq!(all.items[0].name, "git");
        assert_eq!(all.items[1].name, "git-lfs");

        let extras_only = search_scoop_index(&index, "git", Some("Extras"), 10);
        assert_eq!(extras_only.total_matches, 2);
        assert_eq!(extras_only.items[0].name, "github-desktop");
    }
}
