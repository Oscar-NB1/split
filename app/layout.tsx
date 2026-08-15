import type { Metadata, Viewport } from "next";
import { Inter, Instrument_Sans } from "next/font/google";
import "./globals.css";

/**
 * Self-hosted at build time rather than fetched from the Google CDN.
 *
 * Three reasons, in order of how much they matter here: this is a PWA that has
 * to work on a phone in a gym with no signal, and a font that arrives over the
 * network does not; the CDN serves different CSS per user-agent, and one of
 * those variants was 404ing on us, silently falling back to the body face and
 * flattening every display heading in the app; and a render-blocking third-party
 * request on first paint is a poor trade for two typefaces.
 */
const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], variable: "--f-body", display: "swap" });
const instrument = Instrument_Sans({ subsets: ["latin"], weight: ["600", "700"], variable: "--f-display", display: "swap" });

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
