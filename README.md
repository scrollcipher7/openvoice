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

## Languages

The interface supports English and Spanish. Use the language selector on the sign-in screen or the language button in the app header; the choice is saved in the current browser. Interface labels are translated, while posts, profile text, captions, and chat messages stay in the language their authors wrote them.

## Dating selfie-photo review and match calls

Dating access requires an admin to manually review a private selfie photo against the account photo when available. Admin accounts are automatically approved for Dating, but still need to self-attest that they are at least 18. This is not face recognition, identity verification, or proof of age. Selfie photos are stored in a private Supabase Storage bucket and deleted after review. Discovery stays locked for non-admin accounts until an admin approves the check.

Dating profiles can include up to three regular photos, one meme, and one AI-generated self-photo. Meme and AI images are labeled in discovery. Profile owners can replace or remove each image. The “Looking for” selection is Friendship, Dating, or Marriage. Gender is Male or Female, with an optional “I’m transgender” self-description that appears on discovery profiles only when selected.

Mutual matches get conversation starter prompts in their private match chat and can start audio or video calls with each other there. The recipient must have that match chat open to receive a call. Call signaling is restricted to the two verified match members. Calls remain separate from selfie review and use TURN for media.

## Friends, messages, alerts, and feedback

Members can send friend requests from profiles. Private messaging and audio/video calls become available only after a request is accepted; both people must have the conversation open to receive a call. Admins can also start private, text-only moderation conversations with members without a friend request. Members can report other profiles; reports alert admins and appear in the admin queue, where admins can message the reported member. Alerts also cover incoming and accepted friend requests, comments, shares, and member feedback or suggestions. Feedback forms appear on non-admin profiles; admins receive an alert for each new submission and can review and resolve submissions in their profile's admin panel.

Apply `supabase/migrations/20261108130000_friends_messenger_alerts_feedback.sql`, `supabase/migrations/20261108133000_feedback_admin_alerts.sql`, and `supabase/migrations/20261108140000_profile_reports_admin_messaging.sql` after the migrations listed below. The follow-up migrations add feedback alerts, profile reporting, admin moderation messages, and moderation-message alerts; apply them even if the friends-and-messaging migration was already applied. Sharing notifications are recorded only after the share succeeds. Friend calls use the same TURN settings as Dating calls; moderation conversations are text-only.

## Stories

The top-bar **+** menu offers Post, Reel, and Story. Stories support images and videos up to 60 seconds / 50 MB, can include a caption, and disappear from the active Stories feed after 24 hours. Story media is stored in a private bucket and served with signed URLs. Apply `supabase/migrations/20261108150000_profile_stories.sql` after the other social-feature migrations.

## Reels

Reels support short video uploads, camera recording, likes, reports, and two remix layouts: side-by-side Duet and original-then-reaction. Videos are private in Supabase Storage; the feed uses temporary signed URLs. Every new Reel stays hidden until an admin reviews and approves it. Reports go to the admin queue. Documentary footage of fights and police activity is allowed; threats, calls for violence, graphic gore, doxxing, sexual content, and nudity are not. If an admin confirms nudity, they can remove the Reel and ban that creator from Reels. This is manual moderation, not automatic detection, and the ban applies to Reels rather than the whole OpenVoice account.

Before using it:

1. Apply `supabase/migrations/20261108090000_dating_mvp.sql` to the Supabase project.
2. Apply `supabase/migrations/20261108113000_dating_selfie_photo_review.sql` to the Supabase project.
3. Apply `supabase/migrations/20261108115500_admin_dating_auto_approval.sql` to the Supabase project. Admin accounts still need to save a date of birth and self-attest that they are 18 or older; their selfie review is automatically approved.
4. Apply `supabase/migrations/20261108121500_reels_and_remixes.sql` to enable Reels and private video storage.
5. Apply `supabase/migrations/20261108130000_friends_messenger_alerts_feedback.sql` to enable friend requests, messages, alerts, and profile feedback.
6. Apply `supabase/migrations/20261108133000_feedback_admin_alerts.sql` to notify admins of member feedback and suggestions.
7. Apply `supabase/migrations/20261108140000_profile_reports_admin_messaging.sql` to enable profile reports and admin moderation conversations.
8. Apply `supabase/migrations/20261108150000_profile_stories.sql` to enable 24-hour Stories.
9. In Supabase Realtime settings, disable **Allow public access** so private match and friend-call signaling channels are protected by the migrations' policies.
10. Configure a TURN server that supports coturn REST API shared-secret authentication. Set the server-only app environment variables below in local development and the production host. Do not prefix the secret with `NEXT_PUBLIC_`.

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
