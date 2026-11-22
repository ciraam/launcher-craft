use crate::github;
use crate::models::{AppEntry, DownloadProgressEvent, InstalledApp, ReleaseInfo};
use crate::security::{self, USER_AGENT_VALUE};
use chrono::Utc;
use futures_util::StreamExt;
use reqwest::header::{ACCEPT, AUTHORIZATION, USER_AGENT};
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{self, ErrorKind, Read, Write};
#[cfg(target_os = "windows")]
use std::os::windows::fs::OpenOptionsExt;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncWriteExt;
use tokio_util::sync::CancellationToken;

/// Zip-bomb hard limits: max 1.5 GB total decompressed bytes and max 10,000 entries.
const MAX_EXTRACT_TOTAL_BYTES: u64 = 1_500_000_000;
const MAX_EXTRACT_FILES: usize = 10_000;

pub const APP_RUNNING_LOCKED_MSG: &str =
    "L'application semble en cours d'exécution. Fermez-la avant de continuer.";

/// Tests write access (exclusive on Windows) to an existing binary so updates or uninstalls
/// fail fast with a clear message if the application is currently running.
pub fn ensure_executable_not_locked(executable_path: &Path) -> Result<(), String> {
    if !executable_path.exists() {
        return Ok(());
    }

    let mut opts = OpenOptions::new();
    opts.read(true).write(true);
    #[cfg(target_os = "windows")]
    {
        // Request exclusive access (share_mode = 0) so Windows detects active running/open binaries
        // with ERROR_SHARING_VIOLATION (32) or ERROR_LOCK_VIOLATION (33).
        opts.share_mode(0);
    }

    match opts.open(executable_path) {
        Ok(_) => Ok(()),
        Err(err) => {
            let is_lock_error = err.kind() == ErrorKind::PermissionDenied
                || matches!(err.raw_os_error(), Some(5 | 32 | 33));
            if is_lock_error {
                Err(APP_RUNNING_LOCKED_MSG.to_string())
            } else {
                Err(format!(
                    "Impossible d'accéder à l'exécutable '{}': {err}",
                    executable_path.display()
                ))
            }
        }
    }
}

/// Builds Windows Installer (`msiexec`) arguments targeting `app_dir` via `INSTALLDIR="<app_dir>"`.
pub fn build_msi_install_args(msi_path: &Path, app_dir: &Path) -> Vec<String> {
    vec![
        "/i".to_string(),
        msi_path.to_string_lossy().to_string(),
        format!("INSTALLDIR=\"{}\"", app_dir.to_string_lossy()),
        "/passive".to_string(),
        "/norestart".to_string(),
    ]
}

/// Builds Inno Setup installer arguments targeting `app_dir` via `/DIR="<app_dir>"`.
pub fn build_setup_install_args(app_dir: &Path) -> Vec<String> {
    vec![
        "/VERYSILENT".to_string(),
        format!("/DIR=\"{}\"", app_dir.to_string_lossy()),
    ]
}

/// Finds `executable_name` inside `app_dir` after running an `.msi` or `setup.exe` installer.
/// Never falls back to recording the installer artifact itself as `executable_path`.
pub fn resolve_installed_executable(
    app_dir: &Path,
    executable_name: &str,
    installer_artifact: &Path,
) -> Result<PathBuf, String> {
    let found = find_executable(app_dir, executable_name).filter(|p| {
        match (p.canonicalize(), installer_artifact.canonicalize()) {
            (Ok(a), Ok(b)) => a != b,
            _ => p != installer_artifact,
        }
    });

    found.ok_or_else(|| {
        format!(
            "Installation terminée, mais l'exécutable '{executable_name}' est introuvable dans '{}'. L'installeur n'a pas été enregistré comme exécutable.",
            app_dir.display()
        )
    })
}

pub fn emit_progress(app_handle: &AppHandle, event: DownloadProgressEvent) {
    let _ = app_handle.emit("download-progress", event);
}

#[allow(clippy::too_many_arguments)]
pub async fn download_and_install(
    app_handle: AppHandle,
    api_client: reqwest::Client,
    download_client: reqwest::Client,
    app_entry: AppEntry,
    release: ReleaseInfo,
    install_root: PathBuf,
    existing_executable: Option<PathBuf>,
    github_token: Option<String>,
    require_sha256: bool,
    cancel_token: CancellationToken,
) -> Result<InstalledApp, String> {
    security::validate_app_id(&app_entry.id)?;
    security::validate_executable_name(&app_entry.executable_name)?;

    let asset = release
        .matched_asset
        .clone()
        .ok_or_else(|| format!("Aucun binaire compatible trouvé pour {}", app_entry.name))?;

    let safe_asset_name = security::sanitize_asset_filename(&asset.name)?;

    fs::create_dir_all(&install_root)
        .map_err(|e| format!("Impossible de créer le dossier d'installation racine: {e}"))?;

    let app_dir = install_root.join(&app_entry.id);
    fs::create_dir_all(&app_dir)
        .map_err(|e| format!("Impossible de créer le dossier d'installation: {e}"))?;

    // Verify canonicalized app_dir is strictly within install_root
    let _ = security::assert_path_within_root(&app_dir, &install_root)?;

    // Fail fast if the installed application binary is currently running/locked on Windows.
    if let Some(ref existing_exe) = existing_executable {
        ensure_executable_not_locked(existing_exe)?;
    }
    if let Some(detected_exe) = find_executable(&app_dir, &app_entry.executable_name) {
        ensure_executable_not_locked(&detected_exe)?;
    }

    let temp_file = app_dir.join(format!("{safe_asset_name}.part"));

    // Resolve expected SHA-256 (registry pinned > GitHub asset digest > companion .sha256 file)
    let mut expected_sha256 = app_entry
        .sha256
        .as_deref()
        .and_then(security::parse_sha256_hex)
        .or_else(|| asset.sha256.as_deref().and_then(security::parse_sha256_hex));

    if expected_sha256.is_none() {
        if let Some(ref checksum_asset) = asset.checksum_asset {
            expected_sha256 = github::fetch_checksum_sha256(
                &api_client,
                checksum_asset,
                &safe_asset_name,
                github_token.as_deref(),
            )
            .await;
        }
    }

    if require_sha256 && expected_sha256.is_none() {
        let _ = fs::remove_file(&temp_file);
        emit_progress(
            &app_handle,
            DownloadProgressEvent {
                app_id: app_entry.id.clone(),
                status: "error".into(),
                downloaded_bytes: 0,
                total_bytes: asset.size,
                percentage: 0.0,
                speed_bytes_per_sec: 0.0,
                eta_seconds: None,
                message: Some("SHA-256 requis : aucune empreinte vérifiable fournie.".into()),
            },
        );
        return Err(format!(
            "Installation bloquée par sécurité : la release de {} ne fournit aucune empreinte SHA-256 vérifiable et l'option « Exiger une empreinte SHA-256 » est activée.",
            app_entry.name
        ));
    }

    // Build validated HTTPS download URL.
    let raw_download_url =
        if github_token.as_deref().is_some_and(|t| !t.trim().is_empty()) && !asset.api_url.is_empty()
        {
            asset.api_url.clone()
        } else {
            asset.browser_download_url.clone()
        };

    let parsed_url = security::validate_https_url_with_dns_async(&raw_download_url).await?;

    let mut req = download_client
        .get(parsed_url.clone())
        .header(USER_AGENT, USER_AGENT_VALUE)
        .header(ACCEPT, "application/octet-stream");

    // NEVER leak GitHub PAT to non-GitHub hosts.
    if security::is_trusted_github_token_host(&parsed_url) {
        if let Some(ref tok) = github_token {
            let trimmed = tok.trim();
            if !trimmed.is_empty() {
                req = req.header(AUTHORIZATION, format!("Bearer {trimmed}"));
            }
        }
    }

    let response = req
        .send()
        .await
        .map_err(|e| format!("Erreur de connexion au téléchargement: {e}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "Échec du téléchargement (HTTP {})",
            response.status().as_u16()
        ));
    }

    // Also confirm the final post-redirect URL uses HTTPS.
    if response.url().scheme() != "https" {
        return Err("Redirection vers un protocole non-HTTPS bloquée par sécurité.".into());
    }

    let total_bytes = response.content_length().unwrap_or(asset.size);
    let mut file = tokio::fs::File::create(&temp_file)
        .await
        .map_err(|e| format!("Impossible de créer le fichier temporaire: {e}"))?;

    let mut hasher = Sha256::new();
    let mut stream = response.bytes_stream();
    let mut downloaded_bytes: u64 = 0;
    let started_at = Instant::now();
    let mut last_emit = Instant::now() - Duration::from_secs(1);

    emit_progress(
        &app_handle,
        DownloadProgressEvent {
            app_id: app_entry.id.clone(),
            status: "downloading".into(),
            downloaded_bytes: 0,
            total_bytes,
            percentage: 0.0,
            speed_bytes_per_sec: 0.0,
            eta_seconds: None,
            message: Some(format!("Téléchargement de {safe_asset_name}…")),
        },
    );

    loop {
        tokio::select! {
            _ = cancel_token.cancelled() => {
                drop(file);
                let _ = tokio::fs::remove_file(&temp_file).await;
                emit_progress(
                    &app_handle,
                    DownloadProgressEvent {
                        app_id: app_entry.id.clone(),
                        status: "cancelled".into(),
                        downloaded_bytes,
                        total_bytes,
                        percentage: 0.0,
                        speed_bytes_per_sec: 0.0,
                        eta_seconds: None,
                        message: Some("Téléchargement annulé".into()),
                    },
                );
                return Err("Téléchargement annulé par l'utilisateur".into());
            }
            next_chunk = stream.next() => {
                match next_chunk {
                    Some(Ok(chunk)) => {
                        hasher.update(&chunk);
                        file.write_all(&chunk)
                            .await
                            .map_err(|e| format!("Erreur d'écriture disque: {e}"))?;
                        downloaded_bytes += chunk.len() as u64;

                        if last_emit.elapsed() >= Duration::from_millis(80) {
                            let elapsed = started_at.elapsed().as_secs_f64().max(0.05);
                            let speed = downloaded_bytes as f64 / elapsed;
                            let percentage = if total_bytes > 0 {
                                ((downloaded_bytes as f64 / total_bytes as f64) * 100.0).min(100.0)
                            } else {
                                0.0
                            };
                            let eta_seconds = if speed > 1.0 && total_bytes > downloaded_bytes {
                                Some(((total_bytes - downloaded_bytes) as f64 / speed) as u64)
                            } else {
                                None
                            };

                            emit_progress(
                                &app_handle,
                                DownloadProgressEvent {
                                    app_id: app_entry.id.clone(),
                                    status: "downloading".into(),
                                    downloaded_bytes,
                                    total_bytes,
                                    percentage,
                                    speed_bytes_per_sec: speed,
                                    eta_seconds,
                                    message: None,
                                },
                            );
                            last_emit = Instant::now();
                        }
                    }
                    Some(Err(e)) => {
                        drop(file);
                        let _ = tokio::fs::remove_file(&temp_file).await;
                        return Err(format!("Flux interrompu pendant le téléchargement: {e}"));
                    }
                    None => break,
                }
            }
        }
    }

    file.flush()
        .await
        .map_err(|e| format!("Erreur lors de la finalisation du fichier: {e}"))?;
    drop(file);

    // Compute and verify SHA-256 integrity BEFORE any extraction or execution!
    let computed_sha256 = hex::encode(hasher.finalize());
    let mut sha256_verified = false;

    emit_progress(
        &app_handle,
        DownloadProgressEvent {
            app_id: app_entry.id.clone(),
            status: "verifying".into(),
            downloaded_bytes,
            total_bytes: total_bytes.max(downloaded_bytes),
            percentage: 100.0,
            speed_bytes_per_sec: 0.0,
            eta_seconds: Some(0),
            message: Some("Vérification de l'empreinte SHA-256…".into()),
        },
    );

    if let Some(ref expected) = expected_sha256 {
        if !computed_sha256.eq_ignore_ascii_case(expected) {
            let _ = fs::remove_file(&temp_file);
            emit_progress(
                &app_handle,
                DownloadProgressEvent {
                    app_id: app_entry.id.clone(),
                    status: "error".into(),
                    downloaded_bytes,
                    total_bytes: total_bytes.max(downloaded_bytes),
                    percentage: 0.0,
                    speed_bytes_per_sec: 0.0,
                    eta_seconds: None,
                    message: Some("Échec de vérification SHA-256 : fichier rejeté.".into()),
                },
            );
            return Err(format!(
                "Empreinte SHA-256 invalide pour {safe_asset_name} (attendu {}, calculé {}). Fichier supprimé par sécurité.",
                &expected[..12],
                &computed_sha256[..12]
            ));
        }
        sha256_verified = true;
    } else if require_sha256 {
        let _ = fs::remove_file(&temp_file);
        emit_progress(
            &app_handle,
            DownloadProgressEvent {
                app_id: app_entry.id.clone(),
                status: "error".into(),
                downloaded_bytes,
                total_bytes: total_bytes.max(downloaded_bytes),
                percentage: 0.0,
                speed_bytes_per_sec: 0.0,
                eta_seconds: None,
                message: Some("SHA-256 manquant : binaire supprimé par sécurité.".into()),
            },
        );
        return Err(format!(
            "Empreinte SHA-256 manquante pour {safe_asset_name}. Fichier supprimé conformément à la politique stricte."
        ));
    }

    // Re-check lock right before overwriting installed files (in case the app was started during download).
    if let Some(ref existing_exe) = existing_executable {
        ensure_executable_not_locked(existing_exe)?;
    }
    if let Some(detected_exe) = find_executable(&app_dir, &app_entry.executable_name) {
        ensure_executable_not_locked(&detected_exe)?;
    }

    let final_artifact = app_dir.join(&safe_asset_name);
    if final_artifact.exists() {
        let _ = fs::remove_file(&final_artifact);
    }
    fs::rename(&temp_file, &final_artifact)
        .map_err(|e| format!("Impossible de déplacer le fichier téléchargé: {e}"))?;

    let lower_name = safe_asset_name.to_lowercase();
    let executable_path: PathBuf;

    if lower_name.ends_with(".zip") {
        emit_progress(
            &app_handle,
            DownloadProgressEvent {
                app_id: app_entry.id.clone(),
                status: "extracting".into(),
                downloaded_bytes,
                total_bytes: total_bytes.max(downloaded_bytes),
                percentage: 100.0,
                speed_bytes_per_sec: 0.0,
                eta_seconds: Some(0),
                message: Some("Extraction sécurisée de l'archive…".into()),
            },
        );

        let artifact_clone = final_artifact.clone();
        let target_dir = app_dir.clone();
        tokio::task::spawn_blocking(move || {
            extract_zip_archive(&artifact_clone, &target_dir, MAX_EXTRACT_TOTAL_BYTES)
        })
        .await
        .map_err(|e| format!("Erreur interne d'extraction: {e}"))??;

        let _ = fs::remove_file(&final_artifact);

        executable_path = find_executable(&app_dir, &app_entry.executable_name)
            .unwrap_or_else(|| app_dir.join(&app_entry.executable_name));
    } else if lower_name.ends_with(".msi") {
        emit_progress(
            &app_handle,
            DownloadProgressEvent {
                app_id: app_entry.id.clone(),
                status: "installing".into(),
                downloaded_bytes,
                total_bytes: total_bytes.max(downloaded_bytes),
                percentage: 100.0,
                speed_bytes_per_sec: 0.0,
                eta_seconds: Some(0),
                message: Some("Installation silencieuse (.msi)…".into()),
            },
        );

        let msi_path = final_artifact.clone();
        let target_dir = app_dir.clone();
        let status = tokio::task::spawn_blocking(move || {
            let args = build_msi_install_args(&msi_path, &target_dir);
            let mut cmd = Command::new("msiexec");
            cmd.arg(&args[0]).arg(&args[1]);
            #[cfg(target_os = "windows")]
            cmd.raw_arg(&args[2]);
            #[cfg(not(target_os = "windows"))]
            cmd.arg(&args[2]);
            cmd.arg(&args[3]).arg(&args[4]);
            cmd.status()
                .map_err(|e| format!("Impossible de lancer msiexec: {e}"))
        })
        .await
        .map_err(|e| format!("Erreur lors de l'exécution MSI: {e}"))??;

        if !status.success() {
            return Err(format!(
                "L'installeur MSI s'est terminé avec le code {:?}.",
                status.code()
            ));
        }

        executable_path =
            resolve_installed_executable(&app_dir, &app_entry.executable_name, &final_artifact)?;
    } else if lower_name.ends_with(".exe") {
        let is_setup = lower_name.contains("setup") || lower_name.contains("installer");
        if is_setup {
            emit_progress(
                &app_handle,
                DownloadProgressEvent {
                    app_id: app_entry.id.clone(),
                    status: "installing".into(),
                    downloaded_bytes,
                    total_bytes: total_bytes.max(downloaded_bytes),
                    percentage: 100.0,
                    speed_bytes_per_sec: 0.0,
                    eta_seconds: Some(0),
                    message: Some("Exécution de l'installeur (.exe)…".into()),
                },
            );

            // Blocking `.status()` so Craft.ro waits for installer completion before marking installed.
            let setup_path = final_artifact.clone();
            let target_dir = app_dir.clone();
            let status = tokio::task::spawn_blocking(move || {
                let args = build_setup_install_args(&target_dir);
                let mut cmd = Command::new(&setup_path);
                cmd.arg(&args[0]);
                #[cfg(target_os = "windows")]
                cmd.raw_arg(&args[1]);
                #[cfg(not(target_os = "windows"))]
                cmd.arg(&args[1]);
                cmd.status()
                    .or_else(|_| Command::new(&setup_path).status())
                    .map_err(|e| format!("Impossible d'exécuter l'installeur: {e}"))
            })
            .await
            .map_err(|e| format!("Erreur d'installation: {e}"))??;

            if !status.success() {
                return Err(format!(
                    "L'installeur s'est terminé avec le code {:?}.",
                    status.code()
                ));
            }

            executable_path =
                resolve_installed_executable(&app_dir, &app_entry.executable_name, &final_artifact)?;
        } else {
            // Standalone portable .exe -> move cleanly to `executableName`.
            let target_exe = app_dir.join(&app_entry.executable_name);
            if target_exe != final_artifact {
                fs::copy(&final_artifact, &target_exe)
                    .map_err(|e| format!("Impossible de copier l'exécutable portable: {e}"))?;
                let _ = fs::remove_file(&final_artifact);
                executable_path = target_exe;
            } else {
                executable_path = final_artifact;
            }
        }
    } else {
        executable_path = final_artifact;
    }

    let installed = InstalledApp {
        id: app_entry.id.clone(),
        version: release.version.clone(),
        install_path: app_dir.to_string_lossy().to_string(),
        executable_path: executable_path.to_string_lossy().to_string(),
        asset_name: safe_asset_name,
        installed_at: Utc::now().to_rfc3339(),
        sha256: Some(computed_sha256),
        sha256_verified,
    };

    emit_progress(
        &app_handle,
        DownloadProgressEvent {
            app_id: app_entry.id,
            status: "completed".into(),
            downloaded_bytes,
            total_bytes: total_bytes.max(downloaded_bytes),
            percentage: 100.0,
            speed_bytes_per_sec: 0.0,
            eta_seconds: Some(0),
            message: Some(if sha256_verified {
                "Installée (SHA-256 vérifié)".into()
            } else {
                "Installation terminée".into()
            }),
        },
    );

    Ok(installed)
}

/// Safe ZIP extraction enforcing both Zip-Slip (`enclosed_name`) and Zip-Bomb (actual byte & file count) limits.
pub fn extract_zip_archive(
    zip_path: &Path,
    target_dir: &Path,
    max_total_bytes: u64,
) -> Result<(), String> {
    let file =
        File::open(zip_path).map_err(|e| format!("Impossible d'ouvrir l'archive ZIP: {e}"))?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|e| format!("Archive ZIP corrompue ou invalide: {e}"))?;

    if archive.len() > MAX_EXTRACT_FILES {
        return Err(format!(
            "Archive bloquée par sécurité : trop de fichiers ({} > {MAX_EXTRACT_FILES}).",
            archive.len()
        ));
    }

    let mut total_written: u64 = 0;

    for i in 0..archive.len() {
        let entry = archive
            .by_index(i)
            .map_err(|e| format!("Erreur de lecture d'une entrée ZIP: {e}"))?;

        let Some(enclosed) = entry.enclosed_name() else {
            return Err("Entrée ZIP non sécurisée (Zip-Slip) détectée et bloquée.".into());
        };
        let out_path = target_dir.join(enclosed);

        if entry.is_dir() {
            fs::create_dir_all(&out_path)
                .map_err(|e| format!("Impossible de créer le répertoire: {e}"))?;
        } else {
            if let Some(parent) = out_path.parent() {
                fs::create_dir_all(parent)
                    .map_err(|e| format!("Impossible de créer le dossier parent: {e}"))?;
            }

            let remaining = max_total_bytes.saturating_sub(total_written);
            if remaining == 0 {
                return Err(format!(
                    "Archive bloquée (protection Zip-Bomb) : limite de {max_total_bytes} octets dépassée."
                ));
            }

            let mut outfile = File::create(&out_path)
                .map_err(|e| format!("Impossible de créer le fichier extrait: {e}"))?;

            // Read at most `remaining + 1` bytes so even spoofed ZIP headers cannot bypass the cap.
            let mut limited = entry.take(remaining.saturating_add(1));
            let written = io::copy(&mut limited, &mut outfile)
                .map_err(|e| format!("Erreur lors de l'extraction: {e}"))?;
            let _ = outfile.flush();

            total_written = total_written.saturating_add(written);
            if total_written > max_total_bytes {
                let _ = fs::remove_file(&out_path);
                return Err(format!(
                    "Archive bloquée (protection Zip-Bomb) : taille décompressée supérieure à {max_total_bytes} octets."
                ));
            }
        }
    }

    Ok(())
}

pub fn find_executable(dir: &Path, executable_name: &str) -> Option<PathBuf> {
    let target = executable_name.to_lowercase();
    let entries = fs::read_dir(dir).ok()?;

    let mut subdirs = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() {
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                if name.to_lowercase() == target {
                    return Some(path);
                }
            }
        } else if path.is_dir() {
            subdirs.push(path);
        }
    }

    for sub in subdirs {
        if let Some(found) = find_executable(&sub, executable_name) {
            return Some(found);
        }
    }

    None
}

pub fn validate_launch_target(
    executable_path: &str,
    install_path: &str,
    install_root: &Path,
) -> Result<(PathBuf, PathBuf), String> {
    let exe = PathBuf::from(executable_path);
    if !exe.is_file() {
        return Err(format!(
            "Exécutable introuvable à l'emplacement : {executable_path}"
        ));
    }

    let is_exe = exe
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("exe"));
    if !is_exe {
        return Err(
            "Lancement bloqué par sécurité : seuls les fichiers .exe sont autorisés.".into(),
        );
    }

    let safe_dir = security::assert_path_within_root(&PathBuf::from(install_path), install_root)?;
    let safe_exe = security::assert_path_within_root(&exe, install_root)?;

    if !safe_exe.starts_with(&safe_dir) {
        return Err(
            "Lancement bloqué par sécurité : l'exécutable est hors du dossier de l'application."
                .into(),
        );
    }

    Ok((safe_exe, safe_dir))
}

pub fn launch_executable(
    executable_path: &str,
    install_path: &str,
    install_root: &Path,
) -> Result<(), String> {
    let (safe_exe, safe_dir) = validate_launch_target(executable_path, install_path, install_root)?;

    Command::new(&safe_exe)
        .current_dir(&safe_dir)
        .spawn()
        .map_err(|e| format!("Impossible de lancer l'application: {e}"))?;

    Ok(())
}

pub fn open_folder_in_explorer(folder_path: &str, install_root: &Path) -> Result<(), String> {
    let path = PathBuf::from(folder_path);
    if !path.is_dir() {
        return Err(format!("Dossier introuvable : {folder_path}"));
    }

    let safe_path = security::assert_path_within_root(&path, install_root)?;

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(&safe_path)
            .spawn()
            .map_err(|e| format!("Impossible d'ouvrir l'Explorateur Windows: {e}"))?;
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&safe_path)
            .spawn()
            .map_err(|e| format!("Impossible d'ouvrir le Finder: {e}"))?;
    }

    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(&safe_path)
            .spawn()
            .map_err(|e| format!("Impossible d'ouvrir le gestionnaire de fichiers: {e}"))?;
    }

    Ok(())
}

/// Safely uninstalls an app directory ONLY after verifying `canonicalize()` lies strictly inside
/// `install_root` and confirming `executable_path` is not locked by a running process.
pub fn uninstall_directory(
    install_path: &str,
    executable_path: Option<&str>,
    install_root: &Path,
) -> Result<(), String> {
    let path = PathBuf::from(install_path);
    if !path.exists() {
        return Ok(());
    }

    let safe_target = security::assert_path_within_root(&path, install_root)?;

    if let Some(exe) = executable_path {
        let exe_path = PathBuf::from(exe);
        if exe_path.exists() {
            ensure_executable_not_locked(&exe_path)?;
        }
    }

    fs::remove_dir_all(&safe_target).map_err(|e| {
        if e.kind() == ErrorKind::PermissionDenied || matches!(e.raw_os_error(), Some(5 | 32 | 33)) {
            APP_RUNNING_LOCKED_MSG.to_string()
        } else {
            format!("Impossible de supprimer le dossier d'installation: {e}")
        }
    })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use zip::write::SimpleFileOptions;

    #[test]
    fn test_zip_bomb_protection_caps_decompressed_size() {
        let tmp = std::env::temp_dir().join(format!("craftro-zip-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();

        let zip_path = tmp.join("bomb.zip");
        let out_dir = tmp.join("out");
        fs::create_dir_all(&out_dir).unwrap();

        {
            let file = File::create(&zip_path).unwrap();
            let mut writer = zip::ZipWriter::new(file);
            writer
                .start_file("payload.bin", SimpleFileOptions::default())
                .unwrap();
            writer.write_all(&vec![b'A'; 4096]).unwrap();
            writer.finish().unwrap();
        }

        // Cap below payload size must fail
        let err = extract_zip_archive(&zip_path, &out_dir, 1024);
        assert!(err.is_err());

        // Cap above payload size must succeed
        let ok = extract_zip_archive(&zip_path, &out_dir, 8192);
        assert!(ok.is_ok());

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_uninstall_blocks_outside_root() {
        let tmp = std::env::temp_dir().join(format!("craftro-uninst-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        let root = tmp.join("Apps");
        let outside = tmp.join("Other");
        let inside = root.join("demo-app");
        fs::create_dir_all(&inside).unwrap();
        fs::create_dir_all(&outside).unwrap();

        // Attempting to uninstall outside root or root itself must fail
        assert!(uninstall_directory(&outside.to_string_lossy(), None, &root).is_err());
        assert!(uninstall_directory(&root.to_string_lossy(), None, &root).is_err());

        // Valid app folder inside root must succeed
        assert!(uninstall_directory(&inside.to_string_lossy(), None, &root).is_ok());
        assert!(!inside.exists());

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_locked_binary_detection_on_windows() {
        let tmp = std::env::temp_dir().join(format!("craftro-lock-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        let root = tmp.join("Apps");
        let app_dir = root.join("running-app");
        fs::create_dir_all(&app_dir).unwrap();

        let exe_path = app_dir.join("running-app.exe");
        fs::write(&exe_path, b"MZ-test-binary").unwrap();

        // Unlocked binary passes
        assert!(ensure_executable_not_locked(&exe_path).is_ok());

        // Hold an open handle simulating a running Windows executable
        {
            let mut lock_opts = OpenOptions::new();
            lock_opts.read(true);
            #[cfg(target_os = "windows")]
            lock_opts.share_mode(0);
            let _running_handle = lock_opts.open(&exe_path).unwrap();

            #[cfg(target_os = "windows")]
            {
                let err = ensure_executable_not_locked(&exe_path).unwrap_err();
                assert_eq!(err, APP_RUNNING_LOCKED_MSG);

                let uninst_err = uninstall_directory(
                    &app_dir.to_string_lossy(),
                    Some(&exe_path.to_string_lossy()),
                    &root,
                )
                .unwrap_err();
                assert_eq!(uninst_err, APP_RUNNING_LOCKED_MSG);
            }
        }

        // Once closed, lock check and uninstall succeed
        assert!(ensure_executable_not_locked(&exe_path).is_ok());
        assert!(uninstall_directory(
            &app_dir.to_string_lossy(),
            Some(&exe_path.to_string_lossy()),
            &root,
        )
        .is_ok());
        assert!(!app_dir.exists());

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_installer_args_and_post_install_resolution() {
        let tmp = std::env::temp_dir().join(format!("craftro-setup-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        let app_dir = tmp.join("Apps").join("sample-app");
        fs::create_dir_all(&app_dir).unwrap();

        let msi_path = app_dir.join("sample-setup.msi");
        let setup_path = app_dir.join("sample-setup.exe");
        fs::write(&msi_path, b"MSI").unwrap();
        fs::write(&setup_path, b"MZ").unwrap();

        let msi_args = build_msi_install_args(&msi_path, &app_dir);
        assert_eq!(msi_args[0], "/i");
        assert_eq!(
            msi_args[2],
            format!("INSTALLDIR=\"{}\"", app_dir.to_string_lossy())
        );
        assert!(msi_args.contains(&"/passive".to_string()));
        assert!(msi_args.contains(&"/norestart".to_string()));

        let setup_args = build_setup_install_args(&app_dir);
        assert_eq!(setup_args[0], "/VERYSILENT");
        assert_eq!(
            setup_args[1],
            format!("/DIR=\"{}\"", app_dir.to_string_lossy())
        );

        // Missing target executable must fail explicitly instead of returning setup/msi artifact
        let err = resolve_installed_executable(&app_dir, "sample.exe", &setup_path);
        assert!(err.is_err());

        // Even if executable_name matches the installer file itself, it must be rejected
        let self_err = resolve_installed_executable(&app_dir, "sample-setup.exe", &setup_path);
        assert!(self_err.is_err());

        // Once the real executable is extracted/installed into app_dir, resolution succeeds
        let installed_bin = app_dir.join("bin").join("sample.exe");
        fs::create_dir_all(installed_bin.parent().unwrap()).unwrap();
        fs::write(&installed_bin, b"MZ").unwrap();

        let resolved = resolve_installed_executable(&app_dir, "sample.exe", &setup_path).unwrap();
        assert_eq!(resolved, installed_bin);

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_launch_confinement_and_exe_extension() {
        let tmp = std::env::temp_dir().join(format!("craftro-launch-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        let root = tmp.join("Apps");
        let app_dir = root.join("demo-app");
        let outside_dir = tmp.join("System");
        fs::create_dir_all(&app_dir).unwrap();
        fs::create_dir_all(&outside_dir).unwrap();

        let good_exe = app_dir.join("demo.exe");
        let bad_script = app_dir.join("evil.bat");
        let outside_exe = outside_dir.join("cmd.exe");
        fs::write(&good_exe, b"MZ").unwrap();
        fs::write(&bad_script, b"echo hi").unwrap();
        fs::write(&outside_exe, b"MZ").unwrap();

        // Valid .exe inside install_root must pass validation
        assert!(validate_launch_target(
            &good_exe.to_string_lossy(),
            &app_dir.to_string_lossy(),
            &root
        )
        .is_ok());

        // Non-.exe inside install_root must be rejected
        assert!(validate_launch_target(
            &bad_script.to_string_lossy(),
            &app_dir.to_string_lossy(),
            &root
        )
        .is_err());

        // .exe outside install_root (tampered state.json) must be rejected
        assert!(validate_launch_target(
            &outside_exe.to_string_lossy(),
            &outside_dir.to_string_lossy(),
            &root
        )
        .is_err());

        // Opening folder outside install_root or root itself must be rejected
        assert!(open_folder_in_explorer(&outside_dir.to_string_lossy(), &root).is_err());
        assert!(open_folder_in_explorer(&root.to_string_lossy(), &root).is_err());

        let _ = fs::remove_dir_all(&tmp);
    }
}
