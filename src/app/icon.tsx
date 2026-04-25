import { ImageResponse } from "next/og";

/**
 * Dynamic favicon generated at build + request time.
 * Next.js picks this up automatically for /favicon.ico and icon links in <head>.
 */
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#050608",
          color: "#e8e8ea",
          fontSize: 26,
          fontWeight: 300,
          letterSpacing: "-0.06em",
          fontFamily: "system-ui, sans-serif",
          lineHeight: 1,
        }}
      >
        a
      </div>
    ),
    { ...size },
  );
}
