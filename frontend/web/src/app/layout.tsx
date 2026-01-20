import type { Metadata } from "next"; // Next.js metadata type for the document head
import "./globals.css"; // Imports the global CSS styling for the app shell

export const metadata: Metadata = {
  title: "The Inventory Atlas", // Title of the webpage
  description: "Inventory management dashboard", // Description of the webpage
};

export default function RootLayout({ // The main layout component that wraps all pages
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
