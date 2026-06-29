import './globals.css';

export const metadata = {
  title: 'OTCMS Training · Bulk SMS Sender',
  description: 'OTCMS Pharmacy Council bulk SMS sender via Arkesel',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
