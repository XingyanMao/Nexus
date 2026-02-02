use rdev::{listen, Event, EventType, Key};
use std::thread;
use std::time::{Duration, Instant};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

/// 快捷键配置
#[derive(Clone, Debug)]
pub struct HotkeyConfig {
    pub trigger_key: String,
    pub trigger_type: String, // "double_press" or "single_press"
    pub trigger_interval: u64, // milliseconds
}

impl Default for HotkeyConfig {
    fn default() -> Self {
        Self {
            trigger_key: "Ctrl".to_string(),
            trigger_type: "double_press".to_string(),
            trigger_interval: 400,
        }
    }
}

/// 合并所有扫描器状态到单一结构体，减少锁竞争
struct ScannerState {
    mouse_pos: (f64, f64),
    drag_start: Option<(f64, f64)>,
    selection_end: Option<(f64, f64, Instant)>,
    last_trigger_press: Instant,
    trigger_press_count: u32,
}

pub struct Scanner {
    hotkey_config: Arc<Mutex<HotkeyConfig>>,
}

impl Scanner {
    pub fn new() -> Self {
        Scanner {
            hotkey_config: Arc::new(Mutex::new(HotkeyConfig::default())),
        }
    }
    
    /// 更新快捷键配置
    pub fn update_hotkey_config(&self, config: HotkeyConfig) {
        let mut cfg = self.hotkey_config.lock().unwrap();
        *cfg = config.clone();
        println!("Scanner: Hotkey config updated: {:?}", config);
    }

    pub fn start(&self, app_handle: AppHandle) {
        println!("Scanner started");
        
        let hotkey_config = Arc::clone(&self.hotkey_config);
        thread::spawn(move || {
            let state = Arc::new(Mutex::new(ScannerState {
                mouse_pos: (0.0, 0.0),
                drag_start: None,
                selection_end: None,
                last_trigger_press: Instant::now(),
                trigger_press_count: 0,
            }));

            use rdev::Button;

            let callback = move |event: Event| {
                match event.event_type {
                    EventType::MouseMove { x, y } => {
                        let mut s = state.lock().unwrap();
                        s.mouse_pos = (x, y);

                        // 检查选区后移动触发 (select_move)
                        if let Some((sx, sy, time)) = s.selection_end {
                            // 2秒内有效
                            if time.elapsed() < Duration::from_secs(2) {
                                let cfg = hotkey_config.lock().unwrap();
                                if cfg.trigger_type == "select_move" {
                                    let dist = ((x - sx).powi(2) + (y - sy).powi(2)).sqrt();
                                    // 移动超过 30 像素即触发
                                    if dist > 30.0 {
                                        println!("Select-Move detected: dist={:.2}, trigger spotlight at ({}, {})", dist, x, y);
                                        s.selection_end = None;
                                        drop(cfg);
                                        drop(s);
                                        app_handle.emit("trigger-spotlight", (x, y)).unwrap_or(());
                                        return;
                                    }
                                }
                            } else {
                                s.selection_end = None;
                            }
                        }
                    }
                    EventType::ButtonPress(Button::Left) => {
                        let mut s = state.lock().unwrap();
                        s.drag_start = Some(s.mouse_pos);
                        s.selection_end = None;
                        
                        app_handle.emit("hide-ghost", ()).unwrap_or(()); 
                    }
                    EventType::ButtonRelease(Button::Left) => {
                        let mut s = state.lock().unwrap();
                        let pos = s.mouse_pos;
                        
                        if let Some(start_pos) = s.drag_start {
                            let dist = ((pos.0 - start_pos.0).powi(2) + (pos.1 - start_pos.1).powi(2)).sqrt();
                            // 距离大于 40 像素判定为选区
                            if dist > 40.0 {
                                println!("Text Selection Detected (dist: {:.2})", dist);
                                s.selection_end = Some((pos.0, pos.1, Instant::now()));
                            }
                        }
                        s.drag_start = None;
                    }
                    EventType::KeyPress(key) => {
                        let cfg = hotkey_config.lock().unwrap();
                        let trigger_key = cfg.trigger_key.clone();
                        let trigger_type = cfg.trigger_type.clone();
                        let interval = cfg.trigger_interval;
                        drop(cfg);

                        // 检查按下的键是否匹配配置的触发键
                        let is_match = match (key, trigger_key.as_str()) {
                            (Key::ControlLeft, "Ctrl") | (Key::ControlRight, "Ctrl") => true,
                            (Key::ShiftLeft, "Shift") | (Key::ShiftRight, "Shift") => true,
                            (Key::Alt, "Alt") | (Key::AltGr, "Alt") => true,
                            (Key::Escape, _) => {
                                app_handle.emit("hide-ghost", ()).unwrap_or(());
                                false
                            }
                            _ => false,
                        };

                        if is_match && trigger_type == "double_press" {
                            let mut s = state.lock().unwrap();
                            let now = Instant::now();
                            let elapsed = now.duration_since(s.last_trigger_press);

                            if elapsed < Duration::from_millis(interval) {
                                s.trigger_press_count += 1;
                            } else {
                                s.trigger_press_count = 1;
                            }
                            s.last_trigger_press = now;
                            
                            if s.trigger_press_count == 2 {
                                s.trigger_press_count = 0;
                                let pos = s.mouse_pos;
                                drop(s);
                                println!("Double {:?} detected", key);
                                app_handle.emit("trigger-spotlight", pos).unwrap_or(());
                            }
                        }
                    }
                    _ => {}
                }
            };

            if let Err(error) = listen(callback) {
                println!("Error: {:?}", error)
            }
        });
    }
}
