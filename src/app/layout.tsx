import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Book a class | Eir & Wild', template: '%s | Eir & Wild bookings' },
  description: 'Book Eir & Wild fitness classes, courses and baby massage in Mountsorrel & Rothley.',
};

export const viewport: Viewport = { themeColor: '#000562' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&display=swap" />
      </head>
      <body>
        <header className="site-header">
          <div className="container">
            <Link className="brand" href="/">
              <span className="brand-name">Eir &amp; Wild</span>
              <span className="brand-sub">Bookings</span>
            </Link>
            <nav className="header-links" aria-label="Main">
              <Link className="header-link" href="/passes">Passes</Link>
              <Link className="header-link" href="/gift">Gift vouchers</Link>
              <Link className="header-link" href="/account">My account</Link>
              <a className="header-link" href="https://www.eirandwild.co.uk">Main website</a>
            </nav>
          </div>
        </header>
        <main className="container">{children}</main>
        <footer className="site-footer">
          <div className="container">
            Eir &amp; Wild Wellness · Mountsorrel &amp; Rothley, Leicestershire ·{' '}
            <a href="mailto:hello@eirandwild.co.uk">hello@eirandwild.co.uk</a> · <Link href="/policies">Booking &amp; refund policy</Link> ·{' '}
            <a href="https://www.eirandwild.co.uk/privacy">Privacy</a>
          </div>
        </footer>
      </body>
    </html>
  );
}
