use std::net::{IpAddr, ToSocketAddrs};
use std::path::{Path, PathBuf};
use url::{Host, Url};

pub const USER_AGENT_VALUE: &str = "CraftRo-Launcher/1.0";
const KEYRING_SERVICE: &str = "ro.craft.launcher";
const KEYRING_USER: &str = "github-pat";

const ALLOWED_GITHUB_TOKEN_HOSTS: &[&str] = &[
    "api.github.com",
    "github.com",
    "raw.githubusercontent.com",
];

/// Validates `app.id` strictly against `^[a-z0-9-]+$` (1..=64 chars).
pub fn validate_app_id(id: &str) -> Result<(), String> {
    if id.is_empty() || id.len() > 64 {
        return Err("L'identifiant de l'application doit contenir entre 1 et 64 caractères.".into());
    }
    if !id
        .bytes()
        .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
    {
        return Err(format!(
            "Identifiant invalide '{id}' : seuls a-z, 0-9 et '-' sont autorisés."
        ));
    }
    if id.starts_with('-') || id.ends_with('-') {
        return Err(format!(
            "Identifiant invalide '{id}' : ne doit pas commencer ou finir par '-'."
        ));
    }
    Ok(())
}

/// Validates `repo` strictly against `^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$` with no traversal segments.
pub fn validate_repo(repo: &str) -> Result<(), String> {
    let mut parts = repo.split('/');
    let owner = parts.next().unwrap_or("");
    let name = parts.next().unwrap_or("");
    if parts.next().is_some() || owner.is_empty() || name.is_empty() {
        return Err(format!(
            "Dépôt GitHub invalide '{repo}' : format attendu 'owner/repo'."
        ));
    }

    for seg in [owner, name] {
        if seg.len() > 100
            || seg == "."
            || seg == ".."
            || seg.contains("..")
            || !seg
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'.' || b == b'-')
        {
            return Err(format!(
                "Segment de dépôt GitHub invalide dans '{repo}'."
            ));
        }
    }
    Ok(())
}

/// Validates `executableName` is a single safe filename without path separators.
pub fn validate_executable_name(name: &str) -> Result<(), String> {
    let trimmed = name.trim();
    if trimmed.is_empty()
        || trimmed == "."
        || trimmed == ".."
        || trimmed.contains('/')
        || trimmed.contains('\\')
        || trimmed.contains('\0')
    {
        return Err(format!("Nom d'exécutable invalide : '{name}'."));
    }
    let fname = Path::new(trimmed)
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| format!("Nom d'exécutable invalide : '{name}'."))?;
    if fname != trimmed {
        return Err(format!("Nom d'exécutable invalide : '{name}'."));
    }
    Ok(())
}

/// Extracts a safe leaf filename from a release asset name, neutralizing path traversal.
pub fn sanitize_asset_filename(asset_name: &str) -> Result<String, String> {
    let fname = Path::new(asset_name)
        .file_name()
        .and_then(|n| n.to_str())
        .map(|s| s.trim())
        .filter(|s| !s.is_empty() && *s != "." && *s != "..")
        .ok_or_else(|| format!("Nom de fichier d'asset invalide : '{asset_name}'."))?;

    if fname.contains('/') || fname.contains('\\') || fname.contains('\0') {
        return Err(format!("Nom de fichier d'asset non sûr : '{asset_name}'."));
    }
    Ok(fname.to_string())
}

/// Enforces HTTPS and rejects localhost / loopback / private / link-local hosts (SSRF protection).
pub fn validate_https_url(raw: &str) -> Result<Url, String> {
    let parsed = Url::parse(raw.trim()).map_err(|e| format!("URL invalide '{raw}': {e}"))?;
    if parsed.scheme() != "https" {
        return Err(format!(
            "Seul le protocole HTTPS est autorisé (reçu '{}').",
            parsed.scheme()
        ));
    }

    match parsed.host() {
        Some(Host::Domain(domain)) => {
            let lower = domain.to_ascii_lowercase();
            if lower == "localhost"
                || lower.ends_with(".localhost")
                || lower.ends_with(".local")
                || lower.ends_with(".internal")
            {
                return Err(format!("Hôte local interdit : '{domain}'."));
            }
        }
        Some(Host::Ipv4(ip)) => {
            if is_blocked_ip(IpAddr::V4(ip)) {
                return Err(format!("Adresse IP locale/privée interdite : '{ip}'."));
            }
        }
        Some(Host::Ipv6(ip)) => {
            if is_blocked_ip(IpAddr::V6(ip)) {
                return Err(format!("Adresse IPv6 locale/privée interdite : '{ip}'."));
            }
        }
        None => return Err("L'URL doit contenir un nom d'hôte valide.".into()),
    }

    Ok(parsed)
}

/// Verifies every resolved IP address against `is_blocked_ip` (anti-DNS rebinding).
pub fn validate_resolved_ips(host: &str, ips: &[IpAddr]) -> Result<(), String> {
    if ips.is_empty() {
        return Err(format!("Aucune adresse IP résolue pour l'hôte '{host}'."));
    }
    for ip in ips {
        if is_blocked_ip(*ip) {
            return Err(format!(
                "Résolution DNS bloquée par sécurité (anti-DNS rebinding) : '{host}' pointe vers une adresse privée ou locale ({ip})."
            ));
        }
    }
    Ok(())
}

/// Validates HTTPS URL AND performs synchronous DNS resolution checking every resolved IP
/// against `is_blocked_ip` to defeat DNS rebinding (e.g. `127.0.0.1.nip.io`).
pub fn validate_https_url_with_dns(raw: &str) -> Result<Url, String> {
    let parsed = validate_https_url(raw)?;
    let host = parsed
        .host_str()
        .ok_or_else(|| "L'URL doit contenir un nom d'hôte valide.".to_string())?;
    let port = parsed.port_or_known_default().unwrap_or(443);

    let addrs = (host, port)
        .to_socket_addrs()
        .map_err(|e| format!("Échec de résolution DNS pour '{host}': {e}"))?;
    let ips: Vec<IpAddr> = addrs.map(|sa| sa.ip()).collect();
    validate_resolved_ips(host, &ips)?;

    Ok(parsed)
}

/// Async wrapper around `validate_https_url_with_dns` so DNS lookup never blocks the Tokio runtime.
pub async fn validate_https_url_with_dns_async(raw: &str) -> Result<Url, String> {
    let owned = raw.to_string();
    tokio::task::spawn_blocking(move || validate_https_url_with_dns(&owned))
        .await
        .map_err(|e| format!("Erreur interne lors de la résolution DNS: {e}"))?
}

pub fn is_blocked_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            v4.is_private()
                || v4.is_loopback()
                || v4.is_link_local()
                || v4.is_unspecified()
                || v4.is_broadcast()
                || v4.is_multicast()
                || (v4.octets()[0] == 100 && (v4.octets()[1] & 0b1100_0000) == 64)
        }
        IpAddr::V6(v6) => {
            if let Some(mapped_v4) = v6.to_ipv4_mapped() {
                return is_blocked_ip(IpAddr::V4(mapped_v4));
            }
            v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_multicast()
                || (v6.segments()[0] & 0xfe00) == 0xfc00 // fc00::/7 unique local
                || (v6.segments()[0] & 0xffc0) == 0xfe80 // fe80::/10 link local
        }
    }
}

/// Returns true ONLY for trusted GitHub API / raw hosts where a GitHub PAT may be sent.
pub fn is_trusted_github_token_host(url: &Url) -> bool {
    if url.scheme() != "https" {
        return false;
    }
    match url.host_str() {
        Some(host) => {
            let lower = host.to_ascii_lowercase();
            ALLOWED_GITHUB_TOKEN_HOSTS.iter().any(|h| *h == lower)
        }
        None => false,
    }
}

/// Verifies `target` canonicalizes strictly inside `root` (and is not `root` itself).
pub fn assert_path_within_root(target: &Path, root: &Path) -> Result<PathBuf, String> {
    let canon_root = root
        .canonicalize()
        .map_err(|e| format!("Dossier racine d'installation inaccessible: {e}"))?;
    let canon_target = target
        .canonicalize()
        .map_err(|e| format!("Chemin cible inaccessible: {e}"))?;

    if !canon_target.starts_with(&canon_root) || canon_target == canon_root {
        return Err(
            "Opération bloquée par sécurité : chemin hors du dossier d'installation Craft.ro."
                .into(),
        );
    }

    Ok(canon_target)
}

/// Parses an optional `sha256:` prefix and returns a validated 64-character lowercase hex string.
pub fn parse_sha256_hex(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    let hex_part = trimmed
        .strip_prefix("sha256:")
        .or_else(|| trimmed.strip_prefix("SHA256:"))
        .unwrap_or(trimmed)
        .trim();
    if hex_part.len() == 64 && hex_part.bytes().all(|b| b.is_ascii_hexdigit()) {
        Some(hex_part.to_ascii_lowercase())
    } else {
        None
    }
}

/// Extracts a SHA-256 hash matching `asset_name` from a `.sha256` or `SHA256SUMS` file.
pub fn extract_sha256_from_checksum_file(content: &str, asset_name: &str) -> Option<String> {
    let target_lower = asset_name.to_ascii_lowercase();
    let lines: Vec<&str> = content
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .collect();

    // Exact match for `<hash>  <filename>` or `<hash> *<filename>`
    for line in &lines {
        let mut tokens = line.split_whitespace();
        let Some(first) = tokens.next() else {
            continue;
        };
        if let Some(hash) = parse_sha256_hex(first) {
            if let Some(rest) = tokens.next() {
                let candidate = rest
                    .trim_start_matches('*')
                    .rsplit(['/', '\\'])
                    .next()
                    .unwrap_or(rest)
                    .to_ascii_lowercase();
                if candidate == target_lower {
                    return Some(hash);
                }
            }
        }
    }

    // Single-line `.sha256` file containing only the hash (or hash + matching single entry)
    if lines.len() == 1 {
        if let Some(first) = lines[0].split_whitespace().next() {
            if let Some(hash) = parse_sha256_hex(first) {
                return Some(hash);
            }
        }
    }

    None
}

// ---------- OS Keyring (Windows Credential Manager) ----------

fn keyring_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|e| format!("Impossible d'accéder au gestionnaire d'identifiants Windows: {e}"))
}

pub fn store_github_token(token: &str) -> Result<bool, String> {
    let trimmed = token.trim();
    let entry = keyring_entry()?;
    if trimmed.is_empty() {
        let _ = entry.delete_credential();
        return Ok(false);
    }
    entry
        .set_password(trimmed)
        .map_err(|e| format!("Échec d'enregistrement du token dans le coffre système: {e}"))?;
    Ok(true)
}

pub fn load_github_token() -> Option<String> {
    let entry = keyring_entry().ok()?;
    match entry.get_password() {
        Ok(pw) if !pw.trim().is_empty() => Some(pw),
        _ => None,
    }
}

pub fn delete_github_token() -> Result<(), String> {
    let entry = keyring_entry()?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Impossible de supprimer le token du coffre système: {e}")),
    }
}

pub fn has_github_token() -> bool {
    load_github_token().is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_app_id() {
        assert!(validate_app_id("localsend").is_ok());
        assert!(validate_app_id("flow-launcher-2").is_ok());
        assert!(validate_app_id("../evil").is_err());
        assert!(validate_app_id("My_App").is_err());
        assert!(validate_app_id("-bad").is_err());
        assert!(validate_app_id("").is_err());
    }

    #[test]
    fn test_validate_repo() {
        assert!(validate_repo("BurntSushi/ripgrep").is_ok());
        assert!(validate_repo("Flow-Launcher/Flow.Launcher").is_ok());
        assert!(validate_repo("owner/repo/extra").is_err());
        assert!(validate_repo("../evil").is_err());
        assert!(validate_repo("owner/..").is_err());
        assert!(validate_repo("owner/repo?foo=bar").is_err());
    }

    #[test]
    fn test_sanitize_asset_filename() {
        assert_eq!(
            sanitize_asset_filename("LocalSend-1.18.2-windows-x86-64.zip").unwrap(),
            "LocalSend-1.18.2-windows-x86-64.zip"
        );
        assert_eq!(
            sanitize_asset_filename("../../evil.exe").unwrap(),
            "evil.exe"
        );
        assert!(sanitize_asset_filename("..").is_err());
        assert!(sanitize_asset_filename("").is_err());
    }

    #[test]
    fn test_https_and_ssrf_guard() {
        assert!(validate_https_url("https://api.github.com/repos/a/b").is_ok());
        assert!(validate_https_url("http://api.github.com/repos/a/b").is_err());
        assert!(validate_https_url("https://localhost/registry.json").is_err());
        assert!(validate_https_url("https://127.0.0.1/registry.json").is_err());
        assert!(validate_https_url("https://192.168.1.5/registry.json").is_err());
        assert!(validate_https_url("https://169.254.169.254/latest/meta-data").is_err());
    }

    #[test]
    fn test_trusted_github_token_hosts() {
        assert!(is_trusted_github_token_host(
            &Url::parse("https://api.github.com/repos/a/b").unwrap()
        ));
        assert!(is_trusted_github_token_host(
            &Url::parse("https://raw.githubusercontent.com/a/b/main/registry.json").unwrap()
        ));
        assert!(is_trusted_github_token_host(
            &Url::parse("https://github.com/a/b/releases").unwrap()
        ));
        assert!(!is_trusted_github_token_host(
            &Url::parse("https://evil.com/api.github.com").unwrap()
        ));
        assert!(!is_trusted_github_token_host(
            &Url::parse("https://objects.githubusercontent.com/file").unwrap()
        ));
    }

    #[test]
    fn test_extract_sha256() {
        let digest = "a3f5c8d2e1b40976f123456789abcdef0123456789abcdef0123456789abcdef";
        assert_eq!(
            parse_sha256_hex(&format!("sha256:{digest}")),
            Some(digest.to_string())
        );

        let sums = format!(
            "0000000000000000000000000000000000000000000000000000000000000000  other.zip\n{digest} *ripgrep-15.2.0-x86_64-pc-windows-msvc.zip\n"
        );
        assert_eq!(
            extract_sha256_from_checksum_file(&sums, "ripgrep-15.2.0-x86_64-pc-windows-msvc.zip"),
            Some(digest.to_string())
        );
    }

    #[test]
    fn test_anti_dns_rebinding_ip_validation() {
        use std::net::{Ipv4Addr, Ipv6Addr};

        let public_v4 = IpAddr::V4(Ipv4Addr::new(140, 82, 121, 4));
        let loopback_v4 = IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1));
        let private_v4 = IpAddr::V4(Ipv4Addr::new(10, 0, 0, 5));
        let metadata_v4 = IpAddr::V4(Ipv4Addr::new(169, 254, 169, 254));
        let loopback_v6 = IpAddr::V6(Ipv6Addr::LOCALHOST);
        let mapped_loopback_v6 = IpAddr::V6(Ipv4Addr::new(127, 0, 0, 1).to_ipv6_mapped());

        assert!(validate_resolved_ips("github.com", &[public_v4]).is_ok());
        assert!(validate_resolved_ips("127.0.0.1.nip.io", &[loopback_v4]).is_err());
        assert!(validate_resolved_ips("rebind.example", &[public_v4, private_v4]).is_err());
        assert!(validate_resolved_ips("meta.example", &[metadata_v4]).is_err());
        assert!(validate_resolved_ips("v6.example", &[loopback_v6]).is_err());
        assert!(validate_resolved_ips("mapped.example", &[mapped_loopback_v6]).is_err());
        assert!(validate_resolved_ips("empty.example", &[]).is_err());
    }
}
