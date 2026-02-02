# Nexus 开发指南 🚀

欢迎来到 **Nexus** ！这是一个基于 Tauri 的跨平台生产力工具，旨在通过“上下文感知”为用户提供即时的选择文本处理能力。

---

## 1. 项目核心逻辑流程

1.  **Scanner (Rust)**: 后台监听热键（默认双击 Ctrl）。
2.  **Extractor (Rust)**: 触发时，模拟复制操作捕获当前活跃窗口的选择文本。
3.  **Router (Rust)**: 将提取的文本与 `actions.json` 中的匹配规则进行正则匹配。
4.  **Frontend (React)**: 
    - 如果匹配到规则，弹出 `popup` 窗口展示可用操作（翻译、搜索、打开链接等）。
    - 用户点击操作后，调用对应的 Rust 命令执行。
5.  **AI Module (Rust)**: 处理复杂的意图识别和文本处理任务。

---

## 2. 核心文件索引

- **后端 (Rust)**:
  - [lib.rs](file:///d:/context/context-aware-app/src-tauri/src/lib.rs): 命令注册中心、生命周期管理。
  - [types.rs](file:///d:/context/context-aware-app/src-tauri/src/types.rs): **最重要的文件**。定义了 `ActionDef`, `ActionTrigger`, `ContextAction` 等核心数据结构。
  - [router.rs](file:///d:/context/context-aware-app/src-tauri/src/router.rs): 路由匹配逻辑。
  - [extractor.rs](file:///d:/context/context-aware-app/src-tauri/src/extractor.rs): 窗口信息获取和文本提取。
  - [ai.rs](file:///d:/context/context-aware-app/src-tauri/src/ai.rs): AI 接口实现。

- **前端 (React + TS)**:
  - [App.tsx](file:///d:/context/context-aware-app/src/App.tsx): 窗口路由分发（Main vs Popup）。
  - [ActionPopup.tsx](file:///d:/context/context-aware-app/src/components/ActionPopup.tsx): 弹出层的 UI 交互和操作执行逻辑。
  - [Settings.tsx](file:///d:/context/context-aware-app/src/components/Settings.tsx): 设置界面。

- **配置**:
  - [actions.json](file:///d:/context/context-aware-app/actions.json): 预设的操作匹配规则库。

---

## 3. 如何增加新功能？

### 场景 A：增加一个新的正则匹配规则
只需修改 [actions.json](file:///d:/context/context-aware-app/actions.json)，添加一个新的 `ContextAction` 对象。
- `trigger.pattern`: 用于识别文本的正则表达式。
- `action.type`: "url" (打开链接), "path" (打开路径), "script" (运行脚本) 等。

### 场景 B：增加一种新的操作类型 (Action Type)
1.  **在后端定义**: 
    - 在 [types.rs](file:///d:/context/context-aware-app/src-tauri/src/types.rs) 的 `ActionDef` 中添加类型注释。
    - 在 [lib.rs](file:///d:/context/context-aware-app/src-tauri/src/lib.rs) 中编写具体的处理函数并注册为 `#[tauri::command]`。
2.  **在前端配置**:
    - 在 `ActionPopup.tsx` 中处理点击该类型操作时的逻辑。

### 场景 C：修改 AI 提示词或逻辑
- 编辑 [ai.rs](file:///d:/context/context-aware-app/src-tauri/src/ai.rs) 中的 `process_text` 等函数及其 Prompt 定义。

---

## 4. 给 AI 助手的特别提示 💡

1.  **强类型约束**: 请务必参考 [types.rs](file:///d:/context/context-aware-app/src-tauri/src/types.rs)，确保前后端数据交换格式一致。
2.  **多平台适配**: 执行系统命令时（如打开文件浏览器），请根据 `cfg(target_os = "windows")` 处理差异。
3.  **配置路径**: 读写配置文件请使用 `lib.rs` 中的 `get_app_config_path` 函数，遵循：用户目录 > 资源目录 > 本地目录 的优先级。
4.  **脚本执行**: 项目支持 Python 虚拟环境执行脚本，相关逻辑在 `lib.rs` 的 `execute_script` 和 `ensure_venv`。

---

## 5. 开发常用命令

- 启动开发服务: `npm run tauri dev`
- 构建项目: `npm run tauri build`
- 运行 Rust 测试: `cargo test`
