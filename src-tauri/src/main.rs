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
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager, WindowEvent};

fn restore_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.emit("window-visibility", true);
    }
}

fn main() {
    let launcher_state = Arc::new(
        LauncherState::initialize().expect("Échec d'initialisation du backend Craft.ro"),
    );

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(launcher_state)
        .setup(|app| {
            let open_item =
                MenuItem::with_id(app, "tray-open", "Ouvrir Craft.ro", true, None::<&str>)?;
            let updates_item = MenuItem::with_id(
                app,
                "tray-updates",
                "Vérifier les mises à jour",
                true,
                None::<&str>,
            )?;
            let sep = PredefinedMenuItem::separator(app)?;
            let quit_item = MenuItem::with_id(app, "tray-quit", "Quitter", true, None::<&str>)?;

            let tray_menu = Menu::with_items(app, &[&open_item, &updates_item, &sep, &quit_item])?;

            let mut tray_builder = TrayIconBuilder::with_id("craft-tray")
                .tooltip("Craft.ro")
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, event| match event {
                    TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    }
                    | TrayIconEvent::DoubleClick {
                        button: MouseButton::Left,
                        ..
                    } => {
                        restore_main_window(tray.app_handle());
                    }
                    _ => {}
                })
                .on_menu_event(|app_handle, event| match event.id.as_ref() {
                    "tray-open" => {
                        restore_main_window(app_handle);
                    }
                    "tray-updates" => {
                        restore_main_window(app_handle);
                        let _ = app_handle.emit("tray-check-updates", ());
                    }
                    "tray-quit" => {
                        app_handle.exit(0);
                    }
                    _ => {}
                });

            if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            }

            tray_builder.build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<Arc<LauncherState>>();
                let should_minimize = tauri::async_runtime::block_on(async {
                    state.persisted.lock().await.settings.minimize_to_tray
                });

                if should_minimize {
                    api.prevent_close();
                    let _ = window.hide();
                    let _ = window.emit("window-visibility", false);
                }
            }
        })
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
