export function getNameInfo(el: HTMLElement) {
  const texts: string[] = [];
  const sources: string[] = [];

  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) {
    texts.push(ariaLabel.trim());
    sources.push('aria-label');
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

  const id = el.getAttribute('id');
  if (id) {
    const lbl = document.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (lbl) {
      texts.push(lbl.textContent?.trim() || '');
      sources.push('label[for]');
    }
  }

  const attr = el.getAttribute('title') || el.getAttribute('placeholder');
  if (attr) {
    texts.push(attr.trim());
    sources.push('attr');
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

  if (!texts.length) {
    const txt = el.textContent?.trim();
    if (txt) {
      texts.push(txt);
      sources.push('text');
    }
  }

  const uniqTexts = Array.from(new Set(texts.filter(Boolean)));
  return { texts: uniqTexts, sources };
}
