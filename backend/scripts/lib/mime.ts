export function contentTypeToLabel(ct: string | undefined, url?: string): "PDF" | "DOCX" | "PPTX" | "XLSX" | "CSV" | "TXT" | "ODT" | "ODS" | "ODP" | "Unknown" {
  const map: Record<string, string> = {
    "application/pdf": "PDF",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "PPTX",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "XLSX",
    "text/csv": "CSV",
    "text/plain": "TXT",
    "application/vnd.oasis.opendocument.text": "ODT",
    "application/vnd.oasis.opendocument.spreadsheet": "ODS",
    "application/vnd.oasis.opendocument.presentation": "ODP",
  };
  if (ct && map[ct]) return map[ct] as any;
  if (url) {
    const m = url.toLowerCase().match(/\.([a-z0-9]+)(?:$|\?)/);
    const ext = m ? m[1] : "";
    const extMap: Record<string, string> = {
      pdf: "PDF",
      docx: "DOCX",
      pptx: "PPTX",
      xlsx: "XLSX",
      csv: "CSV",
      txt: "TXT",
      odt: "ODT",
      ods: "ODS",
      odp: "ODP",
    };
    if (extMap[ext]) return extMap[ext] as any;
  }
  return "Unknown";
}
