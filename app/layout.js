import './globals.css';

export const metadata = {
  title: 'Threads Scout',
  description: 'Find outlier posts from public Threads accounts.'
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
