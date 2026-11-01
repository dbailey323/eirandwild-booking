# Eir & Wild bookings

Lara's own booking system for Eir & Wild classes, courses and baby massage, at **book.eirandwild.co.uk**.

This is **Stage 1**: pay-as-you-go classes, courses, card payments, waiting lists, emails and Lara's admin area. Class passes, PT memberships and gift vouchers come in later stages, and Bookwhen stays live until everything is tested.

## What it does

**For clients**
- Schedule of upcoming classes and courses, filterable by Womanhood, Online HIIT, Motherhood and Baby Massage, with live spaces left.
- Book a class or a whole course, then pay by card on Stripe's secure checkout page.
- A place is held for 33 minutes while someone pays, so classes can't be overbooked.
- Confirmation email with a link to view or cancel the booking.
- Cancellation follows Lara's policy, with refunds sent back to the card automatically:
  - pay-as-you-go needs **4 hours'** notice
  - courses need **48 hours** before the course starts
- Waiting list on full classes. Everyone waiting is emailed when a place frees up.
- Reminder email the day before each class.

**For Lara** (at `/admin`, signed in by an emailed link with no password)
- Upcoming classes with numbers booked, and past classes.
- Each class's register: tick who's there, see contact details and how they paid.
- Add weekly classes (e.g. every Monday for 8 weeks), courses (with optional pro-rata pricing and drop-in places), new class types and venues.
- Add someone herself (cash, gift, prize or make-up session), move someone to another class, or cancel a booking with or without a refund.
- Cancel a class: everyone is emailed, pay-as-you-go bookings are refunded in full, and course bookings keep their other sessions.

**For the main website**
- `GET /api/public/schedule` returns upcoming classes with spaces left, so eirandwild.co.uk can show live dates from here instead of Bookwhen.

## How it's built

- **Next.js** (App Router), hosted on **Vercel**.
- **Postgres** with the Drizzle ORM. The schema is in `src/db/schema.ts` and the migrations are in `drizzle/`.
- **Stripe Checkout** for payments, so card details never touch this app. A webhook confirms paid bookings and releases expired ones.
- **Resend** for emails. Without an API key, emails are printed to the console.
- All booking rules live in `src/lib/booking.ts` and `src/lib/policy.ts`, covered by tests in `tests/`.

## Setting it up

1. **Database.** In the Vercel project, add a Postgres database (e.g. Neon from the Vercel Marketplace). This sets `DATABASE_URL`.
2. **Environment variables.** Copy `.env.example` and fill in each value in Vercel's project settings.
3. **Tables and classes.** Run these against the database:
   ```bash
   npm install
   npm run db:migrate   # creates the tables
   npm run db:seed      # adds Lara's venues and classes (safe to re-run)
   ```
4. **Stripe** (start in **test mode**):
   - In Lara's Stripe dashboard go to **Developers → API keys** and copy the secret key into `STRIPE_SECRET_KEY`.
   - Go to **Developers → Webhooks → Add endpoint** and enter `https://book.eirandwild.co.uk/api/stripe/webhook`. Select the events `checkout.session.completed`, `checkout.session.async_payment_succeeded` and `checkout.session.expired`.
   - Copy the endpoint's signing secret into `STRIPE_WEBHOOK_SECRET`.
5. **Emails.** Create a Resend account, verify the `eirandwild.co.uk` domain (it gives DNS records to add), and set `RESEND_API_KEY`. Replies go to `EMAIL_REPLY_TO`.
6. **Domain.** In Vercel, add `book.eirandwild.co.uk` to the project, and point a CNAME record for `book` at Vercel.
7. **Reminders.** `vercel.json` runs `/api/cron/reminders` daily at 9am UTC. Set `CRON_SECRET` and Vercel sends it automatically.

To test payments, use Stripe's test card `4242 4242 4242 4242` with any future expiry date and any CVC.

## Development

```bash
cp .env.example .env.local   # point DATABASE_URL at a local Postgres
npm run db:migrate && npm run db:seed
npm run dev                  # http://localhost:3000
npm test                     # booking-rule tests (in-memory Postgres, no setup needed)
npm run typecheck
```

After changing `src/db/schema.ts`, run `npm run db:generate` to create a new migration, then `npm run db:migrate`.

## Not in Stage 1 yet

- Class passes (5/10-class and term passes), PT memberships with unlimited HIIT, and gift vouchers.
- Client accounts. For now, clients manage bookings from the link in their emails.
- Importing clients from Bookwhen.
