// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use tauri::{State, Manager};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{TrayIconBuilder, TrayIconEvent, MouseButtonState};
use tauri_plugin_autostart::MacosLauncher;


#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
async fn open_url(url: String) -> Result<(), String> {
    opener::open(&url).map_err(|e| e.to_string())
}

#[tauri::command]
async fn find_scihub_urls(limit: usize) -> Result<Vec<String>, String> {
    let accessor = scihub::SciHubAccessor::new();
    Ok(accessor.find_available_urls(limit).await)
}

#[tauri::command]
async fn fast_find_scihub_urls(limit: usize) -> Result<Vec<String>, String> {
    let accessor = scihub::SciHubAccessor::new();
    Ok(accessor.fast_find_available_urls(limit).await)
}

#[tauri::command]
async fn open_doi_scihub(doi: String, url_index: usize) -> Result<String, String> {
    let accessor = scihub::SciHubAccessor::new();
    let urls = accessor.find_available_urls(1).await;

    if urls.is_empty() {
        return Err("未找到可用的Sci-Hub网址".to_string());
    }

    let base_url = &urls[url_index.min(urls.len() - 1)];
    let scihub_url = format!("{}/{}", base_url, doi);

    println!("正在打开: {}", scihub_url);
    opener::open(&scihub_url).map_err(|e| e.to_string())?;

    Ok(scihub_url)
}

#[tauri::command]
async fn open_path(path: String) -> Result<(), String> {
    // Reveal in file explorer or open if it's a directory
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Helper to get the correct config path
/// 1. Check user config directory
/// 2. If not found, check resource directory (copy to user config)
/// 3. If not found, check current directory
fn get_app_config_path(app: &tauri::AppHandle, filename: &str) -> Option<std::path::PathBuf> {
    use std::fs;
    use std::path::PathBuf;

    // 1. Try App Config Directory (AppData/Roaming/...)
    if let Ok(config_dir) = app.path().app_config_dir() {
        if !config_dir.exists() {
            let _ = fs::create_dir_all(&config_dir);
        }
        
        let config_path = config_dir.join(filename);
        if config_path.exists() {
            return Some(config_path);
        }

        // 2. If not in config dir, check resource dir and copy if found
        if let Ok(resource_dir) = app.path().resource_dir() {
            let resource_path = resource_dir.join(filename);
            if resource_path.exists() {
                // Copy bundled config to user config dir
                if let Err(e) = fs::copy(&resource_path, &config_path) {
                    println!("Failed to copy bundled {} to config dir: {}", filename, e);
                    // Fallback to resource path if copy fails
                    return Some(resource_path);
                } else {
                    println!("Copied bundled {} to {:?}", filename, config_path);
                    return Some(config_path);
                }
            }
        }
    }

    // 3. Fallback to current directory (dev mode or strictly local)
    let local_path = PathBuf::from(filename);
    if local_path.exists() {
        return Some(local_path);
    }
    
    // Check parent (dev mode compatibility)
    if std::path::Path::new(&format!("../{}", filename)).exists() {
        return Some(PathBuf::from(format!("../{}", filename)));
    }

    // If strictly ensuring a writeable path is needed even if source doesn't exist:
    if let Ok(config_dir) = app.path().app_config_dir() {
        return Some(config_dir.join(filename));
    }

    None
}

#[tauri::command]
async fn set_window_visibility(app: tauri::AppHandle, label: String, visible: bool) -> Result<(), String> {
    let window = app.get_webview_window(&label).ok_or(format!("No window with label {}", label))?;
    if visible {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
    } else {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn set_popup_position(app: tauri::AppHandle, x: f64, y: f64) -> Result<(), String> {
    let window = app.get_webview_window("popup").ok_or("No popup window")?;
    
    // 获取窗口尺寸
    let size = window.outer_size().map_err(|e| e.to_string())?;
    let window_width = size.width as i32;
    let window_height = size.height as i32;
    
    // 获取所有可用监视器
    let monitors = window.available_monitors()
        .map_err(|e| e.to_string())?;
    
    // 找到包含鼠标坐标的监视器
    let mouse_x = x as i32;
    let mouse_y = y as i32;
    
    let target_monitor = monitors.iter()
        .find(|monitor| {
            let position = monitor.position();
            let size = monitor.size();
            let monitor_left = position.x;
            let monitor_top = position.y;
            let monitor_right = monitor_left + size.width as i32;
            let monitor_bottom = monitor_top + size.height as i32;
            
            mouse_x >= monitor_left && mouse_x < monitor_right &&
            mouse_y >= monitor_top && mouse_y < monitor_bottom
        })
        .or_else(|| monitors.first()) // 如果没找到，使用第一个监视器
        .ok_or("No available monitors")?;
    
    // 获取目标监视器的尺寸和位置
    let monitor_position = target_monitor.position();
    let monitor_size = target_monitor.size();
    let monitor_left = monitor_position.x;
    let monitor_top = monitor_position.y;
    let screen_width = monitor_size.width as i32;
    let screen_height = monitor_size.height as i32;
    
    // 计算popup窗口位置（在鼠标位置的右下方，留出一些边距）
    let offset_x = 20;
    let offset_y = 20;
    let mut popup_x = mouse_x + offset_x;
    let mut popup_y = mouse_y + offset_y;
    
    // 确保窗口不会超出目标监视器的右边界
    if popup_x + window_width > monitor_left + screen_width {
        popup_x = monitor_left + screen_width - window_width - 10;
    }
    
    // 确保窗口不会超出目标监视器的下边界
    if popup_y + window_height > monitor_top + screen_height {
        popup_y = mouse_y - window_height - 10;
        // 如果上方空间也不够，就放在监视器底部
        if popup_y < monitor_top + 10 {
            popup_y = monitor_top + screen_height - window_height - 10;
        }
    }
    
    // 确保窗口不会超出目标监视器的左边界和上边界
    popup_x = popup_x.max(monitor_left + 10);
    popup_y = popup_y.max(monitor_top + 10);
    
    window.set_position(tauri::Position::Physical(tauri::PhysicalPosition { x: popup_x, y: popup_y }))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn adjust_window_size(app: tauri::AppHandle, label: String, width: f64, height: f64) -> Result<(), String> {
    let window = app.get_webview_window(&label).ok_or(format!("No window with label {}", label))?;
    
    // 1. 设置新尺寸
    window.set_size(tauri::Size::Logical(tauri::LogicalSize { width, height }))
        .map_err(|e| e.to_string())?;
    
    // 2. 检查位置并防止底部溢出
    let monitor = window.current_monitor()
        .map_err(|e| e.to_string())?
        .ok_or("No current monitor found")?;
    
    let monitor_pos = monitor.position();
    let monitor_size = monitor.size();
    let monitor_bottom = monitor_pos.y + monitor_size.height as i32;
    
    let window_pos = window.outer_position().map_err(|e| e.to_string())?;
    let window_size = window.outer_size().map_err(|e| e.to_string())?;
    
    let window_bottom = window_pos.y + window_size.height as i32;
    
    // 如果窗口底部超出了监视器底部
    if window_bottom > monitor_bottom - 10 {
        let over_offset = window_bottom - (monitor_bottom - 10);
        let new_y = window_pos.y - over_offset;
        
        // 向上移动窗口，并确保不超出监视器顶部
        let safe_y = new_y.max(monitor_pos.y + 10);
        
        window.set_position(tauri::Position::Physical(tauri::PhysicalPosition { 
            x: window_pos.x, 
            y: safe_y 
        })).map_err(|e| e.to_string())?;
        
        println!("AI: Adjusted window position due to overflow: y moved from {} to {}", window_pos.y, safe_y);
    }
    
    Ok(())
}

mod types; // Register types module
mod scanner;
mod extractor;
mod router;
mod ai;
mod scihub;

#[tauri::command]
async fn process_selection(
    _app: tauri::AppHandle,
    extractor: State<'_, extractor::Extractor>,
    router: State<'_, router::Router>
) -> Result<Option<types::ProcessSelectionResult>, String> {
    
    // 1. Extract
    let text_opt = extractor.extract_selection();
    
    if let Some(text) = text_opt {
        // 2. Check blacklist before AI processing
        let current_process = extractor.get_current_process_name();
        if ai::is_blacklisted(&current_process) {
            println!("AI: Process '{}' is in blacklist, skipping AI features", current_process);
            let matches = router.match_intent(&text);
            if !matches.is_empty() {
                return Ok(Some(types::ProcessSelectionResult {
                    actions: matches,
                    captured_text: text,
                    ai_result: None,
                }));
            } else {
                return Ok(None);
            }
        }

        // 3. Match from existing rules (regex) - 这一步很快！
        println!("Extracted text: {}", text);
        let matches = router.match_intent(&text);

        // 4. 只对非AI类型的action自动执行，AI类型需要用户选择
        let ai_result = None;
        if let Some(first_action) = matches.first() {
            // 只有非AI类型的action才自动执行
            match first_action.action.action_type.as_str() {
                "url" | "path" | "doi_scihub" | "local_format" => {
                    // 这些类型不自动执行，让用户选择
                }
                _ => {}
            }
        }

        if !matches.is_empty() {
             Ok(Some(types::ProcessSelectionResult {
                 actions: matches,
                 captured_text: text,
                 ai_result,
             }))
        } else {
             Ok(None)
        }
    } else {
        Ok(None)
    }
}

#[tauri::command]
async fn ai_translate(text: String) -> Result<Option<types::AiResult>, String> {
    Ok(ai::translate_text(&text).await)
}

#[tauri::command]
async fn ai_summarize(text: String) -> Result<Option<types::AiResult>, String> {
    Ok(ai::summarize_text(&text).await)
}

#[tauri::command]
async fn ai_process(text: String, intent: String) -> Result<Option<types::AiResult>, String> {
    Ok(ai::process_text(&text, &intent).await)
}

#[tauri::command]
async fn get_actions_list_cmd(app: tauri::AppHandle) -> Result<Vec<types::ContextAction>, String> {
    let actions_path = get_app_config_path(&app, "actions.json")
        .ok_or("Could not find actions.json path")?;
    
    if !actions_path.exists() {
        return Ok(Vec::new());
    }

    let content = std::fs::read_to_string(actions_path)
        .map_err(|e| format!("Failed to read actions: {}", e))?;
    
    let actions: Vec<types::ContextAction> = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse actions: {}", e))?;
    
    Ok(actions)
}

/// 确保私有虚拟环境存在并返回 Python 解释器路径
async fn ensure_venv(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    use std::process::Command;
    let config_dir = app.path().app_config_dir()
        .map_err(|e| format!("无法获取配置目录: {}", e))?;
    
    let venv_dir = config_dir.join(".venv");
    let python_exe = if cfg!(windows) {
        venv_dir.join("Scripts").join("python.exe")
    } else {
        venv_dir.join("bin").join("python")
    };

    if !python_exe.exists() {
        println!(">>> 正在初始化私有 Python 虚拟环境 (Venv)...");
        // 确保目录存在
        std::fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;
        
        // 尝试使用系统 python 创建 venv
        let status = Command::new("python")
            .arg("-m")
            .arg("venv")
            .arg(&venv_dir)
            .status()
            .map_err(|e| format!("创建虚拟环境失败 (请确保已安装 Python): {}", e))?;
            
        if !status.success() {
            return Err("虚拟环境初始化失败，请检查系统 Python 环境。".to_string());
        }
        println!(">>> 虚拟环境创建成功: {:?}", venv_dir);
    }
    
    Ok(python_exe)
}

#[tauri::command]
async fn execute_script(
    app: tauri::AppHandle,
    script_path: String,
    arguments: Vec<String>,
    source_text: String
) -> Result<types::AiResult, String> {
    use std::process::Command;
    use std::path::PathBuf;

    // Resolve path: if it's just a filename, look in scripts dir. If absolute, use as is.
    let mut path = PathBuf::from(&script_path);
    
    if !path.is_absolute() {
        if let Ok(config_dir) = app.path().app_config_dir() {
            let scripts_path = config_dir.join("scripts").join(&script_path);
            if scripts_path.exists() {
                path = scripts_path;
            }
        }
    }

    if !path.exists() {
        return Err(format!("找不到脚本文件: {:?}\n请确认文件是否存在于配置目录的 scripts 文件夹中。", path));
    }

    // Prepare arguments: add source_text as the last argument if needed or just pass everything
    let mut args = arguments.clone();
    args.push(source_text.clone());

    // 1. 确保虚拟环境就绪并获取私有 Python 路径
    let python_interpreter = ensure_venv(&app).await?;

    // Execute (Assume python for now, or detect by extension)
    let output = if path.extension().and_then(|s| s.to_str()) == Some("py") {
        Command::new(python_interpreter)
            .env("PYTHONIOENCODING", "utf-8") // 强制 Python 使用 UTF-8 编码
            .arg(&path)
            .args(&args)
            .output()
            .map_err(|e| format!("执行 Python 脚本失败: {}", e))?
    } else {
        Command::new(&path)
            .env("PYTHONIOENCODING", "utf-8")
            .args(&args)
            .output()
            .map_err(|e| format!("执行脚本失败: {}", e))?
    };

    if output.status.success() {
        let result = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Ok(types::AiResult {
            result,
            action_type: "script".to_string(),
            source_text,
        })
    } else {
        let error = String::from_utf8_lossy(&output.stderr).to_string();
        Err(format!("Script exited with error: {}", error))
    }
}

#[tauri::command]
async fn import_actions_cmd(app: tauri::AppHandle, path: String) -> Result<String, String> {
    use std::fs;
    
    // 1. 读取文件
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("无法读取文件: {}", e))?;
    
    // 2. 尝试解析为数组
    let new_actions: Vec<types::ContextAction> = if let Ok(actions) = serde_json::from_str::<Vec<types::ContextAction>>(&content) {
        actions
    } else {
        // 尝试解析为单个对象
        let single: types::ContextAction = serde_json::from_str(&content)
            .map_err(|e| format!("JSON 格式无效 (不是有效的规则或规则列表): {}", e))?;
        vec![single]
    };

    if new_actions.is_empty() {
        return Ok("没有找到可导入的功能。".to_string());
    }

    // 3. 加载现有配置
    let actions_path = get_app_config_path(&app, "actions.json")
        .ok_or("无法找到 actions.json 路径")?;
    
    let mut existing_actions: Vec<types::ContextAction> = if actions_path.exists() {
        let existing_content = fs::read_to_string(&actions_path)
            .map_err(|e| format!("无法读取现有规则库: {}", e))?;
        serde_json::from_str(&existing_content).unwrap_or_default()
    } else {
        Vec::new()
    };

    // 4. 合并并去重 (以 ID 为准)
    let mut import_count = 0;
    for new_action in new_actions {
        existing_actions.retain(|a| a.meta.id != new_action.meta.id);
        existing_actions.push(new_action);
        import_count += 1;
    }

    // 5. 写回文件
    let pretty = serde_json::to_string_pretty(&existing_actions)
        .map_err(|e| format!("序列化失败: {}", e))?;
    fs::write(&actions_path, pretty)
        .map_err(|e| format!("无法写入规则库: {}", e))?;

    // 6. 重新加载 Router
    if let Some(router) = app.try_state::<router::Router>() {
        router.force_reload();
    }

    Ok(format!("成功导入 {} 条功能规则。", import_count))
}

/// 本地排版：不使用AI，纯本地文本处理
#[tauri::command]
fn local_format_text(text: String) -> types::AiResult {
    // 清理多余空行
    let mut result = text
        .lines()
        .map(|line| line.trim())
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    
    // 合并连续空格
    while result.contains("  ") {
        result = result.replace("  ", " ");
    }
    
    // 规范化标点（中文标点后不要空格）
    result = result
        .replace("， ", "，")
        .replace("。 ", "。")
        .replace("！ ", "！")
        .replace("？ ", "？")
        .replace("： ", "：")
        .replace("； ", "；");
    
    types::AiResult {
        result,
        action_type: "local_format".to_string(),
        source_text: text,
    }
}

#[tauri::command]
async fn check_blacklist(process_name: String) -> Result<bool, String> {
    Ok(ai::is_blacklisted(&process_name))
}

#[tauri::command]
async fn update_hotkey_config(
    trigger_key: String,
    trigger_type: String,
    trigger_interval: u64,
    scanner: State<'_, scanner::Scanner>
) -> Result<(), String> {
    let config = scanner::HotkeyConfig {
        trigger_key,
        trigger_type,
        trigger_interval,
    };
    scanner.update_hotkey_config(config);
    Ok(())
}

#[tauri::command]
async fn save_settings(settings: String, app: tauri::AppHandle) -> Result<(), String> {
    use std::fs;
    use std::path::PathBuf;
    
    // 使用统一的配置路径获取逻辑
    let path = get_app_config_path(&app, "settings.json")
        .unwrap_or_else(|| PathBuf::from("settings.json"));
    
    // 确保父目录存在
    if let Some(parent) = path.parent() {
        if !parent.exists() {
            let _ = fs::create_dir_all(parent);
        }
    }
    
    // Parse and re-serialize to ensure valid JSON
    let parsed: serde_json::Value = serde_json::from_str(&settings)
        .map_err(|e| format!("Invalid JSON: {}", e))?;
    
    let pretty = serde_json::to_string_pretty(&parsed)
        .map_err(|e| format!("Serialization error: {}", e))?;
    
    fs::write(&path, pretty)
        .map_err(|e| format!("Failed to write settings: {}", e))?;
    
    println!("Settings saved to {:?}", path);
    Ok(())
}

#[tauri::command]
async fn load_settings_cmd(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    use std::fs;
    
    // 使用统一的配置路径获取逻辑
    let path = get_app_config_path(&app, "settings.json")
        .ok_or("Settings file not found")?;
    
    if !path.exists() {
        return Err("Settings file not found".to_string());
    }
    
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read settings: {}", e))?;
    
    let parsed: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Invalid JSON: {}", e))?;
    
    Ok(parsed)
}

#[tauri::command]
async fn save_actions(
    actions: String,
    router: State<'_, router::Router>
) -> Result<(), String> {
    use std::fs;
    
    let path = router.get_config_path();
    
    // Parse and re-serialize to ensure valid JSON
    let parsed: serde_json::Value = serde_json::from_str(&actions)
        .map_err(|e| format!("Invalid JSON: {}", e))?;
    
    let pretty = serde_json::to_string_pretty(&parsed)
        .map_err(|e| format!("Serialization error: {}", e))?;
    
    fs::write(&path, pretty)
        .map_err(|e| format!("Failed to write actions: {}", e))?;
    
    // 强制重新加载
    router.force_reload();
    
    println!("Actions saved and reloaded from {:?}", path);
    Ok(())
}

#[tauri::command]
async fn reload_actions(
    router: State<'_, router::Router>
) -> Result<(), String> {
    router.force_reload();
    println!("Actions manually reloaded");
    Ok(())
}

#[tauri::command]
async fn ai_generate_rule(description: String) -> Result<Option<types::ContextAction>, String> {
    Ok(ai::generate_rule(&description).await)
}

#[cfg(test)]
mod tests {
    use regex::Regex;

    #[test]
    fn test_doi_regex() {
        let pattern = r"\b10\.\d{4,9}/[-._;()/:a-zA-Z0-9]+";
        let re = Regex::new(pattern).unwrap();

        let test_cases = vec![
            "10.1093/bioinformatics/btaa1016",
            "10.1000/xyz123",
            "10.1234/test-123",
        ];

        for test in test_cases {
            assert!(re.is_match(test), "Failed to match: {}", test);
        }

        // 测试不应该匹配的情况
        let negative_cases = vec![
            "abc10.1093/bioinformatics/btaa1016", // 前面有字符
            "10.109/bioinformatics/btaa1016", // 数字不够
        ];

        for test in negative_cases {
            assert!(!re.is_match(test), "Should not match: {}", test);
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(extractor::Extractor::new())
        .manage(router::Router::new())
        .setup(|app| {
            let handle = app.handle().clone();
            
            // 设置router的app_handle，使其能获取正确的资源路径
            if let Some(router) = app.try_state::<router::Router>() {
                router.set_app_handle(handle.clone());
                // 设置 app_handle 后重新加载 actions，确保从资源目录读取
                router.force_reload();
            }

            // 设置AI模块的app_handle，使其能从资源目录读取settings.json
            ai::set_app_handle(handle.clone());
            
            // System Tray Setup
            let settings_item = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
            let reload_item = MenuItem::with_id(app, "reload", "Reload Actions", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            
            let tray_menu = Menu::with_items(app, &[&settings_item, &reload_item, &quit_item])?;
            
            // 保存托盘图标引用，确保正确管理生命周期
            let tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&tray_menu)
                .on_menu_event(move |app: &tauri::AppHandle, event| {
                    match event.id.as_ref() {
                        "settings" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "reload" => {
                            // 重新加载 actions.json
                            if let Some(router) = app.try_state::<router::Router>() {
                                router.force_reload();
                                println!("Actions reloaded");
                            }
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray: &tauri::tray::TrayIcon, event| {
                    if let TrayIconEvent::Click {
                        button: tauri::tray::MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;
            
            // 将托盘图标引用保存到app状态中，确保不会被过早释放
            app.manage(tray);

            // Initialize Scanner in a separate thread
            let scanner = scanner::Scanner::new();
            scanner.start(handle);
            app.manage(scanner);
            
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec!["--autostart"])))
        .invoke_handler(tauri::generate_handler![
            greet, 
            process_selection, 
            open_url, 
            open_path, 
            set_window_visibility,
            set_popup_position,
            adjust_window_size,
            ai_translate,
            ai_summarize,
            ai_process,
            check_blacklist,
            update_hotkey_config,
            save_settings,
            load_settings_cmd,
            save_actions,
            reload_actions,
            ai_generate_rule,
            local_format_text,
            find_scihub_urls,
            fast_find_scihub_urls,
            open_doi_scihub,
            execute_script,
            import_actions_cmd,
            get_actions_list_cmd
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
