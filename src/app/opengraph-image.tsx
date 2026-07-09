import { ImageResponse } from "next/og";

export const alt = "Reidar Project OS dashboard";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#090b0c",
          color: "#f5f7f5",
          padding: "72px 80px",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "16px", fontSize: 28 }}>
          <div style={{ width: 18, height: 18, background: "#62e58a" }} />
          <div>REIDAR / PROJECT OS</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", maxWidth: 980 }}>
          <div style={{ fontSize: 76, fontWeight: 700, lineHeight: 1.05 }}>
            Projects, operations, and evidence.
          </div>
          <div style={{ marginTop: 28, color: "#a7ada9", fontSize: 30 }}>
            A trust-first view of what is active, experimental, monitored, and verified.
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", color: "#62e58a", fontSize: 24 }}>
          <span>reidar.tech</span>
          <span>Norway</span>
        </div>
      </div>
    ),
    size,
  );
}
