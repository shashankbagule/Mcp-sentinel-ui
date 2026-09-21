import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "MCP-Sentinel — MCP Security Scanner",
  description: "Automated security scanning for Model Context Protocol servers",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#0a0e1a] text-slate-200 antialiased">
        <nav className="border-b border-slate-800 bg-[#0d1225]/80 backdrop-blur sticky top-0 z-50">
          <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-red-500 to-orange-500 flex items-center justify-center text-white font-bold text-sm">S</div>
              <span className="font-semibold text-white text-lg tracking-tight">MCP-Sentinel</span>
              <span className="text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full border border-red-500/30">BETA</span>
            </div>
            <div className="flex items-center gap-6 text-sm text-slate-400">
              <Link href="/" className="hover:text-white transition-colors">Scanner</Link>
              <a href="/history" className="hover:text-white transition-colors">History</a>
              <a href="https://github.com" className="hover:text-white transition-colors">Docs</a>
            </div>
          </div>
        </nav>
        <main>{children}</main>
        <footer className="border-t border-slate-800 mt-20 py-8 text-center text-slate-600 text-sm">
          MCP-Sentinel · Built by Shashank · For security research only
        </footer>
      </body>
    </html>
  );
}
