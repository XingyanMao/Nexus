import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";

type TabType = "ai" | "hotkeys" | "actions" | "requirements";

interface SettingsData {
    ai: {
        enabled: boolean;
        api_key: string;
        base_url: string;
        model: string;
        blacklist_apps: string[];
    };
    hotkeys: {
        trigger_key: string;
        trigger_type: "double_press" | "select_move";
        trigger_interval: number;
    };
}

interface ActionRule {
    meta: { id: string; name: string; version: string };
    scope: { include: string[]; priority: number };
    trigger: { type: string; pattern: string; extraction_pattern?: string };
    action: { type: string; template: string; script_path?: string; arguments?: string[] };
}

// UI 助手组件 - 极简深色风格
const UI = {
    Card: ({ children, style }: { children: React.ReactNode, style?: React.CSSProperties }) => (
        <div style={{
            backgroundColor: "#171717",
            borderRadius: "12px",
            border: "1px solid #262626",
            padding: "24px",
            ...style
        }}>{children}</div>
    ),
    Label: ({ children }: { children: React.ReactNode }) => (
        <label style={{
            display: "block",
            fontSize: "13px",
            fontWeight: "500",
            color: "#888",
            marginBottom: "8px"
        }}>{children}</label>
    ),
    Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
        <input {...props} style={{
            width: "100%",
            backgroundColor: "#0A0A0A",
            border: "1px solid #262626",
            borderRadius: "8px",
            padding: "10px 14px",
            color: "#EEE",
            fontSize: "14px",
            outline: "none",
            transition: "border-color 0.2s",
            ...props.style
        }} />
    ),
    Button: ({ children, variant = "primary", ...props }: any) => {
        const isPrimary = variant === "primary";
        const isDanger = variant === "danger";
        return (
            <button {...props} style={{
                padding: "10px 20px",
                borderRadius: "8px",
                border: "none",
                fontSize: "14px",
                fontWeight: "600",
                cursor: props.disabled ? "not-allowed" : "pointer",
                backgroundColor: isPrimary ? "#3B82F6" : isDanger ? "#EF4444" : "#262626",
                color: isPrimary || isDanger ? "white" : "#CCC",
                opacity: props.disabled ? 0.5 : 1,
                transition: "all 0.2s",
                ...props.style
            }}>{children}</button>
        );
    }
};


export const Settings = () => {
    const [activeTab, setActiveTab] = useState<TabType>("ai");
    const [settings, setSettings] = useState<SettingsData>({
        ai: {
            enabled: true,
            api_key: "",
            base_url: "https://api.openai.com/v1",
            model: "gpt-4o",
            blacklist_apps: [
                "password-manager.exe",
                "1password.exe",
                "bitwarden.exe",
                "keepass.exe",
                "banking-app.exe",
                "secure-notes.exe"
            ]
        },
        hotkeys: {
            trigger_key: "Ctrl",
            trigger_type: "double_press",
            trigger_interval: 400
        }
    });
    const [actions, setActions] = useState<ActionRule[]>([]);
    const [saved, setSaved] = useState(false);
    const [saving, setSaving] = useState(false);
    const [newBlacklistApp, setNewBlacklistApp] = useState("");
    const [editingAction, setEditingAction] = useState<ActionRule | null>(null);
    const [aiRulePrompt, setAiRulePrompt] = useState("");
    const [generatingRule, setGeneratingRule] = useState(false);
    const [softwareVersion, setSoftwareVersion] = useState("");
    const [userEmail, setUserEmail] = useState("");
    const [requirementDescription, setRequirementDescription] = useState("");
    const [budget, setBudget] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [submitSuccess, setSubmitSuccess] = useState(false);
    const [submitError, setSubmitError] = useState(false);
    const [installing, setInstalling] = useState(false);
    const [installMsg, setInstallMsg] = useState("");

    useEffect(() => {
        const loadData = async () => {
            try {
                // 使用Tauri API加载设置
                const settingsData = await invoke<SettingsData>("load_settings_cmd");
                setSettings(settingsData);
            } catch (e) {
                console.log("Failed to load settings from backend:", e);
                // 如果后端加载失败，尝试从本地文件加载
                try {
                    const settingsRes = await fetch("/settings.json");
                    const settingsData = await settingsRes.json();
                    setSettings(settingsData);
                } catch (e2) {
                    console.log("Failed to load settings from file:", e2);
                }
            }
            // 加载 Actions 规则
            try {
                const actionsData = await invoke<ActionRule[]>("get_actions_list_cmd");
                setActions(actionsData);
            } catch (e) {
                console.log("Failed to load actions via command, trying fetch:", e);
                try {
                    const actionsRes = await fetch("/actions.json?t=" + Date.now());
                    const actionsData = await actionsRes.json();
                    setActions(actionsData);
                } catch (e2) {
                    console.log("Failed to load actions from file:", e2);
                }
            }
        };
        loadData();
    }, []);

    const handleSave = async () => {
        setSaving(true);
        try {
            // 保存设置
            await invoke("save_settings", { settings: JSON.stringify(settings) });

            // 更新快捷键配置
            console.log("Saving hotkey config:", settings.hotkeys);
            await invoke("update_hotkey_config", {
                triggerKey: settings.hotkeys.trigger_key,
                triggerType: settings.hotkeys.trigger_type,
                triggerInterval: settings.hotkeys.trigger_interval
            });
            console.log("Hotkey config update command sent");

            console.log("Updated hotkey config:", settings.hotkeys);

            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
        } catch (e) {
            console.error("Save failed:", e);
        } finally {
            setSaving(false);
        }
    };



    const addBlacklistApp = () => {
        if (newBlacklistApp.trim() && !settings.ai.blacklist_apps.includes(newBlacklistApp.trim())) {
            setSettings({
                ...settings,
                ai: {
                    ...settings.ai,
                    blacklist_apps: [...settings.ai.blacklist_apps, newBlacklistApp.trim()]
                }
            });
            setNewBlacklistApp("");
        }
    };

    const removeBlacklistApp = (app: string) => {
        setSettings({
            ...settings,
            ai: {
                ...settings.ai,
                blacklist_apps: settings.ai.blacklist_apps.filter(a => a !== app)
            }
        });
    };

    // 保存规则到后端并触发热更新
    const saveActionsToBackend = async (newActions: ActionRule[]) => {
        try {
            await invoke("save_actions", { actions: JSON.stringify(newActions) });
            setActions(newActions);
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
        } catch (e) {
            console.error("Save actions failed:", e);
        }
    };

    // 删除规则
    const deleteAction = async (actionId: string) => {
        const newActions = actions.filter(a => a.meta.id !== actionId);
        await saveActionsToBackend(newActions);
        setEditingAction(null);
    };

    // AI 生成规则
    const generateRuleWithAI = async () => {
        if (!aiRulePrompt.trim()) return;

        setGeneratingRule(true);
        try {
            const result = await invoke<ActionRule | null>("ai_generate_rule", {
                description: aiRulePrompt
            });
            if (result) {
                // 添加到规则列表并保存
                const newActions = [...actions, result];
                await saveActionsToBackend(newActions);
                setAiRulePrompt("");
            }
        } catch (e) {
            console.error("AI rule generation failed:", e);
        } finally {
            setGeneratingRule(false);
        }
    };

    // 提交需求
    const submitRequirement = async () => {
        // 频率限制：10分钟内只能提交一次
        const lastSubmit = localStorage.getItem("last_requirement_submit");
        const now = Date.now();
        if (lastSubmit && now - parseInt(lastSubmit) < 10 * 60 * 1000) {
            const remainingMinutes = Math.ceil((10 * 60 * 1000 - (now - parseInt(lastSubmit))) / 60000);
            alert(`提交过于频繁，请在 ${remainingMinutes} 分钟后再试。`);
            return;
        }

        setSubmitting(true);
        setSubmitSuccess(false);
        setSubmitError(false);

        try {
            const formData = {
                version: softwareVersion || "未填写",
                contact: userEmail,
                budget: budget || "未填写",
                description: requirementDescription
            };

            const response = await fetch("https://formspree.io/f/mzdveoyd", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json"
                },
                body: JSON.stringify(formData)
            });

            if (response.ok) {
                setSubmitSuccess(true);
                localStorage.setItem("last_requirement_submit", now.toString());
                setSoftwareVersion("");
                setUserEmail("");
                setRequirementDescription("");
                setBudget("");
            } else {
                setSubmitError(true);
            }
        } catch (e) {
            console.error("Submit requirement failed:", e);
            setSubmitError(true);
        } finally {
            setSubmitting(false);
        }
    };

    // 安装远程功能 (现在改为文件导入)
    const handleInstallRemoteAction = async () => {
        setInstalling(true);
        setInstallMsg("");
        try {
            // 1. 选择文件
            const selected = await open({
                multiple: false,
                filters: [{
                    name: 'JSON',
                    extensions: ['json']
                }]
            });

            if (!selected) {
                setInstalling(false);
                return;
            }

            // 2. 调用后端导入命令
            const result: string = await invoke("import_actions_cmd", { path: selected });
            setInstallMsg(`✅ ${result}`);

            // 3. 刷新列表
            try {
                const actionsData = await invoke<ActionRule[]>("get_actions_list_cmd");
                setActions(actionsData);
            } catch (e) {
                console.log("Using fallback fetch for actions");
                const actionsRes = await fetch("/actions.json?t=" + Date.now());
                const actionsData = await actionsRes.json();
                setActions(actionsData);
            }
        } catch (e) {
            setInstallMsg(`❌ 导入失败: ${e}`);
        } finally {
            setInstalling(false);
        }
    };

    const tabs = [
        { id: "ai" as TabType, label: "AI 配置", icon: "🤖" },
        { id: "hotkeys" as TabType, label: "快捷键", icon: "⌨️" },
        { id: "actions" as TabType, label: "Actions 规则", icon: "⚡" },
        { id: "requirements" as TabType, label: "需求提交", icon: "💡" },
    ];

    return (
        <div style={{
            height: "100vh",
            backgroundColor: "#0A0A0A",
            color: "#EEE",
            fontFamily: "'Inter', system-ui, sans-serif",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden"
        }}>
            {/* 顶部标题栏 */}
            <div
                data-tauri-drag-region
                style={{
                    height: "44px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "0 16px",
                    backgroundColor: "#0F0F0F",
                    borderBottom: "1px solid #1F1F1F",
                    userSelect: "none"
                }}
            >
                <div
                    data-tauri-drag-region
                    style={{ flex: 1, height: "100%", display: "flex", alignItems: "center", gap: "8px", cursor: "default" }}
                >
                    <div data-tauri-drag-region style={{ width: "12px", height: "12px", backgroundColor: "#3B82F6", borderRadius: "3px" }}></div>
                    <span data-tauri-drag-region style={{ fontSize: "12px", fontWeight: "600", color: "#888", letterSpacing: "0.05em" }}>CTRL-CTRL / SETTINGS</span>
                </div>
                <button
                    onClick={() => getCurrentWindow().hide()}
                    style={{
                        background: "none", border: "none", color: "#666", cursor: "pointer",
                        padding: "4px", borderRadius: "4px", transition: "color 0.2s"
                    }}
                    onMouseEnter={e => e.currentTarget.style.color = "#FFF"}
                    onMouseLeave={e => e.currentTarget.style.color = "#666"}
                >✕</button>
            </div>

            <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
                {/* 侧边导航 */}
                <aside
                    data-tauri-drag-region
                    style={{
                        width: "220px",
                        backgroundColor: "#0F0F0F",
                        borderRight: "1px solid #1F1F1F",
                        padding: "20px 12px",
                        display: "flex",
                        flexDirection: "column",
                        gap: "4px",
                        userSelect: "none"
                    }}
                >
                    {tabs.map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "12px",
                                width: "100%",
                                padding: "10px 16px",
                                borderRadius: "8px",
                                border: "none",
                                textAlign: "left",
                                cursor: "pointer",
                                fontSize: "13px",
                                fontWeight: "550",
                                transition: "all 0.2s",
                                backgroundColor: activeTab === tab.id ? "#1F1F1F" : "transparent",
                                color: activeTab === tab.id ? "#FFF" : "#777",
                                position: "relative"
                            }}
                            onMouseEnter={e => { if (activeTab !== tab.id) e.currentTarget.style.backgroundColor = "#171717"; }}
                            onMouseLeave={e => { if (activeTab !== tab.id) e.currentTarget.style.backgroundColor = "transparent"; }}
                        >
                            {activeTab === tab.id && (
                                <div style={{
                                    position: "absolute", left: "0", top: "20%", bottom: "20%",
                                    width: "3px", backgroundColor: "#3B82F6", borderRadius: "0 4px 4px 0"
                                }}></div>
                            )}
                            <span style={{ opacity: activeTab === tab.id ? 1 : 0.7 }}>{tab.icon}</span>
                            <span>{tab.label}</span>
                        </button>
                    ))}
                </aside>

                {/* 主内容区域 */}
                <main style={{
                    flex: 1,
                    overflowY: "auto",
                    padding: "40px",
                    backgroundColor: "#0A0A0A"
                }}>
                    <div style={{ maxWidth: "680px", margin: "0 auto", paddingBottom: "100px" }}>

                        {/* AI 配置标签页 */}
                        {activeTab === "ai" && (
                            <div style={{ display: "flex", flexDirection: "column", gap: "32px" }}>
                                <section>
                                    <h2 style={{ fontSize: "20px", fontWeight: "600", marginBottom: "24px" }}>AI 核心配置</h2>
                                    <UI.Card>
                                        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                                            <div>
                                                <UI.Label>API Key</UI.Label>
                                                <UI.Input
                                                    type="password"
                                                    value={settings.ai.api_key}
                                                    onChange={(e) => setSettings({ ...settings, ai: { ...settings.ai, api_key: e.target.value } })}
                                                    placeholder="输入您的 OpenAI 或兼容服务的 API Key"
                                                />
                                            </div>

                                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                                                <div>
                                                    <UI.Label>Base URL</UI.Label>
                                                    <UI.Input
                                                        type="text"
                                                        value={settings.ai.base_url}
                                                        onChange={(e) => setSettings({ ...settings, ai: { ...settings.ai, base_url: e.target.value } })}
                                                    />
                                                </div>
                                                <div>
                                                    <UI.Label>模型名称</UI.Label>
                                                    <UI.Input
                                                        type="text"
                                                        value={settings.ai.model}
                                                        onChange={(e) => setSettings({ ...settings, ai: { ...settings.ai, model: e.target.value } })}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </UI.Card>
                                </section>

                                <section>
                                    <h2 style={{ fontSize: "18px", fontWeight: "600", marginBottom: "5px" }}>应用黑名单</h2>
                                    <p style={{ fontSize: "13px", color: "#666", marginBottom: "16px" }}>在以下应用中，快捷操作和 AI 功能将被自动禁用以保护您的隐私。</p>
                                    <UI.Card style={{ padding: "16px" }}>
                                        <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
                                            <UI.Input
                                                value={newBlacklistApp}
                                                onChange={(e) => setNewBlacklistApp(e.target.value)}
                                                onKeyDown={(e) => e.key === "Enter" && addBlacklistApp()}
                                                placeholder="例如: chrome.exe"
                                                style={{ flex: 1 }}
                                            />
                                            <UI.Button onClick={addBlacklistApp}>添加</UI.Button>
                                        </div>
                                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                                            {settings.ai.blacklist_apps.map((app, i) => (
                                                <div key={i} style={{
                                                    display: "flex", alignItems: "center", justifyContent: "space-between",
                                                    padding: "8px 12px", backgroundColor: "#0A0A0A", borderRadius: "8px", border: "1px solid #1F1F1F"
                                                }}>
                                                    <span style={{ fontSize: "13px", color: "#AAA", fontFamily: "monospace" }}>{app}</span>
                                                    <button onClick={() => removeBlacklistApp(app)} style={{
                                                        background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: "14px"
                                                    }} onMouseEnter={e => e.currentTarget.style.color = "#F87171"} onMouseLeave={e => e.currentTarget.style.color = "#555"}>✕</button>
                                                </div>
                                            ))}
                                            {settings.ai.blacklist_apps.length === 0 && (
                                                <div style={{ gridColumn: "1/-1", textAlign: "center", color: "#444", padding: "20px 0", fontSize: "13px" }}>暂无黑名单应用</div>
                                            )}
                                        </div>
                                    </UI.Card>
                                </section>
                            </div>
                        )}

                        {/* 快捷键配置标签页 */}
                        {activeTab === "hotkeys" && (
                            <div style={{ display: "flex", flexDirection: "column", gap: "32px" }}>
                                <section>
                                    <h2 style={{ fontSize: "20px", fontWeight: "600", marginBottom: "24px" }}>全局唤醒设置</h2>
                                    <UI.Card>
                                        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
                                            <div>
                                                <UI.Label>触发方式控制</UI.Label>
                                                <div style={{ display: "flex", gap: "10px" }}>
                                                    <select
                                                        value={settings.hotkeys.trigger_type}
                                                        onChange={(e) => setSettings({
                                                            ...settings,
                                                            hotkeys: { ...settings.hotkeys, trigger_type: e.target.value as any }
                                                        })}
                                                        style={{
                                                            flex: 1, backgroundColor: "#0A0A0A", border: "1px solid #262626",
                                                            borderRadius: "8px", padding: "10px 14px", color: "#EEE", fontSize: "14px", outline: "none"
                                                        }}
                                                    >
                                                        <option value="double_press">功能键双击</option>
                                                        <option value="select_move">选区后鼠标移动</option>
                                                    </select>

                                                    {settings.hotkeys.trigger_type === "double_press" && (
                                                        <select
                                                            value={settings.hotkeys.trigger_key}
                                                            onChange={(e) => setSettings({
                                                                ...settings,
                                                                hotkeys: { ...settings.hotkeys, trigger_key: e.target.value }
                                                            })}
                                                            style={{
                                                                width: "120px", backgroundColor: "#0A0A0A", border: "1px solid #262626",
                                                                borderRadius: "8px", padding: "10px 14px", color: "#EEE", fontSize: "14px", outline: "none"
                                                            }}
                                                        >
                                                            <option value="Ctrl">Ctrl</option>
                                                            <option value="Shift">Shift</option>
                                                            <option value="Alt">Alt</option>
                                                        </select>
                                                    )}
                                                </div>
                                            </div>

                                            {settings.hotkeys.trigger_type === "double_press" && (
                                                <div>
                                                    <UI.Label>双击判定间隔 (ms)</UI.Label>
                                                    <UI.Input
                                                        type="number"
                                                        value={settings.hotkeys.trigger_interval}
                                                        onChange={(e) => setSettings({
                                                            ...settings,
                                                            hotkeys: { ...settings.hotkeys, trigger_interval: parseInt(e.target.value) || 400 }
                                                        })}
                                                        min="100" max="2000" step="50"
                                                    />
                                                    <p style={{ fontSize: "12px", color: "#555", marginTop: "8px" }}>建议设为 300ms - 500ms 之间，以获得最佳手感。</p>
                                                </div>
                                            )}

                                            <div style={{
                                                marginTop: "8px", padding: "16px", backgroundColor: "rgba(59, 130, 246, 0.05)",
                                                borderRadius: "8px", border: "1px solid rgba(59, 130, 246, 0.1)"
                                            }}>
                                                <div style={{ fontSize: "12px", color: "#3B82F6", fontWeight: "600", marginBottom: "4px", textTransform: "uppercase" }}>当前生效配置</div>
                                                <div style={{ fontSize: "15px", color: "#DDD" }}>
                                                    {settings.hotkeys.trigger_type === "double_press"
                                                        ? `连按两次 ${settings.hotkeys.trigger_key} (间隔 < ${settings.hotkeys.trigger_interval}ms)`
                                                        : `选中文本后鼠标大幅移动`}
                                                </div>
                                            </div>
                                        </div>
                                    </UI.Card>
                                </section>

                                <div style={{
                                    display: "flex", gap: "12px", padding: "16px", backgroundColor: "rgba(34, 197, 94, 0.05)",
                                    borderRadius: "12px", border: "1px solid rgba(34, 197, 94, 0.1)"
                                }}>
                                    <span style={{ color: "#22C55E" }}>✨</span>
                                    <div style={{ fontSize: "13px", lineHeight: "1.5" }}>
                                        <div style={{ color: "#4ADE80", fontWeight: "600" }}>快捷键监听已就绪</div>
                                        <div style={{ color: "#666" }}>若修改后未实时生效，请尝试保存设置并重启软件。</div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* 功能规则标签页 */}
                        {activeTab === "actions" && (
                            <div style={{ display: "flex", flexDirection: "column", gap: "32px" }}>
                                <section>
                                    <h2 style={{ fontSize: "20px", fontWeight: "600", marginBottom: "5px" }}>功能规则管理</h2>
                                    <p style={{ fontSize: "13px", color: "#666", marginBottom: "24px" }}>根据选中文本的内容（正则表达式）自动触发不同的快捷操作。</p>

                                    {/* AI 智能生成 */}
                                    <div style={{ display: "flex", gap: "12px", alignItems: "center", marginBottom: "24px" }}>
                                        <UI.Input
                                            value={aiRulePrompt}
                                            onChange={(e) => setAiRulePrompt(e.target.value)}
                                            onKeyDown={(e) => e.key === "Enter" && generateRuleWithAI()}
                                            placeholder="例如：翻译选中的英文单词到中文..."
                                            style={{ flex: 1 }}
                                        />
                                        <UI.Button onClick={generateRuleWithAI} disabled={generatingRule}>
                                            {generatingRule ? "生成中..." : "AI 智能生成"}
                                        </UI.Button>
                                    </div>

                                    {/* 功能规则导入 */}
                                    <div style={{ marginBottom: "32px" }}>
                                        <UI.Label>导入功能配置 (JSON 文件)</UI.Label>
                                        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                                            <div style={{
                                                flex: 1,
                                                padding: "10px 14px",
                                                backgroundColor: "#0A0A0A",
                                                border: "1px solid #262626",
                                                borderRadius: "8px",
                                                fontSize: "13px",
                                                color: "#555",
                                                cursor: "default"
                                            }}>
                                                支持导入单条规则或批量规则 JSON 数组
                                            </div>
                                            <UI.Button onClick={handleInstallRemoteAction} disabled={installing} style={{ backgroundColor: "#10B981" }}>
                                                {installing ? "正在解析..." : "📂 选择并导入"}
                                            </UI.Button>
                                        </div>
                                        {installMsg && <p style={{ fontSize: "12px", marginTop: "8px", color: installMsg.includes("✅") ? "#10B981" : "#EF4444" }}>{installMsg}</p>}
                                    </div>

                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                                        <h3 style={{ fontSize: "14px", fontWeight: "600", color: "#888" }}>现有规则库</h3>
                                        <UI.Button variant="secondary" onClick={() => setEditingAction({
                                            meta: { id: Date.now().toString(), name: "新规则项目", version: "1.0.0" },
                                            scope: { include: ["*"], priority: 1 },
                                            trigger: { type: "regex", pattern: "" },
                                            action: { type: "url", template: "" }
                                        })} style={{ padding: "6px 14px", fontSize: "12px" }}>+ 新增规则</UI.Button>
                                    </div>

                                    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                                        {actions.map((action) => (
                                            <div
                                                key={action.meta.id}
                                                onClick={() => setEditingAction(action)}
                                                style={{
                                                    display: "flex", alignItems: "center", gap: "6px",
                                                    padding: "6px 12px", backgroundColor: "#171717", borderRadius: "100px", border: "1px solid #262626",
                                                    cursor: "pointer", transition: "all 0.2s", whiteSpace: "nowrap"
                                                }}
                                                onMouseEnter={e => { e.currentTarget.style.borderColor = "#3B82F6"; e.currentTarget.style.backgroundColor = "#1F1F1F"; }}
                                                onMouseLeave={e => { e.currentTarget.style.borderColor = "#262626"; e.currentTarget.style.backgroundColor = "#171717"; }}
                                            >
                                                <span style={{ fontSize: "12px" }}>{action.action.type === "url" ? "🔗" : "⚡"}</span>
                                                <span style={{ fontSize: "13px", fontWeight: "500", color: "#EEE" }}>{action.meta.name}</span>
                                                <span style={{ fontSize: "11px", color: "#555", marginLeft: "4px" }}>编辑</span>
                                            </div>
                                        ))}
                                        {actions.length === 0 && (
                                            <div style={{ width: "100%", textAlign: "center", color: "#444", padding: "20px 0", fontSize: "13px" }}>暂无规则</div>
                                        )}
                                    </div>
                                </section>
                            </div>
                        )}

                        {/* 需求提交标签页 */}
                        {activeTab === "requirements" && (
                            <div style={{ display: "flex", flexDirection: "column", gap: "32px" }}>
                                <section>
                                    <h2 style={{ fontSize: "20px", fontWeight: "600", marginBottom: "5px" }}>需求定制与建议</h2>
                                    <p style={{ fontSize: "13px", color: "#666", marginBottom: "24px" }}>如果您有个性化的功能需求，欢迎提交。我们会评估需求并提供定制服务。</p>

                                    <UI.Card style={{ backgroundColor: "rgba(139, 92, 246, 0.05)", borderColor: "rgba(139, 92, 246, 0.1)" }}>
                                        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                                            <div>
                                                <UI.Label>需求场景建议</UI.Label>
                                                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                                                    {[
                                                        "提取特定格式的数据 (如发票、快递单)",
                                                        "自动填表 / 数据搬运",
                                                        "特定软件的快捷流 (如写代码辅助)",
                                                        "复杂的文本清洗与转换",
                                                        "集成公司内部的 API 接口"
                                                    ].map((s, i) => (
                                                        <button
                                                            key={i}
                                                            onClick={() => setRequirementDescription(prev => (prev ? prev + "\n" : "") + `[场景: ${s}] `)}
                                                            style={{
                                                                padding: "6px 12px", fontSize: "12px", backgroundColor: "rgba(139, 92, 246, 0.1)",
                                                                border: "1px solid rgba(139, 92, 246, 0.2)", borderRadius: "6px", color: "#A78BFA", cursor: "pointer"
                                                            }}
                                                        >
                                                            + {s}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                            <div>
                                                <UI.Label>您的联系方式</UI.Label>
                                                <UI.Input type="text" value={userEmail} onChange={e => setUserEmail(e.target.value)} placeholder="微信、邮箱或手机号" />
                                            </div>
                                            <div>
                                                <UI.Label>详细需求描述 (越详细，AI 生成越准确)</UI.Label>
                                                <textarea
                                                    value={requirementDescription}
                                                    onChange={e => setRequirementDescription(e.target.value)}
                                                    placeholder="请描述：在什么软件下 -> 选中什么文本 -> 得到什么结果..."
                                                    style={{
                                                        width: "100%", backgroundColor: "#0A0A0A", border: "1px solid #262626", borderRadius: "8px",
                                                        padding: "10px 14px", color: "#EEE", fontSize: "14px", outline: "none", minHeight: "120px", resize: "vertical"
                                                    }}
                                                />
                                            </div>
                                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                                                <div>
                                                    <UI.Label>预期预算 (可选)</UI.Label>
                                                    <UI.Input value={budget} onChange={e => setBudget(e.target.value)} placeholder="例如: 50-200" />
                                                </div>
                                                <div>
                                                    <UI.Label>您的软件版本</UI.Label>
                                                    <UI.Input value={softwareVersion} onChange={e => setSoftwareVersion(e.target.value)} placeholder="v1.0.0" />
                                                </div>
                                            </div>
                                            <UI.Button
                                                onClick={submitRequirement}
                                                disabled={submitting || !requirementDescription.trim() || !userEmail.trim()}
                                                style={{ marginTop: "8px", width: "100%", backgroundColor: "#8B5CF6" }}
                                            >
                                                {submitting ? "正在提交..." : "📤 提交定制需求"}
                                            </UI.Button>
                                        </div>
                                    </UI.Card>

                                    {(submitSuccess || submitError) && (
                                        <div style={{
                                            marginTop: "16px", padding: "12px 16px", borderRadius: "8px", fontSize: "13px",
                                            backgroundColor: submitSuccess ? "rgba(34, 197, 94, 0.1)" : "rgba(239, 68, 68, 0.1)",
                                            border: `1px solid ${submitSuccess ? "rgba(34, 197, 94, 0.2)" : "rgba(239, 68, 68, 0.2)"}`,
                                            color: submitSuccess ? "#4ADE80" : "#F87171",
                                            display: "flex", alignItems: "center", gap: "8px"
                                        }}>
                                            {submitSuccess ? "✅ 提交成功！我们会尽快联系您。" : "❌ 提交失败，请检查网络或稍后重试。"}
                                        </div>
                                    )}
                                </section>
                            </div>
                        )}
                    </div>
                </main>
            </div>

            {/* ================= 编辑弹窗 (Modal) ================= */}
            {editingAction && (
                <div style={{
                    position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.8)",
                    backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100
                }}>
                    <div style={{
                        backgroundColor: "#171717", border: "1px solid #262626", borderRadius: "20px",
                        padding: "32px", width: "520px", boxShadow: "0 25px 50px -12px rgba(0,0,0,0.5)"
                    }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
                            <h3 style={{ margin: 0, fontSize: "20px", fontWeight: "700" }}>编辑规则项目</h3>
                            <button onClick={() => setEditingAction(null)} style={{ background: "none", border: "none", color: "#666", cursor: "pointer", fontSize: "20px" }}>✕</button>
                        </div>

                        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                            <div>
                                <UI.Label>规则名称</UI.Label>
                                <UI.Input value={editingAction.meta.name} onChange={e => setEditingAction({ ...editingAction, meta: { ...editingAction.meta, name: e.target.value } })} />
                            </div>

                            <div>
                                <UI.Label>正则表达式 (匹配内容)</UI.Label>
                                <UI.Input style={{ fontFamily: "monospace" }} value={editingAction.trigger.pattern} onChange={e => setEditingAction({ ...editingAction, trigger: { ...editingAction.trigger, pattern: e.target.value } })} placeholder="例如: ^BV[a-zA-Z0-9]+$" />
                            </div>

                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                                <div>
                                    <UI.Label>操作类型</UI.Label>
                                    <select
                                        value={editingAction.action.type}
                                        onChange={e => setEditingAction({ ...editingAction, action: { ...editingAction.action, type: e.target.value } })}
                                        style={{ width: "100%", backgroundColor: "#0A0A0A", border: "1px solid #262626", borderRadius: "8px", padding: "10px 14px", color: "#EEE", fontSize: "14px", outline: "none" }}
                                    >
                                        <option value="url">🔗 URL 跳转</option>
                                        <option value="path">📁 打开本地路径</option>
                                        <option value="script">🛠️ 执行自定义脚本 (Python/Shell)</option>
                                        <option value="ai_translate">翻译 (AI)</option>
                                        <option value="ai_summarize">总结 (AI)</option>
                                        <option value="ai_custom">直连 AI (自定义 Prompt)</option>
                                    </select>
                                </div>
                                <div>
                                    <UI.Label>执行优先级</UI.Label>
                                    <UI.Input type="number" value={editingAction.scope.priority} onChange={e => setEditingAction({ ...editingAction, scope: { ...editingAction.scope, priority: parseInt(e.target.value) || 0 } })} />
                                </div>
                            </div>

                            <div>
                                <UI.Label>{editingAction.action.type === "script" ? "脚本路径 / 命令" : "操作模板"}</UI.Label>
                                <UI.Input
                                    value={editingAction.action.type === "script" ? (editingAction.action.script_path || editingAction.action.template) : editingAction.action.template}
                                    onChange={e => {
                                        if (editingAction.action.type === "script") {
                                            setEditingAction({ ...editingAction, action: { ...editingAction.action, script_path: e.target.value, template: e.target.value } });
                                        } else {
                                            setEditingAction({ ...editingAction, action: { ...editingAction.action, template: e.target.value } });
                                        }
                                    }}
                                    placeholder={editingAction.action.type === "script" ? "例如: scripts/format.py 或 python" : "https://example.com/search?q=${0}"}
                                />
                                <p style={{ fontSize: "12px", color: "#555", marginTop: "8px" }}>
                                    {editingAction.action.type === "script"
                                        ? "指定本地脚本路径。主程序会自动将选中文本作为最后一个参数传入。"
                                        : "使用 ${0} 作为被选中内容的占位符。"}
                                </p>
                            </div>

                            {editingAction.action.type === "script" && (
                                <div>
                                    <UI.Label>脚本参数 (JSON 数组格式, 可选)</UI.Label>
                                    <UI.Input
                                        value={JSON.stringify(editingAction.action.arguments || [])}
                                        onChange={e => {
                                            try {
                                                const args = JSON.parse(e.target.value);
                                                if (Array.isArray(args)) {
                                                    setEditingAction({ ...editingAction, action: { ...editingAction.action, arguments: args } });
                                                }
                                            } catch (e) {
                                                // 仅在格式正确时更新
                                            }
                                        }}
                                        placeholder='例如: ["--debug", "--mode", "fast"]'
                                    />
                                </div>
                            )}
                        </div>

                        <div style={{ display: "flex", gap: "12px", marginTop: "32px" }}>
                            <UI.Button variant="secondary" onClick={() => setEditingAction(null)} style={{ flex: 1 }}>取消</UI.Button>
                            <UI.Button variant="danger" onClick={() => deleteAction(editingAction.meta.id)} style={{ flex: 1 }}>删除</UI.Button>
                            <UI.Button onClick={async () => {
                                const idx = actions.findIndex(a => a.meta.id === editingAction.meta.id);
                                let newActions = idx >= 0 ? [...actions] : [...actions, editingAction];
                                if (idx >= 0) newActions[idx] = editingAction;
                                await saveActionsToBackend(newActions);
                                setEditingAction(null);
                            }} style={{ flex: 1.5 }}>完成并保存</UI.Button>
                        </div>
                    </div>
                </div>
            )}

            {/* 全局操作页脚 */}
            <div style={{
                padding: "20px 40px",
                backgroundColor: "#0F0F0F",
                borderTop: "1px solid #1F1F1F",
                display: "flex",
                justifyContent: "flex-end",
                alignItems: "center",
                gap: "16px",
                zIndex: 10
            }}>
                {saved && <span style={{ fontSize: "13px", color: "#22C55E", fontWeight: "500" }}>配置已同步 ✓</span>}
                <UI.Button
                    onClick={handleSave}
                    disabled={saving}
                    style={{
                        padding: "10px 32px",
                        minWidth: "140px",
                        backgroundColor: saved ? "#22C55E" : "#3B82F6"
                    }}
                >
                    {saving ? "正在计算..." : saved ? "保存成功" : "保存所有更改"}
                </UI.Button>
            </div>
        </div>
    );
};
