import Link from 'next/link';
import { ImportForm } from './ImportForm';

export default function ImportPage() {
  return (
    <>
      <p><Link href="/admin/clients">← Clients</Link></p>
      <h1>Import clients from Bookwhen</h1>
      <section className="card soft">
        <ol>
          <li>In Bookwhen, open your <strong>customer list</strong> and choose <strong>Export</strong> (CSV).</li>
          <li>Choose the downloaded file below and press <strong>Preview</strong> to check the names look right.</li>
          <li>Press <strong>Import</strong>. You can import again later (e.g. just before switching over); people already here won't be duplicated.</li>
        </ol>
        <p className="muted">
          Clients with a pass in Bookwhen: find them on the Clients page and use <strong>Give a pass → Moving a pass over from Bookwhen</strong> to set their classes left and end date.
        </p>
        <ImportForm />
      </section>
    </>
  );
}
