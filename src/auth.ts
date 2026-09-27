import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import Google from 'next-auth/providers/google';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { employees } from '@/db/schema';

/** Only Google accounts on this domain can sign in. */
export const allowedDomain = (process.env.AUTH_ALLOWED_DOMAIN ?? 'ems-itech.com').toLowerCase();

/**
 * A public demo with sample people (DEMO_MODE=true): anyone can sign in as anyone, and every page says so.
 * Never set it where real data lives.
 */
export const demoMode = process.env.DEMO_MODE === 'true';

/** Pick-a-person sign-in: local development, or a demo site. Never on for a real production site. */
export const devLoginEnabled =
  demoMode || (process.env.AUTH_DEV_LOGIN === 'true' && process.env.NODE_ENV !== 'production');

/** Google sign-in only shows once a Google OAuth client is configured. */
export const googleEnabled = !!process.env.AUTH_GOOGLE_ID;

async function findActiveEmployee(email: string) {
  const db = await getDb();
  const [row] = await db.select().from(employees).where(eq(employees.email, email.toLowerCase()));
  return row?.active ? row : null;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: 'jwt', maxAge: 8 * 60 * 60 },
  pages: { signIn: '/signin', error: '/signin' },
  providers: [
    // `hd` only pre-selects the company account in Google's picker; the real check is in signIn below.
    Google({ authorization: { params: { hd: allowedDomain, prompt: 'select_account' } } }),
    ...(devLoginEnabled
      ? [
          Credentials({
            id: 'dev',
            name: 'Developer sign-in',
            credentials: { email: { label: 'Email', type: 'email' } },
            async authorize(credentials) {
              const person = await findActiveEmployee(String(credentials?.email ?? ''));
              return person ? { id: person.id, email: person.email, name: person.nameEn } : null;
            },
          }),
        ]
      : []),
  ],
  callbacks: {
    async signIn({ account, profile, user }) {
      if (account?.provider === 'google') {
        const email = profile?.email?.toLowerCase();
        if (!email || profile?.email_verified !== true) return '/signin?error=unverified';
        if (!email.endsWith(`@${allowedDomain}`)) return '/signin?error=domain';
        // People must be added by People & Culture first; a valid company account alone is not enough.
        if (!(await findActiveEmployee(email))) return '/signin?error=not_registered';
        return true;
      }
      return account?.provider === 'dev' && devLoginEnabled && !!user;
    },
  },
});
