import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'MineRoute - AI Gateway & Team Router',
  description: 'Unified AI gateway, multi-provider proxy, and interactive team orchestrator.'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark">
      <head>
        <link rel="icon" type="image/png" href="/assets/zapi_icon.png" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet" />
        <link rel="stylesheet" href="/css/mine.css" />
      </head>
      <body>
        {children}
        <script src="/js/mineroute-bundle.js" defer></script>
      </body>
    </html>
  );
}
