// Minimal shell — lang and providers are set per-locale in app/[locale]/layout.tsx
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
