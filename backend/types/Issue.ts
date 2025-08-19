export interface IssueExample {
  selector: string;
  context: string;
  pageUrl: string;
}

export interface Issue {
  ruleId: string;
  description: string;
  impact?: 'minor' | 'moderate' | 'serious' | 'critical';
  helpUrl?: string;
  pageUrl: string;
  wcag: string[];
  en301549: string[];
  bitv: string[];
  legalContext?: string;
  examples: IssueExample[];
}
