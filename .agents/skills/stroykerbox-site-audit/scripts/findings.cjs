'use strict';
const {hash, classifyRawUrl, srcsetUrls} = require('./lib.cjs');

function candidatesFor(snapshot, profile, evidence, resourceRows = []) {
  const results = [];
  const add = (rule, owner, priority, category, message, recommendation, selector, key = rule, resourceUrl = null) => {
    results.push({id: `${owner === 'user' ? 'U' : 'A'}-${hash(key).slice(0, 10)}`, priority, owner, status: 'candidate', category, message, recommendation, occurrences: [{url: snapshot.url, viewport: snapshot.viewport.width, selector: selector || null, ...(resourceUrl ? {resourceUrl} : {}), evidence}], cmsOrigin: 'unknown', cmsConstraint: 'permissions-not-confirmed', verification: {status: 'not_checked', rule}});
  };
  const h1 = snapshot.headings.filter(h => h.level === 1);
  if (h1.length !== 1) add('h1-count', 'user', 'P2', 'html', `В DOM найдено h1: ${h1.length}; требуется ровно один`, 'Исправить заголовки в содержимом/шаблоне CMS; CSS не меняет семантику.', h1[0]?.selector, `h1:${snapshot.url}`);
  if (!snapshot.title.trim()) add('missing-title', 'user', 'P2', 'metadata', 'Отсутствует title страницы', 'Задать релевантный title в CMS.', null, `title:${snapshot.url}`);
  if (!snapshot.meta.some(m => m.name?.toLowerCase() === 'description' && m.content?.trim())) add('missing-description', 'user', 'P3', 'metadata', 'Не заполнен meta description', 'Заполнить описание страницы в CMS.', null, `description:${snapshot.url}`);
  if (!snapshot.meta.some(m => m.name?.toLowerCase() === 'viewport')) add('missing-viewport', 'user', 'P2', 'metadata', 'Не найден meta viewport', 'Проверить системный шаблон и мобильное отображение; добавить корректный viewport.', null, 'viewport');
  if (snapshot.document.width > snapshot.viewport.width + 2) add('horizontal-overflow', 'codex', 'P2', 'layout', `Ширина документа ${snapshot.document.width}px превышает viewport ${snapshot.viewport.width}px`, 'Найти переполняющий элемент; исправить его размер/отступ локально, не скрывать overflow всей страницы.', null, `overflow:${snapshot.url}`);
  for (const row of snapshot.rawUrls) {
    const values = row.attribute.includes('srcset') ? srcsetUrls(row.value) : [row.value];
    // Canonical is metadata, not normal navigation. Keep metadata conflicts for manual review.
    if (row.tag === 'link' && snapshot.canonical === row.value) continue;
    for (const raw of values) {
      const classification = classifyRawUrl(raw, snapshot.url, profile);
      if (classification === 'internal-absolute') add('internal-absolute', 'user', 'P3', 'urls', `Внутренний ${row.attribute} содержит домен: ${raw}`, 'Заменить адрес в HTML/поле CMS на относительный с сохранением пути и назначения.', row.selector, `raw:${row.attribute}:${raw}`);
      else if (classification === 'external-exception-needed') add('external-exception', 'user', 'P3', 'urls', `Внешний ${row.attribute} требует решения по правилу относительных ссылок: ${raw}`, 'Подтвердить исключение или локализовать ресурс; относительный адрес не сохранит внешнюю цель.', row.selector, `external:${row.attribute}:${raw}`);
    }
    if (row.tag === 'a' && row.attribute === 'href' && (!row.value.trim() || row.value === '#')) add('empty-link', 'codex', 'P2', 'interaction', 'У ссылки пустое назначение или #; действие нужно проверить', 'Проверить JS-обработчик разрешённым действием; при подтверждённой поломке исправить обработчик или адрес в CMS.', row.selector, `empty:${row.selector}`);
  }
  for (const img of snapshot.images) {
    if (img.alt === null) add('missing-alt', 'user', 'P2', 'images', 'У изображения отсутствует атрибут alt', 'Определить роль: содержательному изображению дать описание, декоративному — alt="".', img.selector, `alt:${img.currentSrc}`, img.currentSrc);
    if (img.visible && (!img.naturalWidth || !img.naturalHeight)) add('broken-image', 'user', 'P2', 'images', 'Видимое изображение не декодировано/не загружено', 'Проверить HTTP и lazy-loading, затем заменить или исправить источник в CMS.', img.selector, `broken:${img.currentSrc}`, img.currentSrc);
  }
  for (const field of snapshot.fields.filter(f => f.visible && !f.disabled)) {
    for (const kind of ['text', 'placeholder']) {
      if (kind === 'placeholder' && !field.placeholder) continue;
      const ratio = field.contrast[kind];
      if (ratio !== null && ratio < field.contrast.threshold) add(`input-contrast-${kind}`, 'codex', 'P2', 'forms', `Контраст ${kind === 'text' ? 'текста поля' : 'placeholder'} ${ratio}:1 ниже ${field.contrast.threshold}:1`, 'Перепроверить реальный фон и фокусное состояние; скорректировать цвет/opacity в доступном CSS.', field.selector, `contrast:${kind}:${field.selector}`);
    }
  }
  for (const row of snapshot.clippingCandidates) add('possible-clipping', 'codex', 'P2', 'layout', 'Возможно обрезание содержимого', 'Проверить скриншот и назначение ellipsis; исправить высоту/переносы только при нежелательной обрезке.', row.selector, `clip:${row.selector}`);
  for (const row of resourceRows) {
    if (row.bytes !== null && row.bytes > profile.maxImageBytes) add('image-size', 'user', 'P2', 'images', `Вес изображения ${row.bytes} байт превышает лимит ${profile.maxImageBytes} байт`, 'Оптимизировать формат/размер без заметной потери качества; заменить через CMS.', null, `weight:${row.sha256 || row.url}`, row.url);
  }
  return results;
}
function mergeFindings(existing, incoming) {
  const map = new Map(existing.map(f => [f.id, f]));
  for (const f of incoming) {
    if (!map.has(f.id)) {map.set(f.id, f); continue;}
    const current = map.get(f.id);
    for (const occurrence of f.occurrences) if (!current.occurrences.some(o => o.url === occurrence.url && o.viewport === occurrence.viewport && o.selector === occurrence.selector && o.resourceUrl === occurrence.resourceUrl)) current.occurrences.push(occurrence);
  }
  return [...map.values()];
}
module.exports = {candidatesFor, mergeFindings};
