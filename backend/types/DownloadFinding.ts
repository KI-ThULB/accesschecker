export interface DownloadCheck {
  name: string;
  passed: boolean;
  details?: string;
}

export interface DownloadFinding {
  url: string;
  contentType: string;
  sizeKB: number;
  checks: DownloadCheck[];
  needsManualReview: boolean;
}
