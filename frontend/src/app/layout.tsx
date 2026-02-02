import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import "@copilotkit/react-ui/styles.css";
import { CopilotKit } from "@copilotkit/react-core";
import { NeonAuthUIProvider, UserButton } from "@neondatabase/auth/react/ui";
import { authClient } from "@/lib/auth/client";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Careers Voice Assistant",
  description: "AI-powered career coaching and job search assistant",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <NeonAuthUIProvider
          authClient={authClient}
          redirectTo="/dashboard"
          emailOTP
          social={{ providers: ['google'] }}
        >
          <CopilotKit runtimeUrl="/api/copilotkit" agent="careers_coach">
            <header className="flex justify-between items-center p-4 border-b">
              <h1 className="text-xl font-bold">Careers Voice Assistant</h1>
              <UserButton />
            </header>
            <main>{children}</main>
          </CopilotKit>
        </NeonAuthUIProvider>
      </body>
    </html>
  );
}
