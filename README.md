# Eir & Wild bookings

Lara's own booking system for Eir & Wild classes, courses and baby massage, at **book.eirandwild.co.uk**.

**Stage 1** covers pay-as-you-go classes, courses, card payments, waiting lists, emails and Lara's admin area. **Stage 2** adds class passes, term passes, PT memberships and client accounts. Gift vouchers and moving clients over from Bookwhen come in Stage 3, and Bookwhen stays live until everything is tested.

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
- **Passes** at `/passes`: buy a class pass (e.g. 5 classes in 90 days) or a term pass (between set dates) by card.
- **Client accounts** at `/account`, signed in by an emailed link with no password: see your passes (classes left, use-by date) and upcoming bookings.
- **Book with my pass**: signed-in clients with a pass that covers a class book it in one tap. Cancelling at least 4 hours before puts the class back on the pass.

**For Lara** (at `/admin`, signed in by an emailed link with no password)
- Upcoming classes with numbers booked, and past classes.
- Each class's register: tick who's there, see contact details and how they paid.
- Add weekly classes (e.g. every Monday for 8 weeks), courses (with optional pro-rata pricing and drop-in places), new class types and venues.
- Add someone herself (cash, gift, prize or make-up session), move someone to another class, or cancel a booking with or without a refund.
- Cancel a class: everyone is emailed, pay-as-you-go bookings are refunded in full, pass bookings go back on the pass, and course bookings keep their other sessions.
- **Passes**: add pass types (price, number of classes or unlimited, how long they last or set term dates, which classes they cover) and put them on or off sale.
- **Clients**: search clients, see their passes and bookings, give someone a pass (a prize, a PT membership, or one paid in cash), change a pass's classes or end date, or cancel a pass with an optional refund.
- Add someone to a class using their pass.

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
3. **Tables and classes.** These are set up automatically on every Vercel build (`npm run build` runs `db:migrate` and `db:seed`, both safe to repeat). To run them by hand:
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

## Passes set up automatically

The first build adds Lara's Bookwhen passes: the Womanhood 5-class (£30, 90 days) and 10-class (£60, 180 days) passes for Dance & Tone, Strong & Stretched and online HIIT (not Monday Double), and three PT memberships with unlimited online HIIT for 28 days (£95, £110, £180), which are not on sale and are given from a client's page. Motherhood term passes are added each term in **Admin → Passes**.

## Still to come (Stage 3)

- Gift vouchers.
- Importing clients from Bookwhen.
- Switching eirandwild.co.uk to show dates from this site instead of Bookwhen.
