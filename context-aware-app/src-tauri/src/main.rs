// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // 单实例模式：防止重复启动src-tauri/target/release/
    let single_instance = single_instance::SingleInstance::new("Ctrl-Ctrl-instance").unwrap();
    if !single_instance.is_single() {
        return;
    }

    context_aware_app_lib::run()
}
