// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod github;
mod installer;
mod models;
mod scoop;
mod security;
mod storage;

use commands::LauncherState;
use std::sync::Arc;

fn main() {
    let launcher_state = Arc::new(
        LauncherState::initialize().expect("Échec d'initialisation du backend Craft.ro"),
    );

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(launcher_state)
        .invoke_handler(tauri::generate_handler![
            commands::get_app_state,
            commands::refresh_registry,
            commands::check_release,
            commands::check_all_updates,
            commands::install_or_update_app,
            commands::cancel_download,
            commands::launch_app,
            commands::open_install_folder,
            commands::uninstall_app,
            commands::save_settings,
            commands::set_github_token,
            commands::clear_github_token,
            commands::add_custom_app,
            commands::toggle_favorite,
            commands::remove_custom_app,
            commands::sync_scoop_index,
            commands::search_scoop_apps,
            commands::import_scoop_app,
        ])
        .run(tauri::generate_context!())
        .expect("Erreur lors du démarrage de Craft.ro");
}
