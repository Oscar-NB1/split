import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

/**
 * The two typefaces, vendored into the repo as variable woff2 files.
 *
 * Not `next/font/google`, which downloads them at build time — that made a clean
 * build require network access to fonts.gstatic.com and fail without it. Not a
 * stylesheet link either: the CDN serves different CSS per user-agent, and one
 * variant was 404ing, silently falling back to the body face and flattening
 * every display heading in the app.
 *
 * Vendoring gives a deterministic, offline, network-free build, and a PWA that
 * still has its typography on a phone in a gym with no signal. One variable file
 * per family covers every weight used, at 48kB and 30kB.
 */
const inter = localFont({
  src: "./fonts/inter.woff2",
  variable: "--f-body", display: "swap", weight: "400 800",
});
const instrument = localFont({
  src: "./fonts/instrument.woff2",
  variable: "--f-display", display: "swap", weight: "400 700",
});

export const metadata: Metadata = {
  title: "Split",
  description: "Two athletes, one calendar.",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Split" },
};

export const viewport: Viewport = {
  themeColor: "#FFFFFF",
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${instrument.variable}`}>
      <head>
        {/* Applied before first paint: reading the stored theme in an effect
            means every dark-mode load flashes white first. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('split-theme');if(t==='dark')document.documentElement.dataset.theme='dark'}catch(e){}`,
          }}
        />
      </head>
      <body>
        {children}
        <script
          dangerouslySetInnerHTML={{
            __html: `if('serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}))}`,
          }}
        />
      </body>
    </html>
  );
}
