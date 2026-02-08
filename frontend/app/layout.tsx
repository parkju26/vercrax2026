import "./globals.css";

export const metadata = {
  title: "Vercrax",
  description: "4-engine debate judgment system"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="min-h-screen bg-neutral-50 text-neutral-900">
        {children}
      </body>
    </html>
  );
}
