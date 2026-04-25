import { ImageResponse } from "next/og";

/**
 * Apple touch icon — used when users add aju.sh to their iOS home screen
 * or pin the tab in Safari. Renders at 180×180 per Apple's recommended size.
 */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
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
          fontSize: 130,
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
