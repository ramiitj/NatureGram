#!/usr/bin/env node
// Glossary guard (docs/CLARITY_PLAN.md, C1).
//
// Scans the words people read (JSX text, string literals and template text)
// in the app and the server-rendered pages and emails for words the glossary
// retired, and fails with file:line for each one. It parses the files with the
// TypeScript compiler, so identifiers, comments, imports and data keys are never
// read as copy.
//
// A legitimate use is allowed in one of two ways:
//   - a `glossary-ok` comment on the same line or the line above
//     (in JSX: {/* glossary-ok: plate image */}), or
//   - an entry in ALLOW below, scoped to a file and a phrase, with a reason.
//
// Run: node scripts/check-glossary.mjs   (part of npm run test:server)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const FILES = [
  'App.tsx',
  ...fs.readdirSync(path.join(ROOT, 'components'))
    .filter((f) => f.endsWith('.tsx'))
    .map((f) => `components/${f}`),
  'server/seoPages.js',
  'server/authMail.js',
  'server/guardian.js',
];

// Retired word -> the glossary word that replaced it.
const RETIRED = [
  { re: /\bentr(?:y|ies)\b/gi, use: 'sighting' },
  { re: /(?<!field |unfinished )\bpages?\b/gi, use: 'sighting (or "field page")' },
  { re: /\bplates?\b/gi, use: 'sighting ("plate" is only the life-list card and its image)' },
  { re: /\bspecimens?\b/gi, use: 'sighting' },
  { re: /\brecords?\b/gi, use: 'sighting' },
  { re: /\bexpeditions?\b/gi, use: 'sighting' },
  { re: /\bread by\b/gi, use: 'followed by / followers' },
  { re: /\b(?:is|are|not|isn't|aren't|you're|they're|who's|start|stop|keep) reading\b|\breading (?:you|your|anyone|them|their|along)\b|\breads\b/gi, use: 'following' },
  { re: /\breaders?\b/gi, use: 'followers' },
  { re: /\bfellow explorers?\b/gi, use: 'following' },
  { re: /\b(?:keep|start|open) my notebook\b/gi, use: 'Start my field page' },
  { re: /\bstart a field notebook\b/gi, use: 'Start my field page' },
  { re: /\bshare with the wild\b/gi, use: 'Share with everyone' },
  { re: /\bshared with the field\b/gi, use: 'Share with everyone' },
  { re: /\bjournal[- ]only\b/gi, use: 'Only me' },
  { re: /\bobservers?\b/gi, use: 'explorers' },
  { re: /\bput it in a letter\b/gi, use: 'Send in a letter' },
  { re: /\bweekly letter\b/gi, use: 'Your week outside' },
  { re: /\byour field notes\b/gi, use: 'your note (the caption)' },
  { re: /\bcomments?\b/gi, use: 'field notes' },
  { re: /\bprofiles?\b/gi, use: 'field page' },
  { re: /\bposts?\b/gi, use: 'sighting' },
  { re: /\b(?:likes|liked)\b/gi, use: 'marvel' },
  { re: /\b(?:direct )?messages?\b/gi, use: 'letter' },
];

// Scoped allowances: { file, re, why }. `file` is matched against the
// repo-relative path; `re` against the matched phrase.
const ALLOW = [
  { file: /^components\/SpecimenPlate\.tsx$/, re: /^(plates?|specimens?)$/i, why: 'the life-list specimen card itself' },
  { file: /^components\/AdminConsole\.tsx$/, re: /^(records?|entries|messages|plates?)$/i, why: 'operator tooling: database records, audit entries, system messages, car number plates' },
  { file: /^components\/UserProfile\.tsx$/, re: /^plates?$/i, why: 'the life list (the herbarium of plates) lives on the field page' },
  { file: /^server\/seoPages\.js$/, re: /^pages?$/i, why: 'web pages (page not found, this page)' },
  { file: /^components\/(Journal|FieldNotebook)\.tsx$/, re: /^pages?$/i, why: 'the Journal\'s notebook: a page per outing' },
];

// Strings that look like code, not copy: no whitespace and all lower case
// ('record', 'entry', 'plate-card'). Copy that is a single word is written
// with a capital ("Record") or sits in JSX text, so it is still read.
// Paths, file names and constants ('/post/', './Messages.tsx', 'POST') too.
const looksLikeCode = (s) => !/\s/.test(s) && (!/[A-Z]/.test(s) || !/[a-z]/.test(s) || /[/.]/.test(s));
// Template text that builds a URL or path.
const looksLikeUrl = (s) => /^(\/|https?:|\.\/)/.test(s.trim());
// Calls whose strings never reach a person.
const isQuietCall = (node) => {
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isCallExpression(p)) {
      const callee = p.expression.getText();
      if (/^console\.|^track$|^logEvent$/.test(callee)) return true;
    }
    if (ts.isStatement(p) || ts.isJsxElement(p)) return false;
  }
  return false;
};

function textsOf(sf) {
  const out = [];
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(sf);
      if (/^(className|key|id|href|src|htmlFor|type|role|rel|target|data-.*|aria-controls|autoComplete|inputMode|name|form)$/.test(name)) return;
    }
    if (ts.isJsxText(node)) {
      out.push({ start: node.getStart(sf), raw: node.getText(sf) });
    } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const raw = node.getText(sf);
      const parent = node.parent;
      const isKey = parent && (ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent)) && parent.name === node;
      const isIndex = parent && ts.isElementAccessExpression(parent) && parent.argumentExpression === node;
      if (!isKey && !isIndex && !looksLikeCode(node.text) && !looksLikeUrl(node.text) && !isQuietCall(node)) out.push({ start: node.getStart(sf), raw });
    } else if (ts.isTemplateExpression(node)) {
      const parts = [node.head, ...node.templateSpans.map((s) => s.literal)];
      const joined = parts.map((p) => p.text).join('');
      if (!looksLikeCode(joined) && !looksLikeUrl(node.head.text) && !isQuietCall(node)) for (const p of parts) out.push({ start: p.getStart(sf), raw: p.getText(sf) });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

const problems = [];
for (const rel of FILES) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) continue;
  const src = fs.readFileSync(abs, 'utf8');
  const lines = src.split('\n');
  const kind = rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.JS;
  const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true, kind);
  for (const { start, raw: text } of textsOf(sf)) {
    // Blank out HTML tags (attributes, class names, hrefs) in server templates,
    // keeping offsets so line numbers stay right.
    const raw = text
      .replace(/<[^<>]*>|^[^<>]*>|<[^<>]*$/g, (t) => t.replace(/[^\n]/g, ' '));
    for (const { re, use } of RETIRED) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(raw))) {
        if (/[.\-_]/.test(raw[m.index - 1] || '') || /[\-_]/.test(raw[m.index + m[0].length] || '')) continue; // css or file names
        const { line } = sf.getLineAndCharacterOfPosition(start + m.index);
        const here = lines[line] || '';
        const above = lines[line - 1] || '';
        if (/glossary-ok/.test(here) || /glossary-ok/.test(above)) continue;
        if (ALLOW.some((a) => a.file.test(rel) && a.re.test(m[0]))) continue;
        problems.push(`${rel}:${line + 1}: "${m[0]}" is retired; use ${use}\n    ${here.trim().slice(0, 140)}`);
      }
    }
  }
}

if (problems.length) {
  console.error(`Glossary check: ${problems.length} retired word(s) in user-facing copy (docs/CLARITY_PLAN.md, C1)\n`);
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`Glossary check: ${FILES.length} files clean.`);
