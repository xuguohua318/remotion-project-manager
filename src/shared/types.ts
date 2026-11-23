export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun' | 'unknown';
export type TaskKind = 'install' | 'studio' | 'check' | 'render' | 'still' | 'verify';
export type TaskStatus = 'idle' | 'starting' | 'running' | 'success' | 'failed' | 'stopped';

export type ScriptMap = Partial<Record<'studio' | 'render' | 'still' | 'check', string>>;

export interface ProjectRegistryEntry {
  id: string;
  path: string;
  addedAt: string;
  lastOpenedAt: string;
  scriptOverrides?: ScriptMap;
}

export interface AppRegistry {
  version: 1;
  nodeDirectory: string;
  projects: ProjectRegistryEntry[];
}

export interface TimelineConfig {
  fps: number;
  durationInFrames: number;
}

export interface KeyframeConfig {
  containerPath: string;
  easingPath?: string;
}

export interface SettingsConfig {
  file: string;
  schema: string;
  compositionId: string;
  timeline: TimelineConfig;
  keyframes?: KeyframeConfig;
}

export interface RemotionManagerManifest {
  version: 1;
  displayName: string;
  entry: string;
  packageManager: 'npm';
  scripts: ScriptMap;
  settings?: SettingsConfig;
}

export interface ProjectInfo {
  id: string;
  path: string;
  displayName: string;
  packageName: string;
  packageManager: PackageManager;
  supported: boolean;
  entry?: string;
  scripts: ScriptMap;
  packageScripts: Record<string, string>;
  hasPackageLock: boolean;
  hasNodeModules: boolean;
  hasRemotionCli: boolean;
  hasManifest: boolean;
  settings?: SettingsConfig;
  warnings: string[];
}

export interface UiHints {
  control?: 'slider' | 'number' | 'checkbox' | 'select' | 'color' | 'text';
  group?: string;
  unit?: string;
  step?: number;
  keyframable?: boolean;
  order?: number;
}

export interface JsonSchemaProperty {
  type?: 'number' | 'integer' | 'boolean' | 'string' | 'object' | 'array';
  title?: string;
  description?: string;
  minimum?: number;
  maximum?: number;
  multipleOf?: number;
  enum?: Array<string | number>;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  ['x-remotion-ui']?: UiHints;
}

export interface JsonSchemaDocument extends JsonSchemaProperty {
  $schema?: string;
  additionalProperties?: boolean;
}

export interface SettingsDocument {
  value: Record<string, unknown>;
  schema: JsonSchemaDocument;
  config: SettingsConfig;
  filePath: string;
  hash: string;
}

export interface SetupField {
  key: string;
  title: string;
  type: 'number' | 'integer' | 'boolean' | 'string';
  value: string | number | boolean;
  minimum?: number;
  maximum?: number;
  step?: number;
  group: string;
  unit?: string;
  keyframable: boolean;
}

export interface SetupDraft {
  settingsRelativePath: string;
  compositionId: string;
  fps: number;
  durationInFrames: number;
  keyframeContainerPath?: string;
  easingPath?: string;
  fields: SetupField[];
}

export interface TaskState {
  projectId: string;
  kind: TaskKind;
  status: TaskStatus;
  startedAt?: string;
  endedAt?: string;
  exitCode?: number | null;
  studioUrl?: string;
  message?: string;
}

export interface TaskEvent {
  projectId: string;
  kind: TaskKind;
  type: 'state' | 'stdout' | 'stderr';
  text?: string;
  state?: TaskState;
}

export interface VerificationResult {
  ok: boolean;
  checkedAt: string;
  beforeHash?: string;
  afterHash?: string;
  keyframeTracks?: number;
  keyframes?: number;
  compositionsOutput: string;
  studioUrl?: string;
  errors: string[];
  reportPath: string;
}

export interface StudioBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RuntimeInfo {
  nodeDirectory: string;
  nodePath?: string;
  npmPath?: string;
  nodeVersion?: string;
  npmVersion?: string;
  ok: boolean;
  message?: string;
}

export interface RemotionManagerApi {
  projects: {
    list: () => Promise<ProjectInfo[]>;
    pickAndImport: () => Promise<ProjectInfo | null>;
    importPath: (projectPath: string) => Promise<ProjectInfo>;
    pickAndScan: () => Promise<ProjectInfo[]>;
    remove: (projectId: string) => Promise<void>;
    refresh: (projectId: string) => Promise<ProjectInfo>;
    openFolder: (projectId: string) => Promise<void>;
  };
  runtime: {
    get: () => Promise<RuntimeInfo>;
    pickNodeDirectory: () => Promise<RuntimeInfo | null>;
  };
  tasks: {
    run: (projectId: string, kind: TaskKind) => Promise<TaskState>;
    stop: (projectId: string, kind: TaskKind) => Promise<void>;
    states: () => Promise<TaskState[]>;
    onEvent: (callback: (event: TaskEvent) => void) => () => void;
  };
  settings: {
    load: (projectId: string) => Promise<SettingsDocument>;
    save: (projectId: string, value: Record<string, unknown>) => Promise<SettingsDocument>;
    exportJson: (projectId: string, value: Record<string, unknown>) => Promise<string | null>;
    importJson: (projectId: string) => Promise<Record<string, unknown> | null>;
    beginSetup: (projectId: string) => Promise<SetupDraft | null>;
    completeSetup: (projectId: string, draft: SetupDraft) => Promise<ProjectInfo>;
    verify: (projectId: string) => Promise<VerificationResult>;
  };
  studio: {
    show: (projectId: string, bounds: StudioBounds) => Promise<void>;
    hide: () => Promise<void>;
    setBounds: (bounds: StudioBounds) => Promise<void>;
    openExternal: (projectId: string) => Promise<void>;
  };
  files: {
    pathForFile: (file: File) => string;
  };
}
