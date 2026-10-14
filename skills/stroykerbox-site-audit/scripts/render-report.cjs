#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {argumentsOf} = require('./lib.cjs');
function report(findings, summary) {
  const clean = value => String(value || '').replace(/[\r\n]+/g, ' ').replace(/([\[\]<>])/g, '\\$1');
  const lines = [summary || 'Покрытие: смотрите manifest.json и coverage.json. Подтверждённые находки ниже; кандидаты требуют проверки.', ''];
  for (const [owner, heading] of [['user', 'Для вас — CMS, контент и доступы'], ['codex', 'Для Codex — возможные правки CSS/JS']]) {
    lines.push(`**${heading}**`, '');
    const rows = findings.filter(f => f.owner === owner && f.status === 'confirmed').sort((a, b) => a.priority.localeCompare(b.priority) || a.category.localeCompare(b.category) || a.id.localeCompare(b.id));
    if (!rows.length) lines.push('Подтверждённых задач в этой категории пока нет.', '');
    for (const f of rows) {
      const pages = [...new Set(f.occurrences.map(o => {try {return new URL(o.url).pathname;} catch {return o.url;}}))];
      const widths = [...new Set(f.occurrences.map(o => o.viewport).filter(Boolean))];
      const evidence = f.occurrences.find(o => o.evidence)?.evidence;
      const link = evidence ? ` [Доказательство](<${String(evidence).replace(/[<>\r\n]/g, '')}>)` : '';
      lines.push(`- [ ] **${clean(f.id)} · ${clean(f.priority)} · ${clean(pages.join(', '))}${widths.length ? ` · ${widths.join('/')} px` : ''}** — ${clean(f.message)} → ${clean(f.recommendation)}.${link}`);
    }
    if (rows.length) lines.push('');
  }
  const candidates = findings.filter(f => f.status === 'candidate').length;
  if (candidates) lines.push(`Автоматических кандидатов, ещё не подтверждённых: ${candidates}. Они сохранены в findings.json и не выданы за ошибки.`, '');
  return lines.join('\n');
}
if (require.main === module) {
  const args = argumentsOf(process.argv.slice(2));
  if (!args.input || !args.output) throw new Error('Usage: render-report.cjs --input findings.json --output checklist.md [--summary TEXT]');
  const findings = JSON.parse(fs.readFileSync(args.input, 'utf8'));
  fs.mkdirSync(path.dirname(path.resolve(args.output)), {recursive: true});
  fs.writeFileSync(args.output, report(findings, args.summary));
}
module.exports = {report};
