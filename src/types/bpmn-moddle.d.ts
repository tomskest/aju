/**
 * bpmn-moddle ships no TypeScript types. Only the test suite imports it
 * directly (the browser parses XML through a bpmn-js viewer instead), so
 * this shim covers just the parse call that test needs.
 */
declare module "bpmn-moddle" {
  export class BpmnModdle {
    constructor(packages?: unknown, options?: unknown);
    fromXML(
      xml: string,
      typeName?: string,
    ): Promise<{
      rootElement: unknown;
      warnings: unknown[];
    }>;
  }
}
