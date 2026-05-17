import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Living Knowledge Spine",
  description: "Interactive knowledge graph for your Notion workspace",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          padding: 0,
          background: "#0d1117",
          color: "#e6edf3",
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
          overflow: "hidden",
        }}
      >
        {children}
      </body>
    </html>
  );
}
