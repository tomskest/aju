/**
 * Renders KB markdown HTML with a terse, mono-accented prose style that
 * mirrors the landing / docs aesthetic. The HTML comes from a project-
 * scoped Marked instance that strips raw HTML input, so it is safe to
 * inject here.
 *
 * Styling hooks into the `kb-prose` class defined in globals.css.
 */
export default function KbProse({ html }: { html: string }) {
  return (
    <div
      className="kb-prose"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
