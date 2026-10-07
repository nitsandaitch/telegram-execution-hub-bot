export const metadata = { title: "Telegram Execution Hub Bot" };

export default function RootLayout({ children }) {
  return (
    <html lang="he" dir="rtl">
      <body style={{ fontFamily: "system-ui", maxWidth: 760, margin: "60px auto", padding: "0 20px" }}>
        {children}
      </body>
    </html>
  );
}
