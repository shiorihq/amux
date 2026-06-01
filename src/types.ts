export type ProviderId = "codex" | "claude" | "pi";

export type ThreadSource = "history" | "new";

export interface ProviderDefinition {
  id: ProviderId;
  name: string;
  command: string;
  home: string;
  sessionRoots: string[];
  resumeCommand: (thread: AgentThread) => string[];
  newCommand: (cwd: string) => string[];
}

export interface AgentThread {
  id: string;
  provider: ProviderId;
  providerName: string;
  title: string;
  cwd: string;
  sessionId?: string;
  sessionPath?: string;
  updatedAt?: Date;
  createdAt?: Date;
  messageCount: number;
  source: ThreadSource;
  command: string[];
  preview: string;
  tags: string[];
}

export interface ProviderHealth {
  provider: ProviderId;
  installed: boolean;
  version?: string;
  path?: string;
  error?: string;
}

export interface RuntimeHealth {
  node: {
    installed: boolean;
    version?: string;
    path?: string;
    error?: string;
  };
}

export interface LaunchSpec {
  thread: AgentThread;
  cols: number;
  rows: number;
}
