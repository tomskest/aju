"use client";

import { useEffect, useState } from "react";

type Format = "date" | "datetime";

/**
 * Render a date in the viewer's locale without breaking SSR. The first
 * paint emits an empty string (server and client agree), then `useEffect`
 * fills in the localized form after mount. This avoids the en-US-vs-other
 * hydration mismatch that crashes any sibling effect in the same subtree
 * (most painfully, KbProse's mermaid renderer).
 */
export default function LocalDate({
  value,
  format = "date",
  className,
}: {
  value: string | null | undefined;
  format?: Format;
  className?: string;
}) {
  const [label, setLabel] = useState("");

  useEffect(() => {
    if (!value) {
      setLabel("");
      return;
    }
    const d = new Date(value);
    setLabel(format === "datetime" ? d.toLocaleString() : d.toLocaleDateString());
  }, [value, format]);

  if (!value) return null;
  return <span className={className}>{label}</span>;
}
