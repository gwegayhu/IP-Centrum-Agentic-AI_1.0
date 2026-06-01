import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'IP Centrum — Agentic AI Platform',
  description: 'Patent validation and renewals intelligence platform',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full bg-gray-50">
      <body className="h-full font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
