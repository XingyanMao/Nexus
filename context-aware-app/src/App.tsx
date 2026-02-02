import { useState, useEffect, useCallback, useRef } from "react";
import "./App.css";
import { invoke } from "@tauri-apps/api/core";
import { listen, emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Settings } from "./components/Settings";
import { ActionPopup } from "./components/ActionPopup";

function App() {
  const [windowLabel, setWindowLabel] = useState<string | null>(null);
  const [popupData, setPopupData] = useState<{
    actions: any[];
    capturedText: string;
    aiResult: any | null;
  } | null>(null);
  // const [mousePosition, setMousePosition] = useState<{ x: number; y: number } | null>(null); // Removed
  const isProcessing = useRef(false);

  useEffect(() => {
    const label = getCurrentWindow().label;
    setWindowLabel(label);
    console.log("[App] Window initialized, label:", label);
    console.log("[App] Full window info:", getCurrentWindow());

    // 如果是main窗口，初始化后立即隐藏
    if (label === "main") {
      getCurrentWindow().hide().catch(err => {
        console.error("[App] Failed to hide main window:", err);
      });
    }
  }, []);

  // Global event listener for all windows
  useEffect(() => {
    console.log("[App] Setting up event listeners...");

    // 全局监听trigger-spotlight事件，用于调试
    const unlistenSpotlightGlobal = listen<{ x: number; y: number }>("trigger-spotlight", (event) => {
      console.log("[App] [GLOBAL] trigger-spotlight received:", event.payload);
    });

    const unlistenTrigger = listen<any>("trigger-selection", (event) => {
      console.log("[App] Received trigger-selection:", event.payload);
      // Only popup window should handle this
      if (getCurrentWindow().label === "popup") {
        setPopupData(event.payload);
      }
    });

    return () => {
      unlistenSpotlightGlobal.then(f => f());
      unlistenTrigger.then(f => f());
    };
  }, []);

  const runSelectionProcess = useCallback(async (position?: { x: number; y: number }) => {
    // 防抖：避免重复调用
    if (isProcessing.current) {
      console.log("[App] runSelectionProcess skipped - already processing");
      return;
    }
    isProcessing.current = true;

    try {
      console.log("[App] runSelectionProcess called", position);

      // 获取数据（正则匹配很快，AI 意图识别会慢一些）
      const result = await invoke<any>("process_selection");
      console.log("[App] process_selection result:", result);

      if (result && result.actions && result.actions.length > 0) {
        // 设置popup窗口位置（如果有的话）
        if (position) {
          await invoke("set_popup_position", {
            x: position.x,
            y: position.y
          });
        }
        // 显示弹窗并发送数据
        await invoke("set_window_visibility", { label: "popup", visible: true });
        const payload = {
          actions: result.actions,
          capturedText: result.captured_text,
          aiResult: result.ai_result
        };
        console.log("[App] Emitting trigger-selection with payload:", payload);
        await emit("trigger-selection", payload);
      } else {
        console.log("[App] No result or no actions");
      }
    } catch (e) {
      console.error("[App] Selection process failed:", e);
    } finally {
      isProcessing.current = false;
      console.log("[App] isProcessing reset to false");
    }
  }, []);

  // Listen for spotlight trigger - only in main window
  useEffect(() => {
    console.log("[App] Setting up spotlight listener, windowLabel:", windowLabel);
    // 只在 main 窗口中监听 spotlight 事件，避免重复调用
    if (windowLabel !== "main") {
      console.log("[App] Skipping spotlight listener - not main window");
      return;
    }

    // Rust emits a tuple (f64, f64) which becomes an array [x, y] in JS
    const unlistenSpotlight = listen<[number, number]>("trigger-spotlight", async (event) => {
      console.log("[App] trigger-spotlight received raw payload:", event.payload);

      let x, y;
      if (Array.isArray(event.payload)) {
        [x, y] = event.payload;
      } else {
        // Fallback if it somehow becomes an object later
        const p = event.payload as any;
        x = p.x;
        y = p.y;
      }

      console.log(`[App] Parsed coordinates: x=${x}, y=${y}`);
      await runSelectionProcess({ x, y });
    });

    const handleKeyDown = async (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        const win = getCurrentWindow();
        if (win.label === "popup") {
          setPopupData(null);
        }
        await win.hide();
      }
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      unlistenSpotlight.then(f => f());
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [windowLabel, runSelectionProcess]);

  // 全局监听trigger-spotlight事件（作为备用方案）
  useEffect(() => {
    console.log("[App] Setting up global spotlight listener as backup");

    const unlistenGlobalSpotlight = listen<[number, number]>("trigger-spotlight", async (event) => {
      console.log("[App] [GLOBAL] trigger-spotlight received:", event.payload);

      // 只在main窗口处理
      if (getCurrentWindow().label !== "main") {
        console.log("[App] [GLOBAL] Skipping - not main window");
        return;
      }

      let x, y;
      if (Array.isArray(event.payload)) {
        [x, y] = event.payload;
      } else {
        const p = event.payload as any;
        x = p.x;
        y = p.y;
      }

      console.log(`[App] [GLOBAL] Processing coordinates: x=${x}, y=${y}`);
      await runSelectionProcess({ x, y });
    });

    return () => {
      unlistenGlobalSpotlight.then(f => f());
    };
  }, [runSelectionProcess]);

  // Main window - Settings
  if (windowLabel === "main") {
    return <Settings />;
  }

  // Popup window
  if (windowLabel === "popup") {
    return (
      <div style={{
        width: "100vw",
        height: "100vh",
        display: "flex",
        alignItems: "stretch",
        justifyContent: "stretch",
        boxSizing: "border-box",
        background: "transparent"
      }}>
        <div style={{ width: "100%", height: "100%" }}>
          {popupData && popupData.actions && popupData.actions.length > 0 ? (
            <ActionPopup
              actions={popupData.actions}
              capturedText={popupData.capturedText}
              initialAiResult={popupData.aiResult}
            />
          ) : (
            <div style={{
              width: "100%",
              height: "100%",
              backgroundColor: "rgba(0, 0, 0, 0.9)",
              backdropFilter: "blur(24px)",
              border: "1px solid rgba(255, 255, 255, 0.1)",
              borderRadius: "16px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "12px"
            }}>
              <div style={{
                width: "24px",
                height: "24px",
                border: "2px solid rgba(59, 130, 246, 0.3)",
                borderTopColor: "#3b82f6",
                borderRadius: "50%",
                animation: "spin 0.8s linear infinite"
              }} />
              <p style={{ margin: 0, fontSize: "13px", color: "#888" }}>
                分析中...
              </p>
              <style>{`
                @keyframes spin {
                  to { transform: rotate(360deg); }
                }
              `}</style>
            </div>
          )}
        </div>
      </div>
    );
  }

  return null;
}

export default App;
