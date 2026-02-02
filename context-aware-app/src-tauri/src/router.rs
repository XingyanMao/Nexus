use crate::types::ContextAction;
use regex::Regex;
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, RwLock};
use std::time::SystemTime;
use tauri::Manager;

/// 内置的默认actions规则
const DEFAULT_ACTIONS_JSON: &str = r#"[
  {
    "meta": {
      "id": "builtin-url",
      "name": "打开网址",
      "version": "1.0.0"
    },
    "scope": {
      "include": ["*"],
      "priority": 90
    },
    "trigger": {
      "type": "regex",
      "pattern": "^.*(https?:\\/\\/|www\\.)([\\w_-]+(?:(?:\\.[\\w_-]+)+))([\\w.,@?^=%&:/~+#-]*[\\w@?^=%&/~+#-])?",
      "extraction_pattern": "(https?://|www\\.)[\\x21-\\x7e]+"
    },
    "action": {
      "type": "url",
      "template": "${0}"
    }
  },
  {
    "meta": {
      "id": "builtin-doi",
      "name": "打开DOI",
      "version": "1.0.0"
    },
    "scope": {
      "include": ["*"],
      "priority": 95
    },
    "trigger": {
      "type": "regex",
      "pattern": "\\b10\\.\\d{4,9}/[-._;()/:a-zA-Z0-9]+",
      "extraction_pattern": "10\\.\\d{4,9}/[-._;()/:a-zA-Z0-9]+"
    },
    "action": {
      "type": "doi_scihub",
      "template": ""
    }
  },
  {
    "meta": {
      "id": "builtin-path-windows",
      "name": "打开文件路径",
      "version": "1.0.0"
    },
    "scope": {
      "include": ["*"],
      "priority": 90
    },
    "trigger": {
      "type": "regex",
      "extraction_pattern": "[a-zA-Z]:\\\\(?:[^\\\\/:*?\"<>|\\r\\n]+\\\\)*[^\\\\/:*?\"<>|\\r\\n]*",
      "pattern": "^[a-zA-Z]:\\\\(?:[^\\\\/:*?\"<>|\\r\\n]+\\\\)*[^\\\\/:*?\"<>|\\r\\n]*$"
    },
    "action": {
      "type": "path",
      "template": "${0}"
    }
  },
  {
    "meta": {
      "id": "builtin-ai-translate",
      "name": "翻译",
      "version": "1.0.0"
    },
    "scope": {
      "include": ["*"],
      "priority": 50
    },
    "trigger": {
      "type": "regex",
      "pattern": ".{5,}"
    },
    "action": {
      "type": "ai_translate",
      "template": ""
    }
  },
  {
    "meta": {
      "id": "builtin-ai-summarize",
      "name": "总结",
      "version": "1.0.0"
    },
    "scope": {
      "include": ["*"],
      "priority": 40
    },
    "trigger": {
      "type": "regex",
      "pattern": ".{100,}"
    },
    "action": {
      "type": "ai_summarize",
      "template": ""
    }
  },
  {
    "meta": {
      "id": "builtin-local-format",
      "name": "本地排版",
      "version": "1.0.0"
    },
    "scope": {
      "include": ["*"],
      "priority": 35
    },
    "trigger": {
      "type": "regex",
      "pattern": ".{50,}"
    },
    "action": {
      "type": "local_format",
      "template": ""
    }
  },
  {
    "meta": {
      "id": "builtin-ai-format",
      "name": "AI排版",
      "version": "1.0.0"
    },
    "scope": {
      "include": ["*"],
      "priority": 30
    },
    "trigger": {
      "type": "regex",
      "pattern": ".{50,}"
    },
    "action": {
      "type": "ai_process",
      "template": "format_text"
    }
  },
  {
    "meta": {
      "id": "builtin-google-search",
      "name": "Google搜索",
      "version": "1.0.0"
    },
    "scope": {
      "include": ["*"],
      "priority": 10
    },
    "trigger": {
      "type": "regex",
      "pattern": ".+"
    },
    "action": {
      "type": "url",
      "template": "https://www.google.com/search?q=${0}"
    }
  }
]"#;

/// 缓存正则表达式和对应的 action 索引
struct CompiledAction {
    action: ContextAction,
    compiled_regex: Option<Regex>,
}

pub struct Router {
    compiled_actions: Arc<RwLock<Vec<CompiledAction>>>,
    last_mod: Arc<RwLock<SystemTime>>,
    config_path: Arc<RwLock<PathBuf>>,
    app_handle: Arc<Mutex<Option<tauri::AppHandle>>>,
}

impl Router {
    pub fn new() -> Self {
        let router = Router {
            compiled_actions: Arc::new(RwLock::new(Vec::new())),
            last_mod: Arc::new(RwLock::new(SystemTime::UNIX_EPOCH)),
            config_path: Arc::new(RwLock::new(PathBuf::from("actions.json"))), // 初始值，会在 reload_if_needed 中更新
            app_handle: Arc::new(Mutex::new(None)),
        };

        router.reload_if_needed();
        router
    }
    
    pub fn set_app_handle(&self, handle: tauri::AppHandle) {
        let mut app_handle_guard = self.app_handle.lock().unwrap();
        *app_handle_guard = Some(handle);
    }
    

    fn reload_if_needed(&self) {
        // Strategy:
        // 1. Check user config directory (AppData/Roaming/...) - Primary Source
        // 2. If not found in user config, check resource directory (bundled with installer)
        // 3. If found in resource, COPY to user config directory for future persistence
        // 4. If not found anywhere, use built-in defaults

        let mut found_path: Option<PathBuf> = None;
        let filename = "actions.json";

        // Try to get handle to find paths
        let app_handle_guard = self.app_handle.lock().unwrap();
        if let Some(ref handle) = *app_handle_guard {
            if let Ok(config_dir) = handle.path().app_config_dir() {
                // Ensure config directory exists
                if !config_dir.exists() {
                    let _ = fs::create_dir_all(&config_dir);
                }

                let user_config_path = config_dir.join(filename);
                
                if user_config_path.exists() {
                    // 1. Found in user config directory
                    found_path = Some(user_config_path);
                    println!("Router: Found actions.json in user config directory");
                } else {
                    // 2. Not in user config, check resource directory
                    let mut resource_found = false;
                    if let Ok(resource_dir) = handle.path().resource_dir() {
                        let resource_path = resource_dir.join(filename);
                        if resource_path.exists() {
                            println!("Router: Found actions.json in resource directory, copying to user config...");
                            // 3. Copy to user config
                            if let Err(e) = fs::copy(&resource_path, &user_config_path) {
                                println!("Router: Failed to copy bundled actions to config path: {}", e);
                                // Fallback to reading directly from resource if copy fails
                                found_path = Some(resource_path);
                                resource_found = true;
                            } else {
                                println!("Router: Successfully copied actions to {:?}", user_config_path);
                                found_path = Some(user_config_path);
                                resource_found = true;
                            }
                        }
                    }

                    if !resource_found {
                        // Check current directory (dev mode fallback)
                        let local_path = PathBuf::from(filename);
                        if local_path.exists() {
                            found_path = Some(local_path);
                            println!("Router: Found actions.json in current directory");
                        }
                    }
                }
            } else {
                 // Fallback if we can't get app config dir (unlikely)
                 let local_path = PathBuf::from(filename);
                 if local_path.exists() {
                     found_path = Some(local_path);
                 }
            }
        } else {
            // No app handle yet, look in current directory
            let local_path = PathBuf::from(filename);
            if local_path.exists() {
                found_path = Some(local_path);
                println!("Router: Found actions.json in current directory (no handle)");
            }
        }
        
        // Drop lock before proceeding with fs operations that might take time
        drop(app_handle_guard);

        // 如果找到了文件路径，更新 config_path 并加载
        if let Some(path) = found_path {
            // 更新 config_path
            let mut config_path_guard = self.config_path.write().unwrap();
            *config_path_guard = path.clone();
            drop(config_path_guard);

            // 检查文件是否需要重新加载
            if let Ok(metadata) = fs::metadata(&path) {
                if let Ok(mod_time) = metadata.modified() {
                    let last = *self.last_mod.read().unwrap();
                    if mod_time > last {
                        println!("Router: Reloading actions from {:?}", path);
                        if let Ok(content) = fs::read_to_string(&path) {
                            if let Ok(new_actions) = serde_json::from_str::<Vec<ContextAction>>(&content) {
                                // 预编译所有正则表达式
                                let compiled: Vec<CompiledAction> = new_actions
                                    .into_iter()
                                    .map(|action| {
                                        let compiled_regex = if action.trigger.trigger_type == "regex" {
                                            match Regex::new(&action.trigger.pattern) {
                                                Ok(re) => Some(re),
                                                Err(e) => {
                                                    println!("Router: Failed to compile regex '{}': {}", action.trigger.pattern, e);
                                                    None
                                                }
                                            }
                                        } else {
                                            None
                                        };
                                        CompiledAction { action, compiled_regex }
                                    })
                                    .collect();

                                let count = compiled.len();
                                let mut actions_guard = self.compiled_actions.write().unwrap();
                                *actions_guard = compiled;
                                let mut time_guard = self.last_mod.write().unwrap();
                                *time_guard = mod_time;
                                println!("Router: Reloaded and compiled {} actions from {:?}", count, path);
                                return;
                            } else {
                                println!("Router: Failed to parse actions.json");
                            }
                        }
                    }
                }
            }
        }

        // 3. 如果都没有找到，使用内置的默认 actions
        if self.compiled_actions.read().unwrap().is_empty() {
            println!("Router: No actions.json found, using built-in default actions");
            
            // Try to set config_path to user config directory so that if user saves, it saves there
            // Need to re-acquire app handle lock or store the path found earlier?
            // "found_path" is None here.
            
            // Re-attempt to determine best save path
            let app_handle_guard = self.app_handle.lock().unwrap();
            if let Some(ref handle) = *app_handle_guard {
                if let Ok(config_dir) = handle.path().app_config_dir() {
                    let user_config_path = config_dir.join(filename);
                    if !config_dir.exists() {
                         let _ = fs::create_dir_all(&config_dir);
                    }
                    // Update config path to point to where it SHOULD be
                    let mut config_path_guard = self.config_path.write().unwrap();
                    *config_path_guard = user_config_path;
                    // drop guard implicitly when scope ends, but explicit drop for clarity
                    drop(config_path_guard);
                }
            }
            drop(app_handle_guard);

            if let Ok(new_actions) = serde_json::from_str::<Vec<ContextAction>>(DEFAULT_ACTIONS_JSON) {
                // 预编译所有正则表达式
                let compiled: Vec<CompiledAction> = new_actions
                    .into_iter()
                    .map(|action| {
                        let compiled_regex = if action.trigger.trigger_type == "regex" {
                            match Regex::new(&action.trigger.pattern) {
                                Ok(re) => Some(re),
                                Err(e) => {
                                    println!("Router: Failed to compile regex '{}': {}", action.trigger.pattern, e);
                                    None
                                }
                            }
                        } else {
                            None
                        };
                        CompiledAction { action, compiled_regex }
                    })
                    .collect();

                let count = compiled.len();
                let mut actions_guard = self.compiled_actions.write().unwrap();
                *actions_guard = compiled;
                println!("Router: Loaded {} built-in default actions.", count);
            }
        }
    }

    pub fn match_intent(&self, text: &str) -> Vec<ContextAction> {
        self.reload_if_needed();

        let compiled_actions = self.compiled_actions.read().unwrap();
        let mut matches = Vec::new();

        for compiled in compiled_actions.iter() {
            if let Some(ref re) = compiled.compiled_regex {
                if re.is_match(text) {
                    matches.push(compiled.action.clone());
                }
            }
        }
        
        // Sort by priority (descending)
        matches.sort_by(|a, b| b.scope.priority.cmp(&a.scope.priority));
        
        matches
    }

    /// 强制重新加载配置（用于热更新）
    pub fn force_reload(&self) {
        // 重置时间戳强制重新加载
        {
            let mut time_guard = self.last_mod.write().unwrap();
            *time_guard = SystemTime::UNIX_EPOCH;
        }
        self.reload_if_needed();
    }

    /// 获取配置文件路径
    pub fn get_config_path(&self) -> PathBuf {
        self.config_path.read().unwrap().clone()
    }
}
