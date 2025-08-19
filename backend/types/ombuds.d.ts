export interface OmbudsEntry {
  jurisdiction: string;
  label: string;
  authorityType: 'federal' | 'state';
  website?: string;
  email?: string;
  phone?: string;
  postalAddress?: string;
  legalBasis?: string[];
  notes?: string;
}

export interface OmbudsConfig {
  $schema?: string;
  version: number;
  defaultJurisdiction: string;
  entries: OmbudsEntry[];
}
