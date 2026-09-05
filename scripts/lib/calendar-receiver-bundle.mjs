/** Compile the reviewed pure receiver source for n8n without runtime imports.
 * This is a build tool, not an execution sandbox or a workflow publisher.
 * No secrets, provider requests, credentials or environment configuration here. */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import ts from 'typescript';

const sourceFiles = ['src/lib/n8n/calendarDates.ts', 'src/lib/n8n/calendarReceiver.ts'];
const publicNames = ['calendarWeekStarts', 'CALENDAR_CAMPAIGN_QUERY', 'CALENDAR_CAMPAIGN_QUERY_HASH',
  'CALENDAR_CAMPAIGN_URL', 'validateCalendarIncoming', 'authorizeCalendarReceiver',
  'calendarNextPage', 'collectCalendarCampaigns', 'buildCalendarEnvelope'];
const root = new URL('../../', import.meta.url);

export function buildCalendarReceiverBundle() {
  const inputs = sourceFiles.map(path => ({ path, source: readFileSync(new URL(path, root), 'utf8') }));
  const chunks = inputs.map(({ path, source }) => {
    const ast = ts.createSourceFile(path, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
    if (ast.parseDiagnostics.length) throw new Error(`Invalid receiver source: ${path}`);
    const transformed = ts.transform(ast, [context => node => {
      const visit = child => {
        if (ts.isImportDeclaration(child)) {
          const clause = child.importClause;
          if (clause?.isTypeOnly) return undefined;
          // Exactly one local runtime dependency, compiled before its consumer.
          if (path !== sourceFiles[1] || child.moduleSpecifier.text !== './calendarDates' ||
            !clause?.namedBindings || !ts.isNamedImports(clause.namedBindings) ||
            clause.namedBindings.elements.length !== 1 || clause.namedBindings.elements[0].name.text !== 'calendarWeekStarts' ||
            clause.namedBindings.elements[0].propertyName || clause.name)
            throw new Error(`Unreviewed receiver runtime import: ${path}`);
          return undefined;
        }
        if (ts.isExportDeclaration(child) || ts.isExportAssignment(child)) throw new Error(`Unreviewed receiver re-export: ${path}`);
        if (child.kind === ts.SyntaxKind.ExportKeyword) return undefined;
        return ts.visitEachChild(child, visit, context);
      };
      return ts.visitNode(node, visit);
    }]);
    try { return ts.createPrinter({ newLine: ts.NewLineKind.LineFeed }).printFile(transformed.transformed[0]); }
    finally { transformed.dispose(); }
  });
  const compiled = ts.transpileModule(chunks.join('\n'), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, removeComments: true,
  }, reportDiagnostics: true });
  if (compiled.diagnostics?.some(d => d.category === ts.DiagnosticCategory.Error)) throw new Error('Receiver transpilation failed');
  const expression = `(() => {\n"use strict";\n${compiled.outputText}\nreturn { ${publicNames.join(', ')} };\n})()`;
  const sha256 = v => createHash('sha256').update(v).digest('hex');
  return { expression, sha256: sha256(expression), compilerVersion: ts.version,
    inputs: inputs.map(({ path, source }) => ({ path, sha256: sha256(source) })) };
}
