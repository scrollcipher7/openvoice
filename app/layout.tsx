import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { LanguageProvider } from "./LanguageContext";
import InstallApp from "./InstallApp";
import NativeInitializer from "./NativeInitializer";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "OpenVoice",
  description: "A social platform for honest conversation.",
  applicationName: "OpenVoice",
  appleWebApp: {
    capable: true,
    title: "OpenVoice",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: "/openvoice-192.png",
    apple: "/openvoice-192.png",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <meta name="google-adsense-account" content="ca-pub-4101694155261697" />
        <script
          async
          src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-4101694155261697"
          crossOrigin="anonymous"
        ></script>
      </head>
      <body className="min-h-full flex flex-col">
        <NativeInitializer />
        <LanguageProvider>
          {children}
          <InstallApp />
        </LanguageProvider>
      </body>
    </html>
  );
}