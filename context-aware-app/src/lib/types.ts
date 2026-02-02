export interface ActionMeta {
    id: string;
    name: string;
    version: string;
}

export interface ActionScope {
    include: string[];
    priority: number;
}

export interface ActionTrigger {
    type: "regex" | "keyword" | "context";
    pattern: string;
}

export interface ActionDef {
    type: "url" | "script" | "command";
    template: string;
}

export interface ContextAction {
    meta: ActionMeta;
    scope: ActionScope;
    trigger: ActionTrigger;
    action: ActionDef;
}
