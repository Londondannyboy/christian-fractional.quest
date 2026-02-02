import { AuthView } from '@neondatabase/auth/react/ui';
import Link from 'next/link';

export const dynamicParams = false;

export function generateStaticParams() {
  return [
    { path: 'sign-in' },
    { path: 'sign-up' },
    { path: 'sign-out' },
    { path: 'forgot-password' },
    { path: 'reset-password' },
    { path: 'verify-email' },
  ];
}

export default async function AuthPage({ params }: { params: Promise<{ path: string }> }) {
  const { path } = await params;

  const titles: Record<string, string> = {
    'sign-in': 'Welcome back',
    'sign-up': 'Create your account',
    'sign-out': 'Signing out...',
    'forgot-password': 'Reset your password',
    'reset-password': 'Set new password',
    'verify-email': 'Verify your email',
  };

  return (
    <main className="min-h-screen flex items-center justify-center p-4 bg-gray-50">
      {/* Subtle background pattern */}
      <div className="absolute inset-0 bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:20px_20px] opacity-50" />

      {/* Modal card */}
      <div className="relative w-full max-w-md">
        {/* Logo and branding */}
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 group">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-lg group-hover:shadow-blue-200 transition-shadow">
              <span className="text-white font-bold text-lg">C</span>
            </div>
            <span className="text-xl font-semibold text-gray-900">Careers Voice Assistant</span>
          </Link>
        </div>

        {/* Auth card */}
        <div className="bg-white rounded-2xl shadow-xl shadow-gray-200/50 border border-gray-100 p-8">
          <h1 className="text-2xl font-semibold text-gray-900 text-center mb-6">
            {titles[path] || 'Authentication'}
          </h1>

          <AuthView path={path} />
        </div>

        {/* Footer */}
        <p className="text-center text-sm text-gray-500 mt-6">
          By continuing, you agree to our{' '}
          <Link href="/terms" className="text-blue-600 hover:text-blue-700">Terms</Link>
          {' '}and{' '}
          <Link href="/privacy" className="text-blue-600 hover:text-blue-700">Privacy Policy</Link>
        </p>
      </div>
    </main>
  );
}
