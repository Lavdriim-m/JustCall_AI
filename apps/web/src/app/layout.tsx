import type { Metadata, Viewport } from "next";
import { Toaster } from "sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "JustCall", template: "%s · JustCall" },
  description: "AI phone ordering for restaurants – in Swiss German.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f7f8" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0d10" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de-CH" suppressHydrationWarning>
      <head>
        <script
          // Apply a stored theme preference before paint to avoid flashes.
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("jc-theme");if(t==="dark"||t==="light")document.documentElement.dataset.theme=t}catch(e){}`,
          }}
        />
      </head>
      <body className="min-h-screen font-sans antialiased">
        {children}
        <Toaster richColors position="top-right" closeButton />
      </body>
    </html>
  );
}
