import { AccountSignInPage } from '@/components/account-sign-in-page.tsx';
export default function Page(props: Parameters<typeof AccountSignInPage>[0]) {
  return <AccountSignInPage {...props} audience="organizer" />;
}
