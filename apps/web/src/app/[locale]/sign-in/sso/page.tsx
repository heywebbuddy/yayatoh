import { redirect } from 'next/navigation';
import { localizedPath } from '@/lib/seo/urls.ts';
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { locale } = await params;
  const { error } = await searchParams;
  redirect(`${localizedPath(locale, '/o/sign-in/sso')}${error ? `?${new URLSearchParams({ error })}` : ''}`);
}
