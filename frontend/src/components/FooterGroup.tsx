'use client';
import { ReactNode, useState } from 'react';

/** Footer link group: always open on desktop, an accordion on phones (the heading is the toggle). */
export default function FooterGroup({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`fg ${open ? 'open' : ''}`}>
      <h3><button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>{title}<span aria-hidden="true" /></button></h3>
      <div className="fg-body">{children}</div>
    </div>
  );
}
