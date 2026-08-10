/**
 * bpmn-js-differ ships no TypeScript types. This shim declares the one
 * export we use, typed against the shapes documented in its README.
 */
declare module "bpmn-js-differ" {
  type DiffModel = {
    $type: string;
    id: string;
    name?: string;
    [key: string]: unknown;
  };

  type DiffResult = {
    _added: Record<string, DiffModel>;
    _removed: Record<string, DiffModel>;
    _changed: Record<
      string,
      {
        model: DiffModel;
        attrs: Record<string, { oldValue: unknown; newValue: unknown }>;
      }
    >;
    _layoutChanged: Record<string, DiffModel>;
  };

  export function diff(a: unknown, b: unknown, handler?: unknown): DiffResult;
}
