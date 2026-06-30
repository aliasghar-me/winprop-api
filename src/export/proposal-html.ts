import { Document, Profile } from '@prisma/client';

const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

type Content = { summary?: string; scope?: string[]; timelineWeeks?: number; priceUsd?: number; closing?: string };

// Self-contained, branded HTML for the proposal PDF (no external CSS/JS, escaped
// content). Kept separate from rendering so it's unit-testable without a browser.
export function buildProposalHtml(doc: Document, profile: Profile | null): string {
  const c = (doc.contentJson ?? {}) as Content;
  const brand = profile?.brandColor || '#6366F1';
  const agency = esc(profile?.agencyName || 'WinProp');
  const logo = profile?.logoUrl;
  const price = typeof c.priceUsd === 'number' ? `$${c.priceUsd.toLocaleString('en-US')}` : '';
  const scope = (c.scope ?? []).map((s) => `<li>${esc(s)}</li>`).join('');
  const header = logo
    ? `<img src="${esc(logo)}" alt="${agency}" style="height:40px"/>`
    : `<div class="mark">${esc(profile?.brandShort || 'WP')}</div>`;

  return `<!doctype html><html><head><meta charset="utf-8"/><style>
    :root{--brand:${esc(brand)}}
    *{box-sizing:border-box} body{font-family:-apple-system,Segoe UI,Inter,sans-serif;color:#111;margin:0;padding:48px;font-size:14px;line-height:1.6}
    .top{display:flex;align-items:center;justify-content:space-between;border-bottom:3px solid var(--brand);padding-bottom:16px;margin-bottom:28px}
    .mark{width:40px;height:40px;border-radius:8px;background:var(--brand);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700}
    .agency{font-weight:600;color:#555}
    h1{font-size:24px;margin:0 0 24px} h2{font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:var(--brand);margin:24px 0 6px}
    ul{margin:6px 0;padding-left:20px} .price{font-size:22px;font-weight:700}
    .foot{margin-top:40px;padding-top:12px;border-top:1px solid #eee;color:#999;font-size:11px;text-align:center}
  </style></head><body>
    <div class="top">${header}<span class="agency">${agency}</span></div>
    <h1>${esc(doc.title)}</h1>
    ${c.summary ? `<h2>Summary</h2><p>${esc(c.summary)}</p>` : ''}
    ${scope ? `<h2>Scope</h2><ul>${scope}</ul>` : ''}
    ${typeof c.timelineWeeks === 'number' ? `<h2>Timeline</h2><p>${esc(c.timelineWeeks)} weeks</p>` : ''}
    ${price ? `<h2>Investment</h2><p class="price">${esc(price)}</p>` : ''}
    ${c.closing ? `<h2>Next steps</h2><p>${esc(c.closing)}</p>` : ''}
    <div class="foot">Powered by WinProp</div>
  </body></html>`;
}
