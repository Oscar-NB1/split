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
  title: "Hyrox Coaching App",
  description: "Hyrox and running plans that build themselves from your own training.",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Hyrox" },
};

export const viewport: Viewport = {
  /*
   * The colour iOS paints the strip the web view does not cover.
   *
   * With `viewport-fit=cover` and a translucent status bar, the area around the home
   * indicator belongs to the OS, and it fills it with `theme-color` — not with the
   * page background. A single white value meant a dark-themed app in the installed
   * PWA had a white band across the bottom of the screen, which is exactly the
   * "awkward blank space" it looks like. No amount of padding inside the tab bar
   * touches it, because the strip is outside the document.
   *
   * Two values here so it is right from first paint. The app also has its own theme
   * toggle, which the OS knows nothing about, so the script below keeps this in step
   * with the athlete's choice rather than only with their phone's.
   */
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F1F4F7" },
    { media: "(prefers-color-scheme: dark)", color: "#0F2233" },
  ],
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
            /*
             * The stored theme, and the OS strip's colour with it.
             *
             * `theme-color` is what iOS paints around the home indicator, so it has to
             * follow the athlete's own toggle and not just their phone's setting —
             * otherwise a dark app on a light phone shows a white band at the bottom.
             * Set here, before first paint, and again by the toggle in Profile.
             */
            __html: `try{var t=localStorage.getItem('split-theme');var d=t==='dark'||(t!=='light'&&window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches);if(t==='dark')document.documentElement.dataset.theme='dark';var m=document.querySelector('meta[name=theme-color]:not([media])')||document.head.appendChild(Object.assign(document.createElement('meta'),{name:'theme-color'}));m.setAttribute('content',d?'#0F2233':'#F1F4F7')}catch(e){}`,
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
