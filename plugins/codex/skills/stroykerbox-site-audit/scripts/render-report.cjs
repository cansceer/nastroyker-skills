#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {argumentsOf} = require('./lib.cjs');
function coverageSummary(manifest, coverage) {
  const pages = (manifest.pages || []).filter(page => page.included);
  const widths = [...new Set((coverage || []).map(row => row.viewport).filter(Boolean))].sort((a, b) => a - b);
  const completePages = pages.filter(page => widths.length && widths.every(width => coverage.some(row => row.url === page.url && row.viewport === width && row.capture === 'passed'))).length;
  const browser = manifest.browser ? `${manifest.browser.name || 'Браузер'}${manifest.browser.version ? ` ${manifest.browser.version}` : ''}` : 'Браузер не указан';
  const sourceStatus = manifest.sourceCaptureComplete ? 'HTML/CSS/JS собраны' : `сбор HTML/CSS/JS неполон; пропусков: ${(manifest.sourceCaptureFailures || []).length}`;
  const limitationCount = (manifest.limitations || []).length;
  return `Покрытие: ${completePages}/${pages.length} страниц на всех ${widths.length} ширинах${widths.length ? ` (${widths.join(', ')} px)` : ''}; ${browser}; ${sourceStatus}; ограничений: ${limitationCount}.`;
}
function report(findings, summary) {
  const clean = value => String(value || '').replace(/[\r\n]+/g, ' ').replace(/([\\`*_{}\[\]<>])/g, '\\$1');
  const safeUrl = value => {
    try {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol)) return null;
      for (const key of [...url.searchParams.keys()]) if (/(?:token|key|auth|password|secret|session|email|phone|code)/i.test(key)) url.searchParams.set(key, '[redacted]');
      url.hash = '';
      return url.href;
    } catch { return null; }
  };
  const link = (value, label = value) => {
    const href = safeUrl(value);
    return href ? `[${clean(label)}](<${href.replace(/[<>\r\n]/g, '')}>)` : `\`${clean(label)}\``;
  };
  const isVisual = f => ['design', 'visual', 'images', 'image', 'buttons', 'colors', 'color', 'typography'].includes(String(f.category).toLowerCase()) || f.category === 'forms' && /^input-contrast-/.test(f.verification?.rule || '');
  const isMarkup = f => ['layout', 'html', 'css', 'style', 'styles', 'markup', 'content', 'text', 'copy', 'orthography'].includes(String(f.category).toLowerCase());
  const groups = [
    {heading: '1. Визуальные ошибки и дизайн', include: isVisual},
    {heading: '2. Вёрстка, стили и орфография', include: isMarkup},
    {heading: '3. Глобальные проблемы', include: f => !isVisual(f) && !isMarkup(f)}
  ];
  const confirmed = findings.filter(f => f.status === 'confirmed');
  const counts = {P1: 0, P2: 0, P3: 0};
  for (const f of confirmed) if (counts[f.priority] !== undefined) counts[f.priority]++;
  const lines = ['# Чеклист аудита сайта', '', summary || 'Покрытие: см. manifest.json и coverage.json. В чеклист включены только подтверждённые ошибки.', '', `**Задач:** ${confirmed.length} · P1: ${counts.P1} · P2: ${counts.P2} · P3: ${counts.P3}`, '**Исполнитель** указан в каждой строке: «Для вас» — CMS/контент; «Для Codex» — возможная правка CSS/JS.', ''];
  const priorityRank = {P1: 1, P2: 2, P3: 3};
  for (const group of groups) {
    const rows = confirmed.filter(group.include).sort((a, b) => (priorityRank[a.priority] || 9) - (priorityRank[b.priority] || 9) || a.id.localeCompare(b.id));
    lines.push(`## ${group.heading}`, '');
    if (!rows.length) {lines.push('Подтверждённых задач нет.', ''); continue;}
    for (const f of rows) {
      const occurrences = f.occurrences || [];
      const pages = [...new Set(occurrences.map(o => o.url).filter(Boolean))];
      const widths = [...new Set(occurrences.map(o => o.viewport).filter(Boolean))];
      const resources = [...new Set(occurrences.map(o => o.resourceUrl).filter(Boolean))];
      const evidence = [...new Set(occurrences.map(o => o.evidence).filter(Boolean))];
      const owner = f.owner === 'codex' ? 'Для Codex' : 'Для вас';
      const pageLinks = pages.map(url => link(url)).join(', ') || 'URL не записан — проверить findings.json';
      const resourceLinks = resources.length ? ` · Ресурс: ${resources.map(url => link(url)).join(', ')}` : '';
      const evidenceLinks = evidence.map(url => ` · [Скриншот/доказательство](<${String(url).replace(/[<>\r\n]/g, '')}>)`).join('');
      const selector = [...new Set(occurrences.map(o => o.selector).filter(Boolean))];
      const target = selector.length ? ` · \`${clean(selector.join(', '))}\`` : '';
      lines.push(`- [ ] **${clean(f.priority)} · ${owner} · ${clean(f.id)}** · ${pageLinks}${widths.length ? ` · ${widths.join('/')} px` : ''}${target}${resourceLinks} — ${clean(f.message)} Действие: ${clean(f.recommendation)}${evidenceLinks}`);
    }
    lines.push('');
  }
  const candidates = findings.filter(f => f.status === 'candidate').length;
  if (candidates) lines.push(`> Не включено в чеклист: ${candidates} автоматических кандидатов без подтверждения. Они сохранены в findings.json.`, '');
  return lines.join('\n');
}
if (require.main === module) {
  const args = argumentsOf(process.argv.slice(2));
  if (!args.input || !args.output) throw new Error('Usage: render-report.cjs --input findings.json --output checklist.md [--manifest manifest.json --coverage coverage.json] [--summary TEXT]');
  const findings = JSON.parse(fs.readFileSync(args.input, 'utf8'));
  let summary = args.summary || null;
  if (!summary && args.manifest) {
    const manifest = JSON.parse(fs.readFileSync(args.manifest, 'utf8'));
    const coverageFile = args.coverage || path.join(path.dirname(path.resolve(args.manifest)), 'coverage.json');
    const coverage = fs.existsSync(coverageFile) ? JSON.parse(fs.readFileSync(coverageFile, 'utf8')) : [];
    summary = coverageSummary(manifest, coverage);
  }
  fs.mkdirSync(path.dirname(path.resolve(args.output)), {recursive: true});
  fs.writeFileSync(args.output, report(findings, summary));
}
module.exports = {report, coverageSummary};
