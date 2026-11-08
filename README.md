This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Dating selfie-photo review and match calls

Dating access requires an admin to manually review a private selfie photo against the account photo when available. This is not face recognition, identity verification, or proof of age. Selfie photos are stored in a private Supabase Storage bucket and deleted after review. Discovery stays locked until an admin approves the check.

Dating profiles can include up to three regular photos, one meme, and one AI-generated self-photo. Meme and AI images are labeled in discovery. Profile owners can replace or remove each image. The “Looking for” selection is Friendship, Dating, or Marriage. Gender is Male or Female, with an optional “I’m transgender” self-description that appears on discovery profiles only when selected.

Mutual matches get conversation starter prompts in their private match chat and can start audio or video calls with each other there. The recipient must have that match chat open to receive a call. Call signaling is restricted to the two verified match members. Calls remain separate from selfie review and use TURN for media.

Before using it:

1. Apply `supabase/migrations/20261108090000_dating_mvp.sql` to the Supabase project.
2. Apply `supabase/migrations/20261108113000_dating_selfie_photo_review.sql` to the Supabase project.
3. In Supabase Realtime settings, disable **Allow public access** so private match-call signaling channels are protected by the migration's policies.
4. Configure a TURN server that supports coturn REST API shared-secret authentication. Set the server-only app environment variables below in local development and the production host. Do not prefix the secret with `NEXT_PUBLIC_`.

```env
DATING_TURN_URLS=turn:turn.example.com:3478?transport=udp,turns:turn.example.com:5349?transport=tcp
DATING_TURN_SHARED_SECRET=your-coturn-static-auth-secret
```

Configure coturn to use the same shared secret (`use-auth-secret` and `static-auth-secret`). The app issues one-hour, request-scoped TURN credentials; never put the shared secret in browser code. Calls require HTTPS (localhost is allowed for development). Without TURN configuration, matched users can still chat but audio/video calls are unavailable; photo review does not require TURN.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
