export function getNameInfo(el: HTMLElement) {
  const texts: string[] = [];
  const sources: string[] = [];
  const id = el.getAttribute('id');
  if (id) {
    const lbl = document.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (lbl) {
      texts.push(lbl.textContent?.trim() || '');
      sources.push('label[for]');
    }
  }
  let parent: HTMLElement | null = el.parentElement;
  while (parent) {
    if (parent.tagName.toLowerCase() === 'label') {
      texts.push(parent.textContent?.trim() || '');
      sources.push('label-wrapper');
      break;
    }
    parent = parent.parentElement;
  }
  const ariaLabelledby = el.getAttribute('aria-labelledby');
  if (ariaLabelledby) {
    for (const ref of ariaLabelledby.split(/\s+/)) {
      const e = document.getElementById(ref);
      if (e) {
        texts.push(e.textContent?.trim() || '');
        sources.push('aria-labelledby');
      }
    }
  }
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) {
    texts.push(ariaLabel.trim());
    sources.push('aria-label');
  }
  const uniqTexts = Array.from(new Set(texts.filter(Boolean)));
  return { texts: uniqTexts, sources };
}
