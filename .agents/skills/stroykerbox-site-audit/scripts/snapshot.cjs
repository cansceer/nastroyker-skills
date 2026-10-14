'use strict';

// Runs inside the page; no site mutations, uploads or form submissions.
async function collectSnapshot(page) {
  return page.evaluate(() => {
    const visible = el => {
      const s = getComputedStyle(el), r = el.getBoundingClientRect();
      return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
    };
    const selector = el => {
      if (el.id) return '#' + CSS.escape(el.id);
      const parts = [];
      while (el && el.nodeType === 1 && parts.length < 6) {
        let part = el.tagName.toLowerCase();
        if (el.classList.length) part += '.' + [...el.classList].slice(0, 2).map(CSS.escape).join('.');
        const siblings = el.parentElement ? [...el.parentElement.children].filter(x => x.tagName === el.tagName) : [];
        if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(el) + 1})`;
        parts.unshift(part); el = el.parentElement;
      }
      return parts.join(' > ');
    };
    const rect = el => {
      const r = el.getBoundingClientRect();
      return {x: Math.round(r.x), y: Math.round(r.y + scrollY), width: Math.round(r.width), height: Math.round(r.height)};
    };
    const style = el => {
      const s = getComputedStyle(el);
      return Object.fromEntries(['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'color', 'backgroundColor', 'borderRadius', 'padding', 'margin', 'maxWidth', 'objectFit', 'objectPosition', 'textOverflow', 'overflow', 'display'].map(k => [k, s[k]]));
    };
    const parseColor = str => {
      const m = str.match(/^rgba?\(([^)]+)\)$/);
      if (!m) return null;
      const parts = m[1].split(/[\s,\/]+/).filter(Boolean).map(Number);
      return parts.length >= 3 ? [parts[0], parts[1], parts[2], parts[3] ?? 1] : null;
    };
    const blend = (front, back) => front.slice(0, 3).map((c, i) => c * front[3] + back[i] * (1 - front[3]));
    const luminance = rgb => rgb.map(c => c / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4).reduce((v, c, i) => v + c * [.2126, .7152, .0722][i], 0);
    const contrast = (front, back) => {
      const a = luminance(front), b = luminance(back);
      return +((Math.max(a, b) + .05) / (Math.min(a, b) + .05)).toFixed(2);
    };
    const background = el => {
      const layers = []; let root = false;
      while (el) {
        const s = getComputedStyle(el);
        if (s.backgroundImage !== 'none' || Number(s.opacity) < 1 || s.mixBlendMode !== 'normal' || s.filter !== 'none') return null;
        const c = parseColor(s.backgroundColor);
        if (!c) return null;
        layers.push(c);
        if (c[3] === 1) {root = true; break;}
        el = el.parentElement;
      }
      // CSS canvas default is unknown to this collector: do not silently assume white.
      if (!root) return null;
      let back = layers.pop().slice(0, 3);
      for (const layer of layers.reverse()) back = blend(layer, back);
      return back;
    };
    const fields = [...document.querySelectorAll('input:not([type="hidden"]), textarea, select')].map(el => {
      const s = getComputedStyle(el), ps = getComputedStyle(el, '::placeholder'), bg = background(el);
      const text = parseColor(s.webkitTextFillColor || s.color), placeholder = parseColor(ps.color);
      if (placeholder) placeholder[3] *= Number(ps.opacity || 1);
      const large = parseFloat(s.fontSize) >= 24 || (parseFloat(s.fontSize) >= 18.667 && parseInt(s.fontWeight) >= 700);
      return {selector: selector(el), tag: el.tagName.toLowerCase(), type: el.getAttribute('type'), name: el.getAttribute('name'), placeholder: el.getAttribute('placeholder'), label: [...(el.labels || [])].map(x => x.innerText).join(' '), disabled: el.disabled, readOnly: el.readOnly, visible: visible(el), rect: rect(el), style: style(el), contrast: {background: bg, text: bg && text ? contrast(blend(text, bg), bg) : null, placeholder: bg && placeholder ? contrast(blend(placeholder, bg), bg) : null, threshold: large ? 3 : 4.5, needsVisualVerification: true}, interactionStatus: 'not_checked'};
    });
    const rawUrls = [];
    for (const el of document.querySelectorAll('[href],[src],[srcset],[action],[poster],[data-src],[data-srcset]')) {
      for (const attr of ['href', 'src', 'srcset', 'action', 'poster', 'data-src', 'data-srcset']) {
        if (el.hasAttribute(attr)) rawUrls.push({selector: selector(el), tag: el.tagName.toLowerCase(), attribute: attr, value: el.getAttribute(attr), text: (el.innerText || '').slice(0, 180), visible: visible(el)});
      }
    }
    const block = el => {
      const container = el.closest('section,article,figure,.product-card,.card') || el.parentElement;
      return {selector: container ? selector(container) : null, text: (container?.innerText || '').slice(0, 800)};
    };
    const images = [...document.images].map(el => ({selector: selector(el), rawSrc: el.getAttribute('src'), currentSrc: el.currentSrc, srcset: el.getAttribute('srcset'), alt: el.getAttribute('alt'), naturalWidth: el.naturalWidth, naturalHeight: el.naturalHeight, rect: rect(el), visible: visible(el), style: style(el), block: block(el), semanticStatus: 'not_checked', externalUniqueness: 'not_checked'}));
    const backgrounds = [...document.querySelectorAll('body *')].filter(visible).flatMap(el => {
      const value = getComputedStyle(el).backgroundImage;
      return [...value.matchAll(/url\(["']?(.+?)["']?\)/g)].map(m => ({selector: selector(el), url: m[1], rect: rect(el), block: block(el), semanticStatus: 'not_checked'}));
    });
    const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(el => ({level: Number(el.tagName[1]), text: el.textContent.trim(), selector: selector(el), visible: visible(el), style: style(el)}));
    const buttons = [...document.querySelectorAll('button,[role="button"],input[type="button"],input[type="submit"],a.btn,a.button')].map(el => ({selector: selector(el), text: (el.innerText || el.getAttribute('value') || '').trim(), ariaLabel: el.getAttribute('aria-label'), visible: visible(el), disabled: Boolean(el.disabled), style: style(el), behaviorStatus: 'not_checked', hoverStatus: 'not_checked'}));
    const paragraphs = [...document.querySelectorAll('p')].filter(visible).map(el => ({selector: selector(el), text: el.innerText.slice(0, 500), style: style(el)}));
    const clippingCandidates = [...document.querySelectorAll('h1,h2,h3,h4,p,button,label,a,textarea,input')].filter(visible).filter(el => {
      const s = getComputedStyle(el);
      return /hidden|clip/.test(s.overflow + s.overflowX + s.overflowY) && (el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 2);
    }).map(el => ({selector: selector(el), text: (el.innerText || '').slice(0, 150), rect: rect(el), style: style(el)}));
    const navigation = performance.getEntriesByType('navigation')[0];
    return {url: location.href, title: document.title, meta: [...document.querySelectorAll('meta')].map(el => ({name: el.getAttribute('name') || el.getAttribute('property') || (el.hasAttribute('charset') ? 'charset' : null), content: el.getAttribute('content') || el.getAttribute('charset')})), canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href') || null, base: document.querySelector('base')?.getAttribute('href') || null, viewport: {width: innerWidth, height: innerHeight, dpr: devicePixelRatio}, document: {width: Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0), height: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0)}, headings, rawUrls, images, backgrounds, inlineSvg: [...document.querySelectorAll('svg')].filter(visible).map(el => ({selector: selector(el), role: el.getAttribute('role'), label: el.getAttribute('aria-label'), rect: rect(el)})), fields, buttons, paragraphs, clippingCandidates, inlineStyles: [...document.querySelectorAll('[style]')].map(el => ({selector: selector(el), value: el.getAttribute('style'), origin: 'unknown'})), text: document.body?.innerText || '', navigation: navigation ? {ttfbMs: Math.round(navigation.responseStart - navigation.requestStart), domContentLoadedMs: Math.round(navigation.domContentLoadedEventEnd), loadMs: Math.round(navigation.loadEventEnd), transferSize: navigation.transferSize} : null, auditMetrics: window.__siteAuditMetrics || null};
  });
}
module.exports = {collectSnapshot};
