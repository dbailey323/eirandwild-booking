import type { Metadata } from 'next';
import { BuyVoucherForm, VoucherBalanceForm } from '@/components/GiftForms';
import { VOUCHER_AMOUNTS_PENCE, VOUCHER_POLICY } from '@/lib/policy';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Gift vouchers',
  description: 'Give an Eir & Wild gift voucher for fitness classes, courses, passes and baby massage in Mountsorrel & Rothley.',
};

export default function GiftPage() {
  return (
    <>
      <section className="hero">
        <h1>Gift vouchers</h1>
        <p>Give someone special time for themselves: classes, courses, passes or baby massage with Eir &amp; Wild.</p>
      </section>
      <section className="card soft">
        <h2>Buy a gift voucher</h2>
        <p className="muted">{VOUCHER_POLICY}</p>
        <BuyVoucherForm amounts={VOUCHER_AMOUNTS_PENCE} policy="I agree to the gift voucher terms above." />
      </section>
      <section className="card soft">
        <h2>Check a voucher's balance</h2>
        <VoucherBalanceForm />
      </section>
    </>
  );
}
