// Database schema for Eir & Wild bookings.
//
// A class type (e.g. "Dance & Tone") has many dated sessions. Sessions can be booked
// one at a time (pay as you go) or, when they belong to a course (e.g. a 4-week baby
// massage course), together as one course booking. Every booking creates one
// registration per session it covers; spaces are counted from registrations.

import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';

export const locations = pgTable('locations', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  address: text('address').notNull().default(''),
  online: boolean('online').notNull().default(false),
});

export const classTypes = pgTable('class_types', {
  id: serial('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  // motherhood | womanhood | hiit | babymassage
  group: text('group').notNull(),
  description: text('description').notNull().default(''),
  defaultPricePence: integer('default_price_pence').notNull().default(0),
  defaultCapacity: integer('default_capacity').notNull().default(12),
  defaultDurationMinutes: integer('default_duration_minutes').notNull().default(30),
  defaultLocationId: integer('default_location_id').references(() => locations.id),
  active: boolean('active').notNull().default(true),
});

export const courses = pgTable('courses', {
  id: serial('id').primaryKey(),
  classTypeId: integer('class_type_id').notNull().references(() => classTypes.id),
  name: text('name').notNull(),
  pricePence: integer('price_pence').notNull(),
  capacity: integer('capacity').notNull(),
  // When true, people can join after the course has started and pay only for the
  // sessions left. When false (e.g. baby massage) it can only be booked before it starts.
  proRata: boolean('pro_rata').notNull().default(false),
  // Pay-as-you-go places on individual course sessions are offered when this is set
  allowDropIn: boolean('allow_drop_in').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable(
  'sessions',
  {
    id: serial('id').primaryKey(),
    classTypeId: integer('class_type_id').notNull().references(() => classTypes.id),
    courseId: integer('course_id').references(() => courses.id),
    locationId: integer('location_id').references(() => locations.id),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    capacity: integer('capacity').notNull(),
    // Pay-as-you-go price; null means this session can only be booked as part of its course
    pricePence: integer('price_pence'),
    // scheduled | cancelled
    status: text('status').notNull().default('scheduled'),
    notes: text('notes').notNull().default(''),
  },
  (t) => [index('sessions_starts_at_idx').on(t.startsAt)],
);

export const customers = pgTable('customers', {
  id: serial('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  phone: text('phone').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const bookings = pgTable(
  'bookings',
  {
    id: text('id').primaryKey(),
    customerId: integer('customer_id').notNull().references(() => customers.id),
    // session | course
    kind: text('kind').notNull(),
    sessionId: integer('session_id').references(() => sessions.id),
    courseId: integer('course_id').references(() => courses.id),
    // pending (awaiting payment) | confirmed | cancelled | expired
    status: text('status').notNull().default('pending'),
    amountPence: integer('amount_pence').notNull(),
    refundedPence: integer('refunded_pence').notNull().default(0),
    // stripe | free | cash | manual | pass
    paymentMethod: text('payment_method').notNull().default('stripe'),
    stripeCheckoutId: text('stripe_checkout_id'),
    stripePaymentIntentId: text('stripe_payment_intent_id'),
    // The client's pass that paid for this booking (paymentMethod 'pass')
    passId: text('pass_id'),
    // Secret used in the "manage your booking" link sent by email
    manageToken: text('manage_token').notNull().unique(),
    holdExpiresAt: timestamp('hold_expires_at', { withTimezone: true }),
    notes: text('notes').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  },
  (t) => [index('bookings_customer_idx').on(t.customerId)],
);

export const registrations = pgTable(
  'registrations',
  {
    id: serial('id').primaryKey(),
    bookingId: text('booking_id').notNull().references(() => bookings.id),
    sessionId: integer('session_id').notNull().references(() => sessions.id),
    // active | cancelled
    status: text('status').notNull().default('active'),
    attended: boolean('attended').notNull().default(false),
    reminderSentAt: timestamp('reminder_sent_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('registrations_booking_session_idx').on(t.bookingId, t.sessionId),
    index('registrations_session_idx').on(t.sessionId),
  ],
);

export const waitlist = pgTable('waitlist', {
  id: serial('id').primaryKey(),
  sessionId: integer('session_id').references(() => sessions.id),
  courseId: integer('course_id').references(() => courses.id),
  customerId: integer('customer_id').notNull().references(() => customers.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  notifiedAt: timestamp('notified_at', { withTimezone: true }),
});

export const adminLoginTokens = pgTable('admin_login_tokens', {
  tokenHash: text('token_hash').primaryKey(),
  email: text('email').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
});

// ---------------------------------------------------------------- Stage 2: passes

// Something Lara sells (or gives away) that pays for classes instead of paying each time:
// a 5-class pass, a term pass or a PT membership with unlimited HIIT.
export const passTypes = pgTable('pass_types', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  pricePence: integer('price_pence').notNull(),
  // Number of classes it covers; null means unlimited
  credits: integer('credits'),
  // days: valid for validityDays from purchase | dates: valid between validFrom and validUntil
  validity: text('validity').notNull().default('days'),
  validityDays: integer('validity_days'),
  // London dates, YYYY-MM-DD (both inclusive)
  validFrom: text('valid_from'),
  validUntil: text('valid_until'),
  // Shown for sale on the booking site; off for passes Lara only gives out herself
  onSale: boolean('on_sale').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Which classes a pass type can be used for
export const passTypeClasses = pgTable(
  'pass_type_classes',
  {
    passTypeId: integer('pass_type_id').notNull().references(() => passTypes.id),
    classTypeId: integer('class_type_id').notNull().references(() => classTypes.id),
  },
  (t) => [uniqueIndex('pass_type_classes_idx').on(t.passTypeId, t.classTypeId)],
);

// A pass belonging to a client
export const customerPasses = pgTable(
  'customer_passes',
  {
    id: text('id').primaryKey(),
    customerId: integer('customer_id').notNull().references(() => customers.id),
    passTypeId: integer('pass_type_id').notNull().references(() => passTypes.id),
    // pending (awaiting payment) | active | cancelled | expired (unpaid checkout)
    status: text('status').notNull().default('pending'),
    // Copied from the pass type when issued, so Lara can adjust one client's pass; null = unlimited
    creditsTotal: integer('credits_total'),
    creditsUsed: integer('credits_used').notNull().default(0),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    amountPence: integer('amount_pence').notNull(),
    refundedPence: integer('refunded_pence').notNull().default(0),
    // stripe | free | cash | manual
    paymentMethod: text('payment_method').notNull().default('stripe'),
    stripeCheckoutId: text('stripe_checkout_id'),
    stripePaymentIntentId: text('stripe_payment_intent_id'),
    notes: text('notes').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  },
  (t) => [index('customer_passes_customer_idx').on(t.customerId)],
);

// One-time sign-in links for clients' accounts
export const customerLoginTokens = pgTable('customer_login_tokens', {
  tokenHash: text('token_hash').primaryKey(),
  customerId: integer('customer_id').notNull().references(() => customers.id),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
});
