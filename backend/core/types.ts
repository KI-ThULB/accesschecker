export type Severity = 'critical' | 'serious' | 'moderate' | 'minor';

export interface NormRefs {
  wcag?: string[];
  bitv?: string[];
  en301549?: string[];
  legalContext?: string;
}

export interface Finding {
  id: string;
  module: string;
  severity: Severity;
  summary: string;
  details: string;
  selectors?: string[];
  pageUrl: string;
  norms?: NormRefs;
}

export interface Issue extends Finding {}

export interface DownloadFinding extends Finding {
  downloadUrl?: string;
}

export interface ModuleResult {
  module: string;
  version: string;
  findings: Finding[];
  warnings?: string[];
  stats?: Record<string, number>;
  metrics?: Record<string, number>;
  artifacts?: Record<string, string>;
}

export interface PageMeta {
  url: string;
  [key: string]: unknown;
}

export interface ScoreSummary {
  overall: number;
  bySeverity?: Record<Severity, number>;
}

export interface LogEvent {
  level: 'debug' | 'info' | 'warn' | 'error';
  module?: string;
  url?: string;
  msg: string;
  elapsed?: number;
}

export interface ScanConfig {
  profile: string;
  modules: Record<string, boolean>;
  profiles: Record<string, string[]>;
  url?: string;
  [key: string]: unknown;
}

export interface ModuleContext {
  page: import('playwright').Page;
  url: string;
  crawlGraph: PageMeta[];
  config: ScanConfig;
  log: (e: LogEvent) => void;
  saveArtifact: (name: string, data: unknown) => Promise<string>;
}

export interface Module {
  slug: string;
  version: string;
  requires?: string[];
  init?(ctx: ModuleContext): Promise<void> | void;
  run(ctx: ModuleContext): Promise<ModuleResult>;
  dispose?(ctx: ModuleContext): Promise<void> | void;
}

export interface ScanResults {
  meta: { startedAt: string; finishedAt: string; target: string; profile: string };
  score: ScoreSummary;
  modules: Record<string, ModuleResult>;
  issues: Issue[];
  pages: PageMeta[];
  downloads?: DownloadFinding[];
}
