import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface ActionMeta {
    id: string;
    name: string;
}
interface ActionDef {
    type: string;
    template: string;
    script_path?: string;
    arguments?: string[];
}
interface ActionTrigger {
    type: string;
    pattern: string;
    extraction_pattern?: string;
}
interface ContextAction {
    meta: ActionMeta;
    trigger: ActionTrigger;
    action: ActionDef;
}
interface AiResult {
    result: string;
    action_type: string;
}

interface ActionPopupProps {
    actions: ContextAction[];
    capturedText: string;
    initialAiResult: AiResult | null;
}

// 获取操作对应的图标
const getActionIcon = (actionType: string): string => {
    switch (actionType) {
        case "url": return "🔗";
        case "path": return "📁";
        case "doi_scihub": return "📚";
        case "ai_translate": return "🌐";
        case "ai_summarize": return "📝";
        case "ai_process": return "✨";
        case "local_format": return "📋";
        case "script": return "🛠️";
        default: return "⚙️";
    }
};

export const ActionPopup = ({ actions, capturedText, initialAiResult }: ActionPopupProps) => {
    const [aiResult, setAiResult] = useState<AiResult | null>(initialAiResult);
    const [loading, setLoading] = useState(false);
    const [copied, setCopied] = useState(false);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
    // 当props变化时重置状态
    useEffect(() => {
        console.log("[ActionPopup] Props changed, resetting state. initialAiResult:", initialAiResult);
        setAiResult(initialAiResult);
        setLoading(false);
        setCopied(false);
        setSelectedIndex(0);
        setHoveredIndex(null);

        // 重置窗口大小到长条模式
        if (!initialAiResult) {
            console.log("[ActionPopup] No initial result, resetting to 500x64");
            invoke("adjust_window_size", { label: "popup", width: 500, height: 64 });
        }
    }, [actions, capturedText, initialAiResult]);

    // 根据内容动态调整窗口高度
    useEffect(() => {
        if (aiResult) {
            // 获取屏幕高度，最大高度为屏幕的 80%
            const screenHeight = window.screen.availHeight;
            const maxHeight = Math.floor(screenHeight * 0.8);

            // 估算文本需要的高度
            const text = aiResult.result;
            const lines = text.split('\n');
            let estimatedLineCount = 0;

            lines.forEach(line => {
                // 假设窗口宽度 500px，内容区域 padding 约 32px，剩余 468px
                // 14px 字体，平均每个字符约 8-9px (考虑到中英文混合)
                // 468 / 8.5 ≈ 55 个字符换行
                estimatedLineCount += Math.ceil(Math.max(1, line.length) / 55);
            });

            const textLineHeight = 22.4; // 恢复到标准的 1.6 * 14px
            const textHeight = estimatedLineCount * textLineHeight;
            // 加上上下 padding(24px) + 底部按钮区域(32px) + 小量余量
            const totalHeight = textHeight + 60;

            // 限制在 80 到 屏幕80% 之间
            const finalHeight = Math.floor(Math.max(80, Math.min(maxHeight, totalHeight)));
            console.log(`[ActionPopup] Resizing to: 500x${finalHeight} for aiResult:`, aiResult.action_type);
            invoke("adjust_window_size", { label: "popup", width: 500, height: finalHeight });
        }
    }, [aiResult]);

    // 失去焦点后关闭窗口
    useEffect(() => {
        const handleBlur = async () => {
            await getCurrentWindow().hide();
        };
        window.addEventListener("blur", handleBlur);
        return () => window.removeEventListener("blur", handleBlur);
    }, []);

    useEffect(() => {
        const handleKeyDown = async (e: KeyboardEvent) => {
            // 数字键快速选择
            if (e.key >= "1" && e.key <= "9") {
                const index = parseInt(e.key) - 1;
                if (index < actions.length) {
                    await handleAction(actions[index]);
                }
            }
            // ESC 关闭
            if (e.key === "Escape") {
                await getCurrentWindow().hide();
            }
            // Enter 键：在结果页复制，在选择页执行选中项
            if (e.key === "Enter") {
                if (aiResult) {
                    await handleCopy();
                } else if (actions.length > 0) {
                    await handleAction(actions[selectedIndex]);
                }
            }
            // 左右方向键导航
            if (e.key === "ArrowLeft") {
                e.preventDefault();
                setSelectedIndex(i => Math.max(0, i - 1));
            }
            if (e.key === "ArrowRight") {
                e.preventDefault();
                setSelectedIndex(i => Math.min(actions.length - 1, i + 1));
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [actions, aiResult, selectedIndex]);

    const handleAction = async (action: ContextAction) => {
        const type = action.action.type;

        if (type === "url") {
            let url: string;
            // 优先从 extraction_pattern 提取内容
            let targetText = capturedText;
            if (action.trigger?.extraction_pattern) {
                console.log("[ActionPopup] Extraction pattern found:", action.trigger.extraction_pattern);
                try {
                    const regex = new RegExp(action.trigger.extraction_pattern);
                    const match = targetText.match(regex);
                    console.log("[ActionPopup] Match result:", match);
                    if (match) {
                        targetText = match[0];
                        console.log("[ActionPopup] Extracted text:", targetText);
                    }
                } catch (e) {
                    console.error("[ActionPopup] Extraction failed:", e);
                }
            }

            // 如果模板就是${0}，直接使用提取后的文本
            if (action.action.template === "${0}") {
                url = targetText;
            } else {
                // 否则替换模板中的${0}占位符，并进行URL编码
                url = action.action.template.replace("${0}", encodeURIComponent(targetText));
            }
            console.log("[ActionPopup] Opening URL:", url);
            await invoke("open_url", { url });
            await getCurrentWindow().hide();
        } else if (type === "path") {
            await invoke("open_path", { path: capturedText.trim() });
            await getCurrentWindow().hide();
        } else if (type === "doi_scihub") {
            // 提取 DOI
            let doi = capturedText.trim();
            if (action.trigger?.extraction_pattern) {
                try {
                    const regex = new RegExp(action.trigger.extraction_pattern);
                    const match = doi.match(regex);
                    if (match) {
                        doi = match[0];
                    }
                } catch (e) {
                    console.error("[ActionPopup] DOI extraction failed:", e);
                }
            }
            console.log("[ActionPopup] Opening DOI with Sci-Hub:", doi);
            await invoke("open_doi_scihub", { doi, urlIndex: 0 });
            await getCurrentWindow().hide();
        } else if (type === "local_format") {
            // 本地排版：显示loading状态，让用户知道正在处理
            setLoading(true);
            try {
                const res: any = await invoke("local_format_text", { text: capturedText });
                if (res) setAiResult(res);
            } finally {
                setLoading(false);
            }
        } else if (type.startsWith("ai_")) {
            setLoading(true);
            try {
                let res: any = null;
                if (type === "ai_translate") {
                    res = await invoke("ai_translate", { text: capturedText });
                } else if (type === "ai_summarize") {
                    res = await invoke("ai_summarize", { text: capturedText });
                } else if (type === "ai_process") {
                    res = await invoke("ai_process", { text: capturedText, intent: action.action.template });
                }
                if (res) setAiResult(res);
            } finally {
                setLoading(false);
            }
        } else if (type === "script") {
            setLoading(true);
            try {
                const res: any = await invoke("execute_script", {
                    scriptPath: action.action.script_path || action.action.template,
                    arguments: action.action.arguments || [],
                    sourceText: capturedText
                });
                if (res) setAiResult(res);
            } catch (e) {
                console.error("[ActionPopup] Script execution failed:", e);
                setAiResult({
                    result: `脚本执行失败:\n${e}`,
                    action_type: "error",
                    source_text: capturedText
                } as any);
            } finally {
                setLoading(false);
            }
        }
    };

    const handleCopy = async () => {
        if (aiResult) {
            await navigator.clipboard.writeText(aiResult.result);
            setCopied(true);
            setTimeout(async () => {
                await getCurrentWindow().hide();
            }, 300);
        }
    };



    const cardStyle: React.CSSProperties = {
        width: "100%",
        height: "100%",
        backgroundColor: "rgba(0, 0, 0, 0.9)",
        backdropFilter: "blur(24px)",
        border: "1px solid rgba(255, 255, 255, 0.1)",
        borderRadius: "12px",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)"
    };

    // Result view - 直接显示完整内容
    if (aiResult) {
        return (
            <div style={cardStyle}>
                <div style={{
                    display: "flex",
                    flexDirection: "column",
                    height: "100%"
                }}>
                    {/* 内容区域 - 可滚动但隐藏滚动条 */}
                    <div style={{
                        flex: 1,
                        overflowY: "auto",
                        padding: "12px 16px",
                        scrollbarWidth: "none",  // Firefox
                        msOverflowStyle: "none"  // IE/Edge
                    } as React.CSSProperties}>
                        <p style={{
                            margin: 0,
                            fontSize: "14px",
                            lineHeight: "1.6",
                            color: "#e5e5e5",
                            whiteSpace: "pre-wrap"
                        }}>
                            {aiResult.result}
                        </p>
                    </div>

                    {/* 底部复制按钮 */}
                    <div style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "flex-end",
                        padding: "10px 16px",
                        background: "linear-gradient(to top, rgba(0,0,0,0.4), transparent)",
                        borderTop: "1px solid rgba(255,255,255,0.06)"
                    }}>
                        <button
                            onClick={handleCopy}
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "6px",
                                padding: "6px 14px",
                                borderRadius: "8px",
                                border: "1px solid rgba(255,255,255,0.15)",
                                fontSize: "12px",
                                fontWeight: "600",
                                cursor: "pointer",
                                backgroundColor: copied ? "rgba(34, 197, 94, 0.2)" : "rgba(255, 255, 255, 0.9)",
                                color: copied ? "#4ade80" : "#000",
                                borderColor: copied ? "rgba(34, 197, 94, 0.4)" : "rgba(255, 255, 255, 0.1)",
                                boxShadow: copied ? "0 4px 12px rgba(34, 197, 94, 0.2)" : "0 4px 12px rgba(0, 0, 0, 0.1)",
                                transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
                                transform: "scale(1)"
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.transform = "scale(1.02)";
                                if (!copied) e.currentTarget.style.backgroundColor = "#fff";
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.transform = "scale(1)";
                                if (!copied) e.currentTarget.style.backgroundColor = "rgba(255, 255, 255, 0.9)";
                            }}
                        >
                            {copied ? (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="20 6 9 17 4 12"></polyline>
                                </svg>
                            ) : (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                                </svg>
                            )}
                            {copied ? "已复制" : "复制"}
                        </button>
                    </div>
                </div>
            </div>
        );
    }


    // Action selection view - 横向长条图标按钮
    return (
        <div style={{ ...cardStyle, position: "relative" }}>
            <div style={{
                display: "flex",
                alignItems: "center",
                padding: "6px 8px",
                gap: "6px",
                height: "100%"
            }}>
                {actions.map((action, i) => (
                    <button
                        key={i}
                        onClick={() => handleAction(action)}
                        onMouseEnter={() => {
                            setSelectedIndex(i);
                            setHoveredIndex(i);
                        }}
                        onMouseLeave={() => setHoveredIndex(null)}
                        disabled={loading}
                        style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            minWidth: "48px",
                            height: "48px",
                            padding: "0 10px",
                            backgroundColor: i === selectedIndex ? "rgba(59, 130, 246, 0.2)" : "rgba(255,255,255,0.05)",
                            border: i === selectedIndex ? "1px solid rgba(59, 130, 246, 0.4)" : "1px solid rgba(255,255,255,0.1)",
                            borderRadius: "8px",
                            cursor: "pointer",
                            transition: "all 0.15s",
                            position: "relative"
                        }}
                        title={action.meta.name}
                    >
                        <span style={{ fontSize: "20px" }}>{getActionIcon(action.action.type)}</span>

                        {/* 悬停时显示提示 */}
                        {hoveredIndex === i && (
                            <div style={{
                                position: "absolute",
                                bottom: "100%",
                                left: "50%",
                                transform: "translateX(-50%)",
                                marginBottom: "6px",
                                padding: "4px 8px",
                                backgroundColor: "rgba(0,0,0,0.9)",
                                color: "#fff",
                                fontSize: "11px",
                                borderRadius: "4px",
                                whiteSpace: "nowrap",
                                zIndex: 10,
                                pointerEvents: "none"
                            }}>
                                {action.meta.name}
                            </div>
                        )}
                    </button>
                ))}
            </div>

            {/* Loading overlay */}
            {loading && (
                <div style={{
                    position: "absolute",
                    inset: 0,
                    backgroundColor: "rgba(0,0,0,0.7)",
                    backdropFilter: "blur(4px)",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "8px",
                    borderRadius: "12px"
                }}>
                    <div style={{
                        width: "24px",
                        height: "24px",
                        border: "2px solid rgba(59, 130, 246, 0.3)",
                        borderTopColor: "#3b82f6",
                        borderRadius: "50%",
                        animation: "spin 0.8s linear infinite"
                    }} />
                </div>
            )}

            <style>{`
                @keyframes spin {
                    to { transform: rotate(360deg); }
                }
            `}</style>
        </div>
    );
};
