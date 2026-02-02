use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionMeta {
    pub id: String,
    pub name: String,
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionScope {
    pub include: Vec<String>,
    pub priority: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionTrigger {
    #[serde(rename = "type")]
    pub trigger_type: String, // "regex", "keyword", "context", "ai"
    pub pattern: String,
    pub extraction_pattern: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionDef {
    #[serde(rename = "type")]
    pub action_type: String, // "url", "path", "math", "doi_scihub", "ai_translate", "ai_summarize", "ai_process", "local_format", "script"
    pub template: String,
    pub script_path: Option<String>,
    pub arguments: Option<Vec<String>>,
    pub remote_script_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContextAction {
    pub meta: ActionMeta,
    pub scope: ActionScope,
    pub trigger: ActionTrigger,
    pub action: ActionDef,
    pub is_remote: Option<bool>,
    pub remote_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiResult {
    pub result: String,
    pub action_type: String, // "translate", "summarize", "process"
    pub source_text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessSelectionResult {
    pub actions: Vec<ContextAction>,
    pub captured_text: String,
    pub ai_result: Option<AiResult>,
}
