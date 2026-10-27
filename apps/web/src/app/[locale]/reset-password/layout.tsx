import type { ReactNode } from 'react';
import { AuthFrame } from '@/components/showcase/auth-frame.tsx';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return <AuthFrame>{children}</AuthFrame>;
}
