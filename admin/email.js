/* Email: write an email from a template and send it to the email list. Loaded by admin/index.html,
   which hands over its helpers and live data with EM.init({...}) (kept here as X).
   The finished email is built here (EM.build) and saved with the draft; the server only fills in each person's
   first name and unsubscribe link. */
const EM = (() => {
  let X = null;   // the admin's helpers and live data: $, esc, toast, layer, closeLayer, render, fmtD, fmtDT, D, and SB, ME, CONTACTS, EVENTS, PERMS, VIEW
  const $ = (q) => X.$(q), esc = (v) => X.esc(v), toast = (...a) => X.toast(...a), layer = (h) => X.layer(h), closeLayer = () => X.closeLayer(), render = () => X.render();
  const fmtD = (d) => X.fmtD(d), fmtDT = (d) => X.fmtDT(d), D = (v) => X.D(v);
  const SITE = 'https://wearecalledtocare.com';
  const NAVY = '#1D4766', TEAL = '#1E5F82', SKY = '#B5CFDC', SKYL = '#E8F1F6', PINK = '#E2197A', LPINK = '#F6C3DA', PINKL = '#FDF0F6';
  const INK = '#2B3440', MUTED = '#5E6B78', LINE = '#E4E9EE', CREAM = '#FBF8F4';
  const SERIF = "'Instrument Serif', Georgia, 'Times New Roman', serif", SANS = "Figtree, 'Helvetica Neue', Arial, sans-serif", CAPS = "Oswald, 'Arial Narrow', Arial, sans-serif";
  const PHOTOS = [['charity-dinner.jpg', 'Charity Dinner'], ['care-closet.jpg', 'Care Closet'], ['kids-living-room.jpg', 'Living room'], ['kids-outdoors.jpg', 'Kids outdoors'],
    ['kids-sunny-group.jpg', 'Sunny day'], ['kids-laughing.jpg', 'Kids laughing'], ['kids-huddle.jpg', 'Kids huddle'], ['kids-curls.jpg', 'Portrait']];

  /* ---------- building the email (tables and inline styles, for every inbox) ---------- */
  const e = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const link = (u) => { u = String(u || '').trim(); if (!u) return SITE; if (u.startsWith('{{')) return u; if (/^(https?:|mailto:|tel:)/i.test(u)) return u; if (u.startsWith('/') || u.startsWith('#')) return SITE + (u.startsWith('#') ? '/' : '') + u; return 'https://' + u; };
  const img = (src) => /^https?:/i.test(src || '') ? src : `${SITE}/assets/${src}`;
  // Light formatting staff can type: **bold**, *italic*, [words](link). Everything else is plain text.
  const fmt = (t, bold = NAVY) => e(t).replace(/\*\*([^*]+)\*\*/g, `<b style="color:${bold};">$1</b>`).replace(/\*([^*\n]+)\*/g, '<i>$1</i>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, a, u) => `<a href="${e(link(u.replace(/&amp;/g, '&')))}" style="color:${TEAL};font-weight:700;">${a}</a>`).replace(/\n/g, '<br>');
  const paras = (t) => String(t || '').split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean);
  const lines = (t) => String(t || '').split('\n').map((x) => x.trim()).filter(Boolean);
  const P = (t, { color = INK, size = 16, mb = 16, align = 'left' } = {}) => `<p style="margin:0 0 ${mb}px;font-family:${SANS};font-size:${size}px;line-height:${Math.round(size * 1.6)}px;color:${color};text-align:${align};">${t}</p>`;
  const pill = (label, url, bg = PINK, color = '#ffffff', align = 'left') => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 14px;"><tr><td align="${align}">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="background:${bg};border-radius:999px;"><a href="${e(link(url))}" style="display:inline-block;padding:15px 30px;font-family:${SANS};font-size:15px;font-weight:700;letter-spacing:.02em;color:${color};text-decoration:none;">${e(label)}&nbsp;&rarr;</a></td></tr></table></td></tr></table>`;
  const cols = (items, cell) => `<table role="presentation" class="stack" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${items.map((it) => `<td class="col" width="${Math.floor(100 / items.length)}%" valign="top" ${cell(it)}</td>`).join('')}</tr></table>`;

  const INLINE = {
    eyebrow: (b) => `<div style="font-family:${CAPS};font-size:13px;letter-spacing:.18em;text-transform:uppercase;color:${b.color === 'teal' ? TEAL : PINK};font-weight:600;margin:0 0 10px;text-align:${b.align || 'left'};">${e(b.text)}</div>`,
    h1: (b) => `<h1 class="h1" style="margin:0 0 14px;font-family:${SERIF};font-weight:400;font-size:${b.size || 46}px;line-height:${(b.size || 46) + 4}px;color:${NAVY};text-align:${b.align || 'left'};">${fmt(b.text)}</h1>`,
    h2: (b) => `<h2 style="margin:6px 0 10px;font-family:${SERIF};font-weight:400;font-size:28px;line-height:32px;color:${NAVY};text-align:${b.align || 'left'};">${fmt(b.text)}</h2>`,
    text: (b) => paras(b.text).map((t) => P(fmt(t), { align: b.align || 'left' })).join(''),
    small: (b) => paras(b.text).map((t) => P(fmt(t), { color: MUTED, size: 14, mb: 10, align: b.align || 'left' })).join(''),
    button: (b) => pill(b.label, b.url, b.color === 'navy' ? NAVY : PINK, '#ffffff', b.align || 'left'),
    details: (b) => { const it = (b.items || []).filter((x) => x[0] || x[1]); if (!it.length) return '';
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${b.color === 'pink' ? PINKL : SKYL};border-radius:12px;margin:0 0 22px;"><tr><td style="padding:20px 12px;">${cols(it, (x) => `style="padding:0 8px;"><div style="font-family:${CAPS};font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:${TEAL};font-weight:600;margin-bottom:6px;">${e(x[0])}</div><div style="font-family:${SANS};font-size:15px;line-height:22px;color:${NAVY};font-weight:600;">${fmt(x[1])}</div>`)}</td></tr></table>`; },
    stats: (b) => { const it = (b.items || []).filter((x) => x[0] || x[1]); if (!it.length) return '';
      return `<div style="margin:6px 0 20px;">${cols(it, (x) => `align="center" style="padding:0 6px;"><div style="font-family:${SERIF};font-size:48px;line-height:50px;color:${PINK};">${e(x[0])}</div><div style="font-family:${SANS};font-size:14px;line-height:20px;color:${NAVY};font-weight:600;">${e(x[1])}</div>`)}</div>`; },
    quote: (b) => `<div style="border-left:4px solid ${PINK};padding:4px 0 4px 18px;margin:8px 0 20px;font-family:${SERIF};font-style:italic;font-size:26px;line-height:32px;color:${NAVY};">${fmt(b.text)}</div>`,
    list: (b) => { const it = lines(b.text); if (!it.length) return '';
      const mark = (i) => b.style === 'number' ? `<td width="44" valign="top" style="padding:0 0 16px;"><div style="width:32px;height:32px;border-radius:50%;background:${LPINK};color:${PINK};font-family:${SANS};font-weight:700;font-size:15px;line-height:32px;text-align:center;">${i + 1}</div></td>`
        : b.style === 'dot' ? `<td width="10" valign="top" style="padding:10px 14px 10px 0;"><div style="width:8px;height:8px;border-radius:50%;background:${PINK};"></div></td>`
        : `<td width="28" valign="top" style="padding:2px 0 12px;font-family:${SANS};font-size:18px;color:${PINK};">&#10003;</td>`;
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 8px;">${it.map((t, i) => `<tr>${mark(i)}<td valign="top" style="padding:${b.style === 'number' ? '4px 0 16px' : '2px 0 12px'};font-family:${SANS};font-size:16px;line-height:24px;color:${INK};">${fmt(t)}</td></tr>`).join('')}</table>`; },
    needs: (b) => { const it = lines(b.text).map((l) => l.split('|').map((x) => x.trim())); if (!it.length) return '';
      const tone = (s) => /urgent/i.test(s) ? [LPINK, PINK] : /low/i.test(s) ? [SKYL, TEAL] : ['#EEF0F3', MUTED];
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px;">${it.map(([a, s]) => `<tr><td style="padding:12px 0;border-bottom:1px solid ${LINE};font-family:${SANS};font-size:16px;color:${NAVY};font-weight:600;">${e(a)}</td><td align="right" style="padding:12px 0;border-bottom:1px solid ${LINE};">${s ? `<span style="display:inline-block;background:${tone(s)[0]};color:${tone(s)[1]};font-family:${SANS};font-size:12px;font-weight:700;padding:4px 10px;border-radius:999px;white-space:nowrap;">${e(s)}</span>` : ''}</td></tr>`).join('')}</table>`; },
    bigdate: (b) => `<div style="font-family:${SERIF};font-size:104px;line-height:100px;color:${NAVY};margin:6px 0 2px;text-align:center;">${e(b.date)}</div><div style="font-family:${CAPS};font-size:16px;letter-spacing:.3em;color:${TEAL};margin-bottom:22px;text-align:center;text-transform:uppercase;">${e(b.sub)}</div>`,
    heart: () => `<div style="font-size:40px;line-height:40px;margin-bottom:8px;color:${PINK};text-align:center;">&#9829;</div>`,
    signature: (b) => `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 6px;"><tr><td valign="middle" style="padding-right:14px;"><img src="${SITE}/assets/c2c-circle.png" width="64" height="64" alt="" style="display:block;width:64px;height:64px;border-radius:50%;border:0;"></td>
<td valign="middle"><div style="font-family:${SERIF};font-style:italic;font-size:30px;line-height:32px;color:${NAVY};">${e(b.name)}</div><div style="font-family:${SANS};font-size:13px;color:${MUTED};letter-spacing:.04em;">${e(b.title)}</div></td></tr></table>`,
  };
  const SHADE = 'shade-newsletter';
  const isNL = (d) => !!d && d.template === SHADE;
  const secTone = (b) => b.style === 'navy' ? { bg: NAVY, ink: '#ffffff', head: '#ffffff', bold: '#ffffff', link: LPINK } : { bg: b.style === 'sky' ? SKYL : '#ffffff', ink: INK, head: NAVY, bold: NAVY, link: PINK };
  const ROW = {
    nl_head: (b) => `<tr><td class="px" style="background:#ffffff;padding:26px 30px 22px;border-bottom:1px solid ${LINE};"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td width="150" valign="middle"><a href="${SITE}"><img src="${SITE}/assets/shade-project-logo.png" width="150" alt="The Shade Project, Called to Care" style="display:block;width:150px;height:auto;border:0;color:${NAVY};font-family:Georgia,serif;font-size:18px;"></a></td>
<td valign="middle" style="padding-left:20px;"><div style="font-family:${CAPS};font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:${TEAL};font-weight:600;margin-bottom:4px;">${e([b.vol && `Vol. ${b.vol}`, b.issue && `Issue ${b.issue}`].filter(Boolean).join(', '))}${b.month ? ` &middot; ${e(b.month)}` : ''}</div>
<div class="h1" style="font-family:${SERIF};font-size:46px;line-height:48px;color:${NAVY};">${fmt(b.title || 'Caring *in Action*').replace(/<i>/g, `<i style="color:${PINK};">`)}</div>
<div style="font-family:${SANS};font-size:13px;color:${MUTED};margin-top:4px;">The Shade Project newsletter &middot; <a href="${SITE}" style="color:${TEAL};text-decoration:none;">wearecalledtocare.com</a></div></td></tr></table></td></tr>${b.pdf ? `
<tr><td align="center" style="background:${SKYL};padding:10px 24px;font-family:${SANS};font-size:14px;"><a href="${e(b.pdf)}" style="color:${TEAL};font-weight:700;text-decoration:none;">Open the one-page PDF to print or share &rarr;</a></td></tr>` : ''}`,
    nl_sec: (b) => { if (b.on === false) return ''; const t = secTone(b);
      const words = `${b.label ? `<h2 style="margin:0 0 10px;font-family:${SERIF};font-weight:400;font-size:30px;line-height:34px;color:${t.head};">${fmt(b.label, t.bold)}</h2>` : ''}${paras(b.text).map((x) => P(fmt(x, t.bold), { color: t.ink, mb: 14 })).join('')}${b.link_label ? `<a href="${e(link(b.link_url))}" style="font-family:${SANS};font-size:15px;font-weight:700;color:${t.link};text-decoration:none;">${e(b.link_label)} &rarr;</a>` : ''}`;
      const pic = b.src ? `<img src="${e(img(b.src))}" width="230" alt="${e(b.alt || '')}" style="display:block;width:100%;height:auto;border-radius:10px;border:0;">` : '';
      const tw = `<td class="col" valign="top">${words}</td>`, pw = (pad) => `<td class="col" width="42%" valign="top" style="padding-${pad}:20px;">${pic}</td>`;
      return `<tr><td class="px" style="background:${t.bg};padding:30px 44px 28px;">${pic ? `<table role="presentation" class="stack" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${b.side === 'left' ? pw('right') + tw : tw + pw('left')}</tr></table>` : words}</td></tr>`; },
    header: (b) => b.style === 'light' ? `<tr><td align="center" style="background:#ffffff;padding:28px 24px 20px;border-bottom:1px solid ${LINE};"><a href="${SITE}"><img src="${SITE}/assets/logo-navy.png" width="200" alt="We Are Called to Care" style="display:block;width:200px;height:auto;border:0;color:${NAVY};font-family:Georgia,serif;font-size:22px;"></a></td></tr>`
      : b.style === 'pink' ? `<tr><td align="center" style="background:${PINK};padding:24px 24px 22px;"><a href="${SITE}"><img src="${SITE}/assets/logo-white.png" width="200" alt="We Are Called to Care" style="display:block;width:200px;height:auto;border:0;color:#ffffff;font-family:Georgia,serif;font-size:22px;"></a></td></tr>`
      : `<tr><td align="center" style="background:${NAVY};padding:26px 24px 18px;"><a href="${SITE}"><img src="${SITE}/assets/logo-white.png" width="220" alt="We Are Called to Care" style="display:block;width:220px;height:auto;border:0;color:#ffffff;font-family:Georgia,serif;font-size:22px;"></a></td></tr>
<tr><td align="center" style="background:${NAVY};padding:0 24px 18px;font-family:${SANS};font-size:12px;letter-spacing:.08em;text-transform:uppercase;"><a href="${SITE}/#get-involved" style="color:${SKY};text-decoration:none;">Get Involved</a><span style="color:#5d7f99;">&nbsp;&nbsp;&middot;&nbsp;&nbsp;</span><a href="${SITE}/#events" style="color:${SKY};text-decoration:none;">Events</a><span style="color:#5d7f99;">&nbsp;&nbsp;&middot;&nbsp;&nbsp;</span><a href="${SITE}/#donate" style="color:${LPINK};text-decoration:none;font-weight:700;">Donate</a></td></tr>`,
    photo: (b) => b.src ? `<tr><td style="padding:0;"><img class="hero-img" src="${e(img(b.src))}" width="600" alt="${e(b.alt)}" style="display:block;width:100%;max-width:600px;height:auto;border:0;"></td></tr>` : '',
    hero: (b) => `<tr><td class="px" align="center" style="background:${PINK};padding:30px 44px 40px;">${b.eyebrow ? `<div style="font-family:${CAPS};font-size:13px;letter-spacing:.2em;color:${LPINK};margin-bottom:12px;text-transform:uppercase;">${e(b.eyebrow)}</div>` : ''}
<h1 class="h1" style="margin:0 0 14px;font-family:${SERIF};font-weight:400;font-size:48px;line-height:52px;color:#ffffff;">${fmt(b.title, '#ffffff')}</h1>${paras(b.text).map((t) => P(fmt(t, '#ffffff'), { color: '#ffffff', align: 'center' })).join('')}${b.label ? pill(b.label, b.url, '#ffffff', PINK, 'center') : ''}</td></tr>`,
    callout: (b) => `<tr><td class="px" style="background:${PINKL};padding:24px 44px;">${b.title ? `<div style="font-family:${SERIF};font-size:26px;line-height:30px;color:${NAVY};margin-bottom:8px;">${fmt(b.title)}</div>` : ''}${paras(b.text).map((t) => P(fmt(t), { mb: 10 })).join('')}${b.label ? `<a href="${e(link(b.url))}" style="font-family:${SANS};font-size:15px;font-weight:700;color:${PINK};text-decoration:none;">${e(b.label)} &rarr;</a>` : ''}</td></tr>`,
    story: (b) => `<tr><td class="px" style="padding:0 44px 26px;"><table role="presentation" class="stack" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${b.src ? `<td class="col" width="44%" valign="top" style="padding-right:18px;"><img src="${e(img(b.src))}" width="230" alt="" style="display:block;width:100%;height:auto;border-radius:10px;border:0;"></td>` : ''}
<td class="col" valign="top">${b.tag ? `<div style="font-family:${CAPS};font-size:11px;letter-spacing:.18em;color:${PINK};font-weight:600;margin-bottom:6px;text-transform:uppercase;">${e(b.tag)}</div>` : ''}<div style="font-family:${SERIF};font-size:24px;line-height:28px;color:${NAVY};margin-bottom:8px;">${fmt(b.title)}</div>
<div style="font-family:${SANS};font-size:15px;line-height:23px;color:${INK};margin-bottom:8px;">${fmt(b.text)}</div>${b.label ? `<a href="${e(link(b.url))}" style="font-family:${SANS};font-size:14px;font-weight:700;color:${TEAL};text-decoration:none;">${e(b.label)} &rarr;</a>` : ''}</td></tr></table></td></tr>`,
    dates: (b) => { const it = lines(b.text).map((l) => l.split('|').map((x) => x.trim())); if (!it.length) return '';
      return `<tr><td class="px" style="background:${SKYL};padding:28px 44px;"><h2 style="margin:0 0 10px;font-family:${SERIF};font-weight:400;font-size:28px;line-height:32px;color:${NAVY};">${e(b.title || 'Coming Up')}</h2><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${it.map(([d, t, w]) => { const [m, n] = String(d || '').split(/\s+/);
        return `<tr><td width="70" valign="top" style="padding:10px 0;border-top:1px solid ${LINE};"><div style="font-family:${CAPS};font-size:12px;letter-spacing:.12em;color:${PINK};text-transform:uppercase;">${e(m)}</div><div style="font-family:${SERIF};font-size:30px;line-height:30px;color:${NAVY};">${e(n || '')}</div></td><td valign="middle" style="padding:10px 0;border-top:1px solid ${LINE};font-family:${SANS};font-size:15px;line-height:22px;color:${INK};"><b style="color:${NAVY};">${e(t)}</b>${w ? `<br><span style="color:${MUTED};">${e(w)}</span>` : ''}</td></tr>`; }).join('')}</table></td></tr>`; },
    footer: (b) => `<tr><td class="px" align="center" style="background:${b.color === 'teal' ? TEAL : NAVY};padding:30px 40px 34px;">
<div style="font-family:${SERIF};font-style:italic;font-size:22px;line-height:28px;color:#ffffff;margin-bottom:6px;">&ldquo;Let us love in deed and in truth.&rdquo;</div>
<div style="font-family:${CAPS};font-size:11px;letter-spacing:.2em;color:${LPINK};margin-bottom:18px;">1 JOHN 3:18</div>
<div style="font-family:${SANS};font-size:13px;line-height:20px;margin-bottom:16px;"><a href="https://www.facebook.com/calledtocare.IL" style="color:${SKY};text-decoration:none;">Facebook</a><span style="color:#5d7f99;">&nbsp;&nbsp;&middot;&nbsp;&nbsp;</span><a href="https://www.instagram.com/weare.calledtocare/" style="color:${SKY};text-decoration:none;">Instagram</a><span style="color:#5d7f99;">&nbsp;&nbsp;&middot;&nbsp;&nbsp;</span><a href="${SITE}" style="color:${SKY};text-decoration:none;">wearecalledtocare.com</a></div>
<div style="font-family:${SANS};font-size:12px;line-height:19px;color:${b.color === 'teal' ? '#cfe0ea' : '#9fb6c7'};">Called to Care &middot; 15450 State Route 47 &middot; Newark, IL 60541<br>${e(b.reason || "You're receiving this because you're part of the Called to Care family.")}<br>
<a href="{{unsubscribe_url}}" style="color:${b.color === 'teal' ? '#cfe0ea' : '#9fb6c7'};text-decoration:underline;">Unsubscribe</a></div></td></tr>`,
  };
  function build(d) {
    const blocks = (d.blocks || []).filter((b) => b.type !== 'footer'); const foot = (d.blocks || []).find((b) => b.type === 'footer') || { type: 'footer' };
    let rows = '', run = [];
    const flush = () => { if (!run.length) return; const center = run.every((b) => b.align === 'center' || ['bigdate', 'heart'].includes(b.type));
      rows += `<tr><td class="px" align="${center ? 'center' : 'left'}" style="background:#ffffff;padding:36px 44px 26px;">${run.map((b) => INLINE[b.type](b)).join('')}</td></tr>`; run = []; };
    for (const b of blocks) { if (INLINE[b.type]) run.push(b); else if (ROW[b.type]) { flush(); rows += ROW[b.type](b); } }
    flush(); rows += ROW.footer(foot);
    return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${e(d.subject || 'We Are Called to Care')}</title>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Figtree:wght@400;500;600;700&family=Oswald:wght@500;600&display=swap" rel="stylesheet">
<style>body{margin:0;padding:0;background:${CREAM};}a{color:${TEAL};}
@media (max-width:620px){.wrap{width:100%!important}.px{padding-left:24px!important;padding-right:24px!important}.stack td.col{display:block!important;width:100%!important;padding:0 0 14px 0!important}.h1{font-size:38px!important;line-height:42px!important}}</style></head>
<body style="margin:0;padding:0;background:${CREAM};"><div style="display:none;max-height:0;overflow:hidden;opacity:0;">${e(d.preheader || '')}&#8199;&#65279;&#847; &#8199;&#65279;&#847; &#8199;&#65279;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${CREAM};"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" class="wrap" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;">
${rows}
</table></td></tr></table></body></html>`;
  }

  /* ---------- the templates ---------- */
  const B = (type, o = {}) => ({ type, ...o });
  const hi = 'Hi {{first_name}},';
  const monthName = (d) => d.toLocaleDateString('en-US', { month: 'long' });
  const upcoming = () => ((X && X.EVENTS) || []).filter((x) => D(x.starts_at) > new Date()).sort((a, b) => D(a.starts_at) - D(b.starts_at));
  const TEMPLATES = [
    { key: 'charity-dinner', name: 'Charity Dinner Invitation', cat: 'Events', subject: "You're invited: Charity Dinner & Auction", preheader: 'Join us March 13, 2027 at Whitetail Ridge Golf Club.', make: () => [
      B('header'), B('photo', { src: 'charity-dinner.jpg', alt: 'Guests at the Charity Dinner & Auction' }), B('eyebrow', { text: 'Charity Dinner & Auction · 6th Year' }), B('h1', { text: 'An Evening of\n*Hope & Healing*' }),
      B('text', { text: `${hi}\n\nYou're invited to our biggest night of the year. Dinner, a live and silent auction, and stories of the families you help us walk alongside, all to support foster and adoptive families across seven counties.` }),
      B('details', { items: [['When', 'Saturday\nMarch 13, 2027'], ['Where', 'Whitetail Ridge\nGolf Club, Yorkville'], ['Tickets', '$100 each\n$1,000 table of 10']] }), B('button', { label: 'Reserve Your Seat', url: '/#charity-dinner' }),
      B('callout', { title: 'Become a Sponsor', text: 'Sponsorships from $250 to $15,000 include program recognition, signage and seating.', label: 'See sponsorship levels', url: '/#charity-dinner' }), B('footer')] },
    { key: 'support-night', name: 'Support Night', cat: 'Events', subject: 'Support Night this month', preheader: 'An evening of encouragement for foster and adoptive parents.', make: () => { const sn = upcoming().find((x) => x.kind === 'support_night'); const d = sn && D(sn.starts_at);
      return [B('header', { style: 'light' }), B('eyebrow', { text: 'Support Night', color: 'teal' }), B('h1', { text: "You don't have to\ndo this alone." }),
        B('text', { text: `${hi}\n\nFoster and adoptive parenting is beautiful and hard, often on the same day. Support Night is a place to breathe, share, and be encouraged by parents who get it.` }),
        B('details', { color: 'pink', items: [['Date', d ? d.toLocaleDateString('en-US', { weekday: 'long' }) + '\n' + d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' }) : '[Day]\n[Date]'], ['Time', d ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '[Time]'], ['Where', (sn && sn.location) || '[Where]']] }),
        B('button', { label: 'RSVP for Support Night', url: '/#support-register', color: 'navy' }), B('small', { text: "Can't make it this month? Reply to this email and we'll check in with you." }),
        B('photo', { src: 'kids-living-room.jpg', alt: 'A family living room' }), B('footer', { color: 'teal', reason: "You're receiving this because you're a foster or adoptive parent in our community." })]; } },
    { key: 'christmas', name: 'Christmas Gifts Sign-Up', cat: 'Events', subject: 'Christmas gifts for your kids', preheader: 'Sign up your children for Christmas gifts.', make: () => [
      B('header', { style: 'pink' }), B('hero', { eyebrow: `✦ Christmas ${new Date().getFullYear()} ✦`, title: 'Let us help make\nChristmas merry.', text: 'Every child in your home deserves to open something chosen just for them. Tell us a little about each child and our community will shop for them.', label: 'Sign Up Your Kids', url: '/#christmas' }),
      B('h2', { text: 'How it works' }), B('list', { style: 'number', text: '**Sign up by [date].** Add each child: first name, age, sizes, and what they love.\n**We match each child with a shopper.** Volunteers and donors buy and wrap the gifts.\n**Pick up before Christmas.** We\'ll email you a pickup time.' }),
      B('small', { text: 'Questions? Just reply to this email.' }), B('footer', { reason: "You're receiving this because you're a foster, kinship, or adoptive family we serve." })] },
    { key: 'save-the-date', name: 'Save the Date (any event)', cat: 'Events', subject: 'Save the date', preheader: 'Mark your calendar.', make: () => [
      B('header', { style: 'pink' }), B('eyebrow', { text: 'Save the Date', align: 'center' }), B('bigdate', { date: '[00.00]', sub: '[Day · Year]' }), B('h1', { text: '[Event Name]', size: 40, align: 'center' }),
      B('text', { text: '[One or two sentences about the event.] Invitation and details to follow!', align: 'center' }), B('button', { label: 'See Our Events', url: '/#events', color: 'navy', align: 'center' }),
      B('photo', { src: 'kids-outdoors.jpg', alt: 'Kids playing outdoors' }), B('footer')] },
    { key: 'newsletter', name: 'Monthly Newsletter', cat: 'Newsletter', subject: `The Called to Care Monthly: ${monthName(new Date())}`, preheader: "News, stories, and what's coming up this month.", make: () => { const now = new Date();
      const ev = upcoming().slice(0, 3).map((x) => { const d = D(x.starts_at); return `${d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase()} ${d.getDate()} | ${x.title} | ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}${x.location ? ' · ' + x.location : ''}`; });
      return [B('header'), B('eyebrow', { text: `The Monthly · ${monthName(now)} ${now.getFullYear()}` }), B('h1', { text: `Hello, ${monthName(now)}!`, size: 44 }), B('text', { text: "Here's what's happening in our community this month, and how you can be part of it." }),
        B('story', { src: 'kids-laughing.jpg', tag: 'Family Story', title: '[Story headline]', text: '[Two sentences that tell the story.]', label: 'Read their story', url: '/' }),
        B('story', { src: 'care-closet.jpg', tag: 'Care Closet', title: '[What the Care Closet needs]', text: '[What is needed and how to drop it off.]', label: 'See the wish list', url: '/amazon' }),
        B('story', { src: 'kids-outdoors.jpg', tag: 'Camp', title: '[Camp or program news]', text: '[One or two sentences.]', label: 'Learn more', url: '/#camp' }),
        B('dates', { title: 'Coming Up', text: ev.length ? ev.join('\n') : '[MON 00] | [Event name] | [Time · Place]' }), B('footer')]; } },
    { key: 'monthly-partner-update', name: 'Monthly Partner Update', cat: 'Donors', subject: 'Your monthly impact', preheader: "Here's what your monthly gift did this month.", make: () => [
      B('header'), B('eyebrow', { text: `Monthly Partner Update · ${monthName(new Date())}` }), B('h1', { text: "Here's what your\ngift did this month." }),
      B('text', { text: `${hi}\n\nBecause you give every month, families get help the day they need it, not weeks later. Here's a look at this month.` }),
      B('stats', { items: [['[00]', 'care packages for new placements'], ['[00]', 'parents at Support Night'], ['[00]', 'kids sent to camp']] }), B('photo', { src: 'care-closet.jpg', alt: 'The Care Closet' }),
      B('h2', { text: 'A note from the Care Closet' }), B('text', { text: '[A short story from this month: who needed help, and what your monthly partners made possible.]' }),
      B('footer', { reason: "You're receiving this because you're a Monthly Partner." })] },
    { key: 'welcome-monthly-partner', name: 'Welcome, Monthly Partner', cat: 'Donors', subject: 'Welcome to the Monthly Partner family', preheader: 'Thank you for giving every month.', make: () => [
      B('header'), B('photo', { src: 'kids-sunny-group.jpg', alt: 'Kids playing outside on a sunny day' }), B('eyebrow', { text: 'Welcome, Monthly Partner' }), B('h1', { text: "You just became\nsomeone's *steady*." }),
      B('text', { text: `${hi}\n\nThank you for choosing to give every month. Foster families rarely get notice; a placement can happen in a few hours. Monthly gifts are what let us say yes right away.` }),
      B('h2', { text: 'What to expect' }), B('list', { style: 'check', text: 'A receipt by email for every gift.\nA thank-you letter from Shari.\nNews about what your giving makes possible.\nChange or pause your gift anytime: just reply to this email.' }),
      B('footer', { reason: "You're receiving this because you started a monthly gift." })] },
    { key: 'thank-you', name: 'Thank You', cat: 'Donors', subject: 'Thank you', preheader: "We're so grateful you're in this with us.", make: () => [
      B('header', { style: 'light' }), B('heart'), B('h1', { text: 'Thank you, {{first_name}}.', size: 50, align: 'center' }),
      B('text', { align: 'center', text: "Your generosity goes straight to work for foster and adoptive families: care packages for new placements, counseling, camp, and a community that shows up.\n\nWe're so grateful you're in this with us." }),
      B('callout', { text: 'Want to make an even bigger difference?', label: 'Become a Monthly Partner', url: '/#donate' }), B('footer')] },
    { key: 'wish-list', name: 'Care Closet Wish List', cat: 'Asks', subject: "This month's Care Closet wish list", preheader: "Here's what families need most right now.", make: () => [
      B('header', { style: 'light' }), B('eyebrow', { text: 'Care Closet · Urgent Needs' }), B('h1', { text: "Here's what families\nneed most right now.", size: 42 }),
      B('text', { text: 'Hi {{first_name}}, when a child is placed, the Care Closet is often the first stop. These shelves are running low:' }),
      B('needs', { text: '[Item] | Urgent\n[Item] | Urgent\n[Item] | Low\n[Item] | Always needed' }), B('button', { label: 'Shop Our Amazon Wish List', url: '/amazon' }),
      B('small', { text: 'Prefer to drop off? [Where and when to bring donations.]' }), B('photo', { src: 'care-closet.jpg', alt: 'The Care Closet shelves' }), B('footer')] },
    { key: 'executive-director', name: 'From the Executive Director', cat: 'Letters', subject: 'A note from Shari', preheader: 'A personal note from our Executive Director.', make: () => [
      B('header', { style: 'light' }), B('eyebrow', { text: 'From the Executive Director', color: 'teal' }), B('h1', { text: 'Dear {{first_name}},', size: 44 }),
      B('text', { text: '[Your opening: what is on your heart right now.]\n\n[What happened this season, and why it matters.]' }), B('quote', { text: 'Every family that says yes to a child deserves a community that says yes to them.' }),
      B('text', { text: "Thank you for being that community. I can't wait to see what we do together.\n\nWith love and gratitude," }), B('signature', { name: 'Shari Chapman', title: 'Founder & Executive Director' }),
      B('callout', { text: '', label: 'Give in honor of a foster family', url: '/#donate' }), B('footer')] },
    { key: 'board-president', name: 'From the Board President', cat: 'Letters', subject: 'A letter from our Board President', preheader: 'An update from the Board of Directors.', make: () => [
      B('header'), B('eyebrow', { text: 'From the Board of Directors' }), B('h1', { text: 'Looking ahead\nwith gratitude.', size: 44 }),
      B('text', { text: 'Dear Friends,\n\nOn behalf of the Board of Directors, thank you. Because of your generosity, Called to Care grew this year while staying true to what makes it special: neighbors showing up for neighbors.' }),
      B('h2', { text: "Where we're headed" }), B('list', { style: 'dot', text: '**[First priority]** [and why it matters.]\n**[Second priority]** [and why it matters.]\n**[Third priority]** [and why it matters.]' }),
      B('text', { text: 'Our Board is committed to careful stewardship of every gift, and our door is always open.\n\nGratefully,' }), B('signature', { name: '[Board President Name]', title: 'President, Board of Directors' }), B('footer')] },
    { key: 'blank', name: 'Simple Note', cat: 'Anything else', subject: '', preheader: '', make: () => [B('header'), B('h1', { text: '[Your headline]', size: 42 }), B('text', { text: `${hi}\n\n[Write your message here.]` }), B('button', { label: 'Learn More', url: '/' }), B('footer')] },
  ];

  /* ---------- the Shade Project newsletter ---------- */
  const SEC = (o) => ({ type: 'nl_sec', on: true, style: 'plain', side: 'right', label: '', text: '', src: '', alt: '', link_label: '', link_url: '', ...o });
  function newsletterBlocks(prev) { const now = new Date(); const ev = upcoming()[0]; const d = ev && D(ev.starts_at);
    const head = { type: 'nl_head', title: 'Caring *in Action*', vol: prev ? prev.vol : '1', issue: prev && /^\d+$/.test(prev.issue || '') ? String(+prev.issue + 1) : '[#]', month: `${monthName(now)} ${now.getFullYear()}`, pdf: '', pdfKey: '' };
    return [head,
      SEC({ label: 'A Message from Shari', text: '[What Shari wants monthly partners to know this month.]', side: 'right' }),
      SEC({ label: '[Story headline]', text: '[A short story from this month.]', side: 'left' }),
      SEC({ on: false, label: '[Second story headline]', text: '[Another short story.]', side: 'right' }),
      SEC({ style: 'sky', label: 'Save the Date', text: ev ? `**${ev.title}** is ${d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}${ev.location ? ' at ' + ev.location : ''}. [Add a sentence about it.]` : '[What is coming up, and when.]', link_label: 'See the details', link_url: '/#events' }),
      SEC({ style: 'navy', label: 'Care Closet Needs', text: '[What the Care Closet needs this month, and where to drop it off.]' }),
      B('footer', { reason: "You're receiving this because you're a monthly partner of We Are Called to Care." })]; }
  async function startNewsletter(copy) { let prev = null, blocks = null;
    const last = (LIST || []).find((c) => c.template === SHADE);
    if (last) { const r = await X.SB.from('email_campaigns').select('blocks').eq('id', last.id).single(); if (!r.error && r.data) { prev = (r.data.blocks || []).find((b) => b.type === 'nl_head') || null;
      if (copy) { blocks = JSON.parse(JSON.stringify(r.data.blocks)); const h = blocks.find((b) => b.type === 'nl_head'); if (h) Object.assign(h, newsletterBlocks(prev)[0]); } } }
    blocks = blocks || newsletterBlocks(prev); const h = blocks[0]; const tag = tagCounts().some(([t]) => t === 'Monthly Partner');
    ED = { id: null, status: 'draft', template: SHADE, name: `Shade Project newsletter, ${h.month}`, subject: `Caring in Action: ${h.month}`, preheader: 'The Shade Project newsletter for our monthly partners.', reply_to: '', blocks,
      audience: tag ? { mode: 'tags', tags: ['Monthly Partner'], skip: [] } : { mode: 'all', tags: [], skip: [] }, total: 0, sent: 0, failed: 0 };
    STEP = 'write'; DIRTY = true; SENDING = null; show(); window.scrollTo(0, 0); }

  // Photos: shrink in the browser (emails load faster), then keep in the "newsletter" storage folder.
  function shrink(file, max = 1400) { return new Promise((res, rej) => { const im = new Image(); const u = URL.createObjectURL(file);
    im.onload = () => { const k = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight)); const c = document.createElement('canvas'); c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k);
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(im, 0, 0, c.width, c.height); URL.revokeObjectURL(u); c.toBlob((b) => b ? res(b) : rej(new Error('This photo could not be read.')), 'image/jpeg', 0.86); };
    im.onerror = () => { URL.revokeObjectURL(u); rej(new Error('This file is not a photo we can use. Try a JPG or PNG.')); }; im.src = u; }); }
  async function put(path, blob, type) { const st = X.SB.storage.from('newsletter'); const r = await st.upload(path, blob, { contentType: type, cacheControl: '31536000', upsert: true });
    if (r.error) throw new Error(/bucket|not found/i.test(r.error.message) ? 'Photo storage is not set up yet. Run newsletter.sql in Supabase first.' : r.error.message);
    return st.getPublicUrl(path).data.publicUrl; }
  async function uploadPhoto(input) { const i = +input.dataset.emUp; const file = input.files && input.files[0]; if (!file || !ED) return;
    const lab = input.closest('label'); const say = (t) => { const sp = lab && lab.querySelector('span'); if (sp) sp.textContent = t; }; say('Uploading…');
    try { const blob = await shrink(file); const url = await put(`photos/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`, blob, 'image/jpeg'); if (ED.blocks[i]) { ED.blocks[i].src = url; touch(); show(); } }
    catch (x) { say('Upload a photo'); toast(x.message || 'The photo could not be uploaded.', true); } }

  // The one-page PDF: the same content laid out on a letter page, in the website's look.
  const sitePic = (src) => /^https?:/i.test(src || '') ? src : `/assets/${src}`;
  function pageHTML(d) { const h = d.blocks.find((b) => b.type === 'nl_head') || {}; const secs = d.blocks.filter((b) => b.type === 'nl_sec' && b.on !== false);
    const clean = (t) => fmt(String(t || '').replaceAll('{{first_name}}', 'Friend'));
    return `<div class="nlp"><style>
.nlp{width:816px;min-height:1056px;background:#fff;color:${INK};font-family:Figtree,Arial,sans-serif;display:flex;flex-direction:column;font-size:16px;box-sizing:border-box}
.nlp *{box-sizing:border-box}.nlp .hd{display:flex;align-items:center;gap:1.5em;padding:1.7em 2.8em 1.4em;border-bottom:.19em solid ${NAVY}}
.nlp .hd img{width:9.4em;height:auto;display:block}.nlp .vol{font-family:'DM Mono',monospace;font-size:.72em;letter-spacing:.18em;text-transform:uppercase;color:${TEAL}}
.nlp .ttl{font-family:'Instrument Serif',Georgia,serif;font-size:4em;line-height:1;color:${NAVY};margin:.06em 0 .1em}.nlp .ttl i{color:${PINK}}
.nlp .url{font-size:.8em;color:${MUTED}}.nlp .sec{padding:1.25em 2.8em 1.15em;overflow:hidden}
.nlp .sec.sky{background:${SKYL}}.nlp .sec.navy{background:${NAVY};color:#fff}.nlp .sec.navy h2,.nlp .sec.navy b{color:#fff!important}
.nlp h2{font-family:'Instrument Serif',Georgia,serif;font-weight:400;font-size:1.85em;line-height:1.1;color:${NAVY};margin:0 0 .3em}
.nlp p{font-size:.9em;line-height:1.5;margin:0 0 .6em}.nlp .pic{width:17.5em;height:auto;border-radius:.6em;display:block}.nlp .pic.right{float:right;margin:0 0 .5em 1.5em}.nlp .pic.left{float:left;margin:0 1.5em .5em 0}
.nlp a{color:${PINK};font-weight:700;text-decoration:none;font-size:.88em}.nlp .sec.navy a{color:${LPINK}}.nlp p a{font-size:1em}
.nlp .ft{margin-top:auto;background:${NAVY};color:#9fb6c7;text-align:center;padding:1.1em 2.8em 1.2em;font-size:.72em;line-height:1.6}
.nlp .ft em{display:block;font-family:'Instrument Serif',Georgia,serif;font-size:1.75em;color:#fff;line-height:1.2}.nlp .ft span{color:${LPINK};letter-spacing:.16em}
</style><div class="hd"><img crossorigin="anonymous" src="/assets/shade-project-logo.png" alt=""><div><div class="vol">${e([h.vol && `Vol. ${h.vol}`, h.issue && `Issue ${h.issue}`].filter(Boolean).join(', '))}${h.month ? ` · ${e(h.month)}` : ''}</div><div class="ttl">${fmt(h.title || 'Caring *in Action*')}</div><div class="url">The Shade Project newsletter · wearecalledtocare.com</div></div></div>
${secs.map((b) => `<div class="sec ${b.style === 'sky' ? 'sky' : b.style === 'navy' ? 'navy' : ''}">${b.src ? `<img crossorigin="anonymous" class="pic ${b.side === 'left' ? 'left' : 'right'}" src="${e(sitePic(b.src))}" alt="">` : ''}${b.label ? `<h2>${clean(b.label)}</h2>` : ''}${paras(b.text).map((x) => `<p>${clean(x)}</p>`).join('')}${b.link_label ? `<a href="${e(link(b.link_url))}">${e(b.link_label)} →</a>` : ''}</div>`).join('')}
<div class="ft"><em>“Let us love in deed and in truth.”</em><span>1 JOHN 3:18</span><br>Called to Care · 15450 State Route 47 · Newark, IL 60541 · wearecalledtocare.com</div></div>`; }
  const lib = (url, ok) => ok() ? Promise.resolve() : new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = url; sc.onload = res; sc.onerror = () => rej(new Error('The PDF maker could not load. Check your connection and try again.')); document.head.appendChild(sc); });
  async function makePdf(d) {
    await lib('/admin/vendor/html2canvas.min.js', () => !!window.html2canvas);
    await lib('/admin/vendor/jspdf.umd.min.js', () => !!(window.jspdf && window.jspdf.jsPDF));
    const host = document.createElement('div'); host.style.cssText = 'position:fixed;left:-10000px;top:0;width:816px;'; host.innerHTML = pageHTML(d); document.body.appendChild(host); const el = host.firstElementChild;
    try {
      if (document.fonts) { await Promise.all([document.fonts.load("40px 'Instrument Serif'"), document.fonts.load("italic 40px 'Instrument Serif'"), document.fonts.load('700 14px Figtree'), document.fonts.load("12px 'DM Mono'")]).catch(() => {}); await document.fonts.ready; }
      await Promise.all([...el.querySelectorAll('img')].map((im) => im.complete && im.naturalWidth ? null : new Promise((res) => { im.onload = res; im.onerror = () => { im.remove(); res(); }; })));
      // Everything is sized in "em", so shrinking the base size shrinks the whole page until it fits on one sheet.
      let size = 16; while (el.scrollHeight > 1056 && size > 10.4) { size -= 0.4; el.style.fontSize = size + 'px'; }
      const fits = el.scrollHeight <= 1056; el.style.height = '1056px'; el.style.overflow = 'hidden';
      const box = el.getBoundingClientRect(); const links = [...el.querySelectorAll('a[href]')].map((a) => { const q = a.getBoundingClientRect(); return [q.left - box.left, q.top - box.top, q.width, q.height, a.href]; });
      const canvas = await window.html2canvas(el, { scale: 2, useCORS: true, backgroundColor: '#ffffff', width: 816, height: 1056, windowWidth: 816, logging: false });
      const pdf = new window.jspdf.jsPDF({ unit: 'pt', format: 'letter', compress: true }); pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 612, 792);
      links.forEach(([x, y, w, hh, url]) => { if (y + hh <= 1056) pdf.link(x * 0.75, y * 0.75, w * 0.75, hh * 0.75, { url }); });
      return { blob: pdf.output('blob'), fits };
    } finally { host.remove(); } }
  const pdfKey = (d) => { const j = JSON.stringify(d.blocks.map((b) => b.type === 'nl_head' ? { ...b, pdf: '', pdfKey: '' } : b)); let x = 5381; for (let i = 0; i < j.length; i++) x = ((x << 5) + x + j.charCodeAt(i)) >>> 0; return x.toString(36); };
  // Make sure the PDF the email links to matches what is in the email right now.
  async function ensurePdf() { const d = ED; if (!isNL(d) || d.status !== 'draft') return true; const h = d.blocks.find((b) => b.type === 'nl_head'); const key = pdfKey(d);
    if (h.pdf && h.pdfKey === key) return true;
    if (!d.id && !(await save())) return false;
    try { const { blob } = await makePdf(d); const url = await put(`issues/${d.id}.pdf`, blob, 'application/pdf'); h.pdf = `${url}?v=${key}`; h.pdfKey = key; DIRTY = true; return await save(); }
    catch (x) { toast(x.message || 'The PDF could not be made.', true); return false; } }
  async function previewPdf(btn) { const old = btn.textContent; btn.disabled = true; btn.textContent = 'Making the PDF…';
    try { const { blob, fits } = await makePdf(ED); const u = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = u; a.target = '_blank'; a.rel = 'noopener'; a.download = `${(ED.name || 'Shade Project newsletter').replace(/[^\w ,.-]+/g, '')}.pdf`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 60000);
      toast(fits ? 'PDF downloaded.' : 'PDF downloaded, but there is too much for one page: the bottom is cut off. Shorten a section or turn one off.', !fits); }
    catch (x) { toast(x.message || 'The PDF could not be made.', true); }
    btn.disabled = false; btn.textContent = old; }

  /* ---------- the editor's fields for each kind of block ---------- */
  const KIND = {
    header: ['Logo bar', [['style', 'pick', { navy: 'Navy with menu', light: 'White', pink: 'Pink' }]]],
    photo: ['Photo', [['src', 'photo'], ['alt', 'line', 'Describe the photo (for people who can\'t see it)']]],
    hero: ['Pink banner', [['eyebrow', 'line', 'Small line on top'], ['title', 'area2', 'Headline'], ['text', 'area2', 'Sentence'], ['label', 'line', 'Button words'], ['url', 'url', 'Button link']]],
    eyebrow: ['Small label', [['text', 'line', 'Label']]],
    h1: ['Headline', [['text', 'area2', 'Headline']]],
    h2: ['Section heading', [['text', 'line', 'Heading']]],
    text: ['Paragraphs', [['text', 'area', 'Text']]],
    small: ['Small grey note', [['text', 'area2', 'Note']]],
    details: ['Details box', [['items', 'pairs', ['Label', 'Detail']], ['color', 'pick', { sky: 'Blue', pink: 'Pink' }]]],
    stats: ['Big numbers', [['items', 'pairs', ['Number', 'What it counts']]]],
    button: ['Button', [['label', 'line', 'Button words'], ['url', 'url', 'Link'], ['color', 'pick', { pink: 'Pink', navy: 'Navy' }]]],
    quote: ['Quote', [['text', 'area2', 'Quote']]],
    list: ['List', [['text', 'area', 'One item per line'], ['style', 'pick', { check: 'Check marks', dot: 'Dots', number: 'Numbers' }]]],
    needs: ['Wish list', [['text', 'area', 'One item per line. Add  | Urgent  or  | Low  after an item to tag it']]],
    bigdate: ['Big date', [['date', 'line', 'Date, like 06.19'], ['sub', 'line', 'Day and year']]],
    heart: ['Heart', []],
    signature: ['Signature', [['name', 'line', 'Name'], ['title', 'line', 'Title']]],
    callout: ['Pink strip with a link', [['title', 'line', 'Heading (optional)'], ['text', 'area2', 'Sentence (optional)'], ['label', 'line', 'Link words'], ['url', 'url', 'Link']]],
    story: ['Story with photo', [['src', 'photo'], ['tag', 'line', 'Small label'], ['title', 'line', 'Headline'], ['text', 'area2', 'Story'], ['label', 'line', 'Link words'], ['url', 'url', 'Link']]],
    dates: ['Coming up (dates)', [['title', 'line', 'Heading'], ['text', 'area', 'One event per line:  DEC 10 | Support Night | 6:30 PM · Plano']]],
    footer: ['Footer', [['reason', 'line', 'Why they are getting this email'], ['color', 'pick', { navy: 'Navy', teal: 'Teal' }]]],
  };
  const ADDABLE = ['text', 'h2', 'button', 'photo', 'details', 'list', 'quote', 'story', 'dates', 'stats', 'needs', 'callout', 'signature', 'small', 'eyebrow', 'h1'];
  const FRESH = { text: { text: '' }, h2: { text: '' }, h1: { text: '' }, eyebrow: { text: '' }, small: { text: '' }, button: { label: 'Learn More', url: '/' }, photo: { src: 'kids-outdoors.jpg', alt: '' }, details: { items: [['', ''], ['', ''], ['', '']] },
    stats: { items: [['', ''], ['', ''], ['', '']] }, list: { style: 'check', text: '' }, quote: { text: '' }, story: { src: 'kids-laughing.jpg', tag: '', title: '', text: '', label: 'Read more', url: '/' }, dates: { title: 'Coming Up', text: '' },
    needs: { text: '' }, callout: { title: '', text: '', label: 'Learn more', url: '/' }, signature: { name: '', title: '' } };

  /* ---------- state ---------- */
  let LIST = null, LISTERR = '', ED = null, STEP = 'write', WIDE = true, SAVING = null, DIRTY = false, SENDING = null, TAGQ = '';
  const canEdit = () => X.PERMS.emaillist === 'edit';
  const people = () => [...X.CONTACTS.values()].filter((c) => c.email && c.okEmail);
  const reach = (a) => people().filter((c) => (a.mode !== 'tags' || c.tags.some((t) => (a.tags || []).includes(t))) && !c.tags.some((t) => (a.skip || []).includes(t)));
  const tagCounts = () => { const m = new Map(); people().forEach((c) => c.tags.forEach((t) => m.set(t, (m.get(t) || 0) + 1))); return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])); };
  const audText = (a) => (a.mode === 'tags' ? ((a.tags || []).length ? (a.tags.length <= 3 ? a.tags.join(', ') : `${a.tags.length} tags`) : 'No tags chosen') : 'Everyone on the list') + ((a.skip || []).length ? `, leaving out ${a.skip.length <= 2 ? a.skip.join(' and ') : a.skip.length + ' tags'}` : '');
  const blanks = (d) => { const s = JSON.stringify([d.subject, d.preheader, d.blocks]); return [...new Set(s.match(/\[[^\]\[\\"]{1,60}\](?!\()/g) || [])].slice(0, 6); };
  async function fn(body) { const { data: { session } } = await X.SB.auth.getSession();
    try { const r = await fetch('/.netlify/functions/email-send', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + (session && session.access_token) }, body: JSON.stringify(body) }); return await r.json(); }
    catch (x) { return { ok: false, error: 'Could not reach the website. Check your connection and try again.' }; } }
  async function load() { const r = await X.SB.from('email_campaigns').select('id,name,template,subject,audience,status,total,sent,failed,created_by,updated_at,started_at,finished_at').order('updated_at', { ascending: false }).limit(200);
    if (r.error) { LIST = []; LISTERR = /does not exist|schema cache|relation/i.test(r.error.message) ? 'setup' : r.error.message; } else { LIST = r.data; LISTERR = ''; }
    if (['email', 'newsletter'].includes(X.VIEW) && !ED) render(); }

  /* ---------- screens ---------- */
  const CSS = `<style id="em-css">
.em-tpl{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:16px}
.em-tpl button{all:unset;cursor:pointer;display:grid;gap:10px;border:1px solid var(--line);border-radius:14px;background:var(--surface);padding:12px;box-sizing:border-box}
.em-tpl button:hover,.em-tpl button:focus-visible{border-color:var(--teal);box-shadow:0 0 0 3px var(--sky-pale)}
.em-thumb{height:230px;overflow:hidden;border-radius:8px;background:#FBF8F4;position:relative}
.em-thumb iframe{width:640px;height:800px;border:0;transform:scale(.29);transform-origin:0 0;pointer-events:none}
.em-tpl b{font-family:var(--serif);font-weight:400;font-size:1.25rem;line-height:1.1}.em-tpl span{font-size:.78rem;color:var(--muted)}
.em-rows{display:grid}.em-row{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:14px;align-items:center;padding:14px 18px;border-top:1px solid var(--line);cursor:pointer;background:none;border-left:0;border-right:0;border-bottom:0;text-align:left;font:inherit;color:inherit;width:100%}
.em-row:first-child{border-top:0}.em-row:hover{background:var(--sky-pale)}.em-row b{display:block}.em-row .sub{font-size:.84rem;color:var(--muted)}
.em-top{display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between}
.em-steps{display:flex;gap:6px;flex-wrap:wrap}.em-steps button{border:1px solid var(--line);background:var(--surface);border-radius:999px;padding:9px 18px;font:inherit;font-weight:700;font-size:.9rem;cursor:pointer;color:var(--muted)}
.em-steps button[aria-current=true]{background:var(--navy);border-color:var(--navy);color:#fff}
.em-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:20px;align-items:start}
@media (max-width:1100px){.em-grid{grid-template-columns:1fr}}
.em-form{display:grid;gap:12px}
.em-blk{border:1px solid var(--line);border-radius:12px;background:var(--surface);padding:12px 14px;display:grid;gap:10px}
.em-blk>header{display:flex;justify-content:space-between;align-items:center;gap:8px}.em-blk>header b{font-size:.78rem;letter-spacing:.08em;text-transform:uppercase;color:var(--teal)}
.em-blk .tools{display:flex;gap:4px}.em-blk .tools button{border:1px solid var(--line);background:var(--surface);border-radius:8px;width:32px;height:32px;cursor:pointer;font-size:1rem;line-height:1;color:var(--muted)}
.em-blk .tools button:hover{border-color:var(--teal);color:var(--navy)}.em-blk .tools button[disabled]{opacity:.3;cursor:default}
.em-blk textarea{resize:vertical;min-height:120px;line-height:1.5}.em-blk textarea.two{min-height:64px}
.em-pairs{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.6fr);gap:8px}
.em-pairs input,.em-pairs textarea{border:1.5px solid var(--line);border-radius:10px;background:var(--surface);padding:9px 11px;font:inherit;width:100%;box-sizing:border-box;resize:vertical}
.em-three{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}@media (max-width:560px){.em-three{grid-template-columns:1fr}.em-three label{grid-column:auto!important}}
.em-sec.off{background:transparent;border-style:dashed}.em-sec.off>header b{color:var(--muted)}.em-sec>header .tick b{font-size:.95rem;letter-spacing:0;text-transform:none;color:var(--navy)}
.em-picrow{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.em-picrow img{width:96px;height:auto;border-radius:8px}.em-up{cursor:pointer}
.em-photos{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}.em-photos button{all:unset;cursor:pointer;border-radius:8px;overflow:hidden;border:3px solid transparent;aspect-ratio:3/2;box-sizing:border-box}
.em-photos button[aria-pressed=true]{border-color:var(--pink)}.em-photos img{width:100%;height:100%;object-fit:cover;display:block}
.em-add{display:flex;flex-wrap:wrap;gap:6px}.em-add button{border:1px dashed var(--teal);background:none;border-radius:999px;padding:6px 12px;font:inherit;font-size:.82rem;font-weight:600;color:var(--teal);cursor:pointer}
.em-pv{position:sticky;top:16px;border:1px solid var(--line);border-radius:14px;background:#FBF8F4;overflow:hidden}
.em-pv header{display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:var(--surface);border-bottom:1px solid var(--line);font-size:.84rem;color:var(--muted)}
.em-pv iframe{display:block;border:0;width:100%;height:min(78vh,900px);margin:0 auto;background:#FBF8F4}.em-pv.phone iframe{width:390px;max-width:100%}
.em-tags{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:4px 16px;max-height:340px;overflow:auto;padding:4px}
.em-tags label{display:flex;gap:8px;align-items:center;font-size:.9rem;padding:5px 4px;cursor:pointer}.em-tags input{width:17px;height:17px;accent-color:var(--teal);flex:none}.em-tags span{color:var(--muted);margin-left:auto;font-variant-numeric:tabular-nums}
.em-reach{font-family:var(--serif);font-size:2.6rem;line-height:1;color:var(--navy)}
.em-warn{background:var(--pink-pale);border-radius:12px;padding:12px 16px;color:var(--ink);font-size:.92rem}
.em-ok{background:var(--sky-pale);border-radius:12px;padding:12px 16px;font-size:.92rem}
.em-prog{height:14px;border-radius:999px;background:var(--sky-pale);overflow:hidden}.em-prog i{display:block;height:100%;background:var(--teal);border-radius:999px;transition:width .4s}
.em-pad{padding:18px;display:grid;gap:16px}
</style>`;
  const pillFor = (c) => c.status === 'sent' ? `<span class="pill" style="background:var(--sky-pale);color:var(--teal)">Sent</span>` : c.status === 'sending' ? `<span class="pill" style="background:var(--pink-pale);color:var(--pink)">Not finished</span>` : c.status === 'canceled' ? `<span class="pill" style="background:var(--line);color:var(--muted)">Stopped</span>` : `<span class="pill" style="background:var(--line);color:var(--muted)">Draft</span>`;

  function page(mode) { const nl = mode === 'nl';
    if (ED && isNL(ED) !== nl) { if (DIRTY) save(); ED = null; SENDING = null; }
    if (ED) return CSS + editor();
    if (LIST === null) { load(); return `<div class="panel"><div class="empty">Loading your emails…</div></div>`; }
    if (LISTERR === 'setup') return `<div class="panel"><div class="em-pad"><h2 style="font-family:var(--serif);font-weight:400;font-size:1.8rem;margin:0">One step before you can send email</h2><p style="margin:0">Run <b>email-system.sql</b> in Supabase (SQL Editor → New query → paste → Run), then reload this page.</p></div></div>`;
    const mine = LIST.filter((c) => (c.template === SHADE) === nl); const n = nl ? reach({ mode: 'tags', tags: ['Monthly Partner'] }).length : people().length; const drafts = mine.filter((c) => c.status === 'draft' || c.status === 'sending'), done = mine.filter((c) => c.status === 'sent' || c.status === 'canceled');
    const row = (c) => `<button class="em-row" data-em-open="${c.id}"><span><b>${esc(c.name || c.subject || 'Untitled email')}</b><span class="sub">${esc(c.subject || 'No subject yet')} · ${esc(audText(c.audience || {}))}</span></span>
      <span class="sub">${c.status === 'draft' ? 'Edited ' + fmtD(D(c.updated_at)) : c.status === 'sending' ? `${c.sent} of ${c.total} sent` : `${c.sent.toLocaleString()} sent${c.failed ? ` · ${c.failed} failed` : ''} · ${fmtD(D(c.finished_at || c.updated_at))}`}</span>${pillFor(c)}</button>`;
    if (nl) return CSS + `<div class="summary"><div><b>${n.toLocaleString()}</b><span>Monthly partners you can email</span></div><div><b>${done.filter((c) => c.status === 'sent').length}</b><span>Issues sent</span></div></div>
    ${canEdit() ? `<div class="panel"><div class="em-pad"><div><h2 style="font-family:var(--serif);font-weight:400;font-size:2rem;margin:0 0 6px">Caring <i style="color:var(--pink)">in Action</i></h2><p class="note" style="margin:0">The Shade Project newsletter for monthly partners. Switch sections on or off, type your words, add photos, and send. The one-page PDF is made for you.</p></div>
      <div class="toolbar"><button class="btn pink" style="padding:12px 22px" data-em-nl="new">Start This Month's Newsletter</button>${mine.length ? `<button class="btn" data-em-nl="copy">Start From Last Month's</button>` : ''}</div></div></div>` : ''}
    ${drafts.length ? `<div class="panel"><header><h2>In progress</h2></header><div class="em-rows">${drafts.map(row).join('')}</div></div>` : ''}
    <div class="panel"><header><h2>Past issues</h2></header><div class="em-rows">${done.length ? done.map(row).join('') : '<div class="empty">No issues sent yet.</div>'}</div></div>`;
    return CSS + `<div class="summary"><div><b>${n.toLocaleString()}</b><span>People you can email</span></div><div><b>${done.filter((c) => c.status === 'sent').length}</b><span>Emails sent</span></div><div><b>${drafts.length}</b><span>Drafts</span></div></div>
    ${LISTERR ? `<p class="err">${esc(LISTERR)}</p>` : ''}
    ${drafts.length ? `<div class="panel"><header><h2>Drafts</h2></header><div class="em-rows">${drafts.map(row).join('')}</div></div>` : ''}
    ${canEdit() ? `<div class="panel"><header><h2>Start a new email</h2><span class="note">Pick a design. You can change every word and photo.</span></header><div class="em-pad"><div class="em-tpl">${TEMPLATES.map((t) => `<button data-em-new="${t.key}"><div class="em-thumb"><iframe title="" tabindex="-1" loading="lazy" data-em-thumb="${t.key}"></iframe></div><div><b>${esc(t.name)}</b><br><span>${esc(t.cat)}</span></div></button>`).join('')}</div></div></div>` : ''}
    <div class="panel"><header><h2>Sent</h2></header><div class="em-rows">${done.length ? done.map(row).join('') : '<div class="empty">Nothing sent yet. Emails you send show up here with how many people got them.</div>'}</div></div>`;
  }
  const sample = (html) => html.replaceAll('{{first_name}}', (X.ME.name || 'Friend').split(' ')[0]).replaceAll('{{unsubscribe_url}}', '#');
  function thumbs() { document.querySelectorAll('[data-em-thumb]').forEach((f) => { if (f.dataset.done) return; f.dataset.done = 1; const t = TEMPLATES.find((x) => x.key === f.dataset.emThumb); f.srcdoc = sample(build({ subject: t.subject, preheader: '', blocks: t.make() })); }); }

  function field(b, i, [k, kind, hint]) {
    const v = b[k] ?? ''; const id = `em-${i}-${k}`; const at = `data-em-b="${i}" data-em-f="${k}"`;
    if (kind === 'line' || kind === 'url') return `<label class="field" for="${id}">${esc(hint || '')}<input id="${id}" ${at} type="text" value="${esc(v)}" ${kind === 'url' ? 'inputmode="url" placeholder="wearecalledtocare.com/…"' : ''}></label>`;
    if (kind === 'area' || kind === 'area2') return `<label class="field" for="${id}">${esc(hint || '')}<textarea id="${id}" ${at} class="${kind === 'area2' ? 'two' : ''}">${esc(v)}</textarea></label>`;
    if (kind === 'pick') return `<label class="field" for="${id}">Style<select id="${id}" ${at}>${Object.entries(hint).map(([a, l], n) => `<option value="${a}" ${(v || Object.keys(hint)[0]) === a ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`;
    if (kind === 'pairs') return `<div class="em-pairs">${[0, 1, 2].map((n) => `<input aria-label="${hint[0]} ${n + 1}" placeholder="${hint[0]}" ${at} data-em-p="${n}.0" type="text" value="${esc((v[n] || [])[0] || '')}" class="em-in"><textarea aria-label="${hint[1]} ${n + 1}" placeholder="${hint[1]}" ${at} data-em-p="${n}.1" class="em-in" rows="2" style="min-height:0">${esc((v[n] || [])[1] || '')}</textarea>`).join('')}</div>`;
    if (kind === 'photo') { const custom = /^https?:/i.test(v);
      return `<div class="em-photos">${PHOTOS.map(([f, l]) => `<button type="button" title="${l}" aria-label="${l}" aria-pressed="${v === f}" data-em-photo="${i}" data-src="${f}"><img src="/assets/${f}" alt="" loading="lazy"></button>`).join('')}</div>
      ${custom ? `<img src="${esc(v)}" alt="" style="width:120px;height:auto;border-radius:8px">` : ''}
      <label class="btn em-up"><input type="file" accept="image/*" data-em-up="${i}" hidden><span>${custom ? 'Upload a different photo' : 'Upload your own photo'}</span></label>`; }
    return '';
  }
  function editor() {
    const d = ED; const locked = d.status !== 'draft'; const a = d.audience; const n = reach(a).length;
    const steps = [['write', '1. Write'], ['who', '2. Who gets it'], ['send', locked ? '3. Results' : '3. Check & send']];
    const top = `<div class="em-top"><div class="em-steps" role="tablist">${steps.map(([k, l]) => `<button data-em-step="${k}" aria-current="${STEP === k}">${l}</button>`).join('')}</div>
      <div class="toolbar"><span class="note" id="em-saved">${locked ? '' : DIRTY ? 'Not saved yet' : d.id ? 'Saved' : ''}</span><button class="btn" data-em-close>Back to all emails</button></div></div>`;
    const pv = `<div class="em-pv ${WIDE ? '' : 'phone'}"><header><span>Preview${locked ? '' : ' · updates as you type'}</span><span><button class="btn ghost" data-em-wide="1" ${WIDE ? 'disabled' : ''}>Computer</button> <button class="btn ghost" data-em-wide="0" ${WIDE ? '' : 'disabled'}>Phone</button></span></header><iframe id="em-frame" title="Email preview"></iframe></div>`;
    let left = '';
    if (STEP === 'write' && isNL(d) && !locked) { const h = d.blocks[0]; const last = d.blocks.length - 2;
      const sel = (i, k, opts, v) => `<select aria-label="${k}" data-em-b="${i}" data-em-f="${k}">${Object.entries(opts).map(([a, l]) => `<option value="${a}" ${v === a ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
      left = `<div class="em-form">
      <div class="em-blk"><header><b>This issue</b></header><div class="em-three"><label class="field" for="em-vol">Volume<input id="em-vol" data-em-b="0" data-em-f="vol" type="text" value="${esc(h.vol)}"></label><label class="field" for="em-iss">Issue<input id="em-iss" data-em-b="0" data-em-f="issue" type="text" value="${esc(h.issue)}"></label><label class="field" for="em-mon">Month<input id="em-mon" data-em-b="0" data-em-f="month" type="text" value="${esc(h.month)}"></label></div>
        <label class="field" for="em-subject">Email subject line<input id="em-subject" data-em-top="subject" type="text" maxlength="150" value="${esc(d.subject)}"></label>
        <p class="note" style="margin:0">Use **two stars** for <b>bold</b> and [words](link) for a link. A blank line starts a new paragraph.</p></div>
      ${d.blocks.map((b, i) => b.type !== 'nl_sec' ? '' : `<div class="em-blk em-sec ${b.on === false ? 'off' : ''}"><header><label class="tick"><input type="checkbox" data-em-on="${i}" ${b.on === false ? '' : 'checked'}> <b>${esc((b.label || 'Section').replace(/[\[\]*]/g, ''))}</b></label>
          <span class="tools"><button type="button" title="Move up" aria-label="Move section up" data-em-move="${i}" data-dir="-1" ${i <= 1 ? 'disabled' : ''}>↑</button><button type="button" title="Move down" aria-label="Move section down" data-em-move="${i}" data-dir="1" ${i >= last ? 'disabled' : ''}>↓</button><button type="button" title="Remove" aria-label="Remove section" data-em-del="${i}">×</button></span></header>
        ${b.on === false ? '<p class="note" style="margin:0">Switched off: not in this issue. Tick the box to use it.</p>' : `<label class="field" for="em-${i}-label">Heading<input id="em-${i}-label" data-em-b="${i}" data-em-f="label" type="text" value="${esc(b.label)}"></label>
          <label class="field" for="em-${i}-text">Words<textarea id="em-${i}-text" data-em-b="${i}" data-em-f="text">${esc(b.text)}</textarea></label>
          <div class="em-picrow">${b.src ? `<img src="${esc(sitePic(b.src))}" alt="">` : ''}<label class="btn em-up"><input type="file" accept="image/*" data-em-up="${i}" hidden><span>${b.src ? 'Change the photo' : 'Add a photo'}</span></label>${b.src ? `<button type="button" class="btn ghost" data-em-nopic="${i}">Remove photo</button>` : ''}</div>
          ${b.src ? `<label class="field" for="em-${i}-alt">Describe the photo (for people who can't see it)<input id="em-${i}-alt" data-em-b="${i}" data-em-f="alt" type="text" value="${esc(b.alt)}"></label>` : ''}
          <div class="em-three"><label class="field">Background${sel(i, 'style', { plain: 'White', sky: 'Light blue', navy: 'Navy' }, b.style || 'plain')}</label>${b.src ? `<label class="field">Photo on the${sel(i, 'side', { right: 'Right', left: 'Left' }, b.side || 'right')}</label>` : ''}</div>
          <details><summary style="cursor:pointer;font-weight:600;font-size:.9rem">Add a link (optional)</summary><div class="em-three" style="margin-top:10px"><label class="field" for="em-${i}-ll">Link words<input id="em-${i}-ll" data-em-b="${i}" data-em-f="link_label" type="text" value="${esc(b.link_label)}"></label><label class="field" for="em-${i}-lu" style="grid-column:span 2">Link<input id="em-${i}-lu" data-em-b="${i}" data-em-f="link_url" type="text" inputmode="url" value="${esc(b.link_url)}" placeholder="wearecalledtocare.com/…"></label></div></details>`}</div>`).join('')}
      <div class="em-blk"><div class="toolbar"><button type="button" class="btn" data-em-addsec>+ Add Another Section</button><button type="button" class="btn" data-em-pdf>Download the One-Page PDF</button></div></div></div>`; }
    else if (STEP === 'write') left = locked ? `<div class="em-ok">This email has been sent, so it can't be changed. Use <b>Use This Again</b> on the Results step to start a new one from it.</div>` : `<div class="em-form">
      <div class="em-blk"><label class="field" for="em-name">Name for your own records<input id="em-name" data-em-top="name" type="text" value="${esc(d.name)}" placeholder="December Support Night invite"></label>
        <label class="field" for="em-subject">Subject line<input id="em-subject" data-em-top="subject" type="text" maxlength="150" value="${esc(d.subject)}"></label>
        <label class="field" for="em-pre">Preview line (the grey words next to the subject in the inbox)<input id="em-pre" data-em-top="preheader" type="text" maxlength="150" value="${esc(d.preheader)}"></label>
        <p class="note" style="margin:0">Type <b>{{first_name}}</b> anywhere to use each person's first name. Use **two stars** for <b>bold</b>, *one star* for <i>italic</i>, and [words](link) for a link.</p></div>
      ${d.blocks.map((b, i) => { const [label, fields] = KIND[b.type] || [b.type, []]; const fixed = b.type === 'footer' || b.type === 'header';
        return `<div class="em-blk"><header><b>${label}</b>${fixed ? '' : `<span class="tools"><button type="button" title="Move up" aria-label="Move ${label} up" data-em-move="${i}" data-dir="-1" ${i <= 1 ? 'disabled' : ''}>↑</button><button type="button" title="Move down" aria-label="Move ${label} down" data-em-move="${i}" data-dir="1" ${i >= d.blocks.length - 2 ? 'disabled' : ''}>↓</button><button type="button" title="Remove" aria-label="Remove ${label}" data-em-del="${i}">×</button></span>`}</header>${fields.map((f) => field(b, i, f)).join('')}</div>`; }).join('')}
      <div class="em-blk"><header><b>Add a piece</b></header><div class="em-add">${ADDABLE.map((t) => `<button type="button" data-em-add="${t}">+ ${KIND[t][0]}</button>`).join('')}</div></div></div>`;
    if (STEP === 'who') { const tags = tagCounts().filter(([t]) => !TAGQ || t.toLowerCase().includes(TAGQ.toLowerCase()));
      const box = (key) => `<div class="em-tags">${tags.map(([t, c]) => `<label><input type="checkbox" data-em-tag="${key}" value="${esc(t)}" ${(a[key] || []).includes(t) ? 'checked' : ''} ${locked ? 'disabled' : ''}>${esc(t)}<span>${c}</span></label>`).join('') || '<p class="note">No tags match.</p>'}</div>`;
      left = `<div class="em-form"><div class="em-blk"><div class="em-reach" id="em-reach">${n.toLocaleString()} ${n === 1 ? 'person' : 'people'}</div><p class="note" style="margin:0">will get this email. People who unsubscribed, bounced, or are marked Do Not Email are always left out.</p></div>
      <div class="em-blk"><label class="tick"><input type="radio" name="em-mode" value="all" ${a.mode !== 'tags' ? 'checked' : ''} ${locked ? 'disabled' : ''}> Everyone on the email list</label>
        <label class="tick"><input type="radio" name="em-mode" value="tags" ${a.mode === 'tags' ? 'checked' : ''} ${locked ? 'disabled' : ''}> Only people with certain tags</label></div>
      ${a.mode === 'tags' ? `<div class="em-blk"><header><b>Send to anyone with one of these tags</b></header><label class="field" for="em-tagq">Find a tag<input id="em-tagq" type="search" value="${esc(TAGQ)}" placeholder="Type to narrow the list"></label>${box('tags')}</div>` : ''}
      <details class="em-blk" ${(a.skip || []).length ? 'open' : ''}><summary style="cursor:pointer;font-weight:700">Leave some people out${(a.skip || []).length ? ` (${a.skip.length} tag${a.skip.length > 1 ? 's' : ''})` : ''}</summary><p class="note" style="margin:0">Anyone with one of these tags is skipped, even if they match above.</p>${a.mode === 'tags' ? '' : `<label class="field" for="em-tagq">Find a tag<input id="em-tagq" type="search" value="${esc(TAGQ)}" placeholder="Type to narrow the list"></label>`}${box('skip')}</details></div>`; }
    if (STEP === 'send') left = locked ? results() : check(n);
    return `<div style="display:grid;gap:18px">${top}<div class="em-grid"><div>${left}</div>${pv}</div></div>`;
  }
  function check(n) { const d = ED; const miss = blanks(d); const problems = [];
    if (!d.subject.trim()) problems.push('Add a subject line (step 1).');
    if (!n) problems.push('Nobody matches the audience you picked (step 2).');
    return `<div class="em-form">
      <div class="em-blk"><dl class="fields"><dt>Subject</dt><dd>${esc(d.subject) || '<i>None yet</i>'}</dd><dt>From</dt><dd>We Are Called to Care</dd><dt>Going to</dt><dd><b>${n.toLocaleString()}</b> ${n === 1 ? 'person' : 'people'} · ${esc(audText(d.audience))}</dd></dl>
        <label class="field" for="em-reply">Replies go to<input id="em-reply" data-em-top="reply_to" type="email" value="${esc(d.reply_to)}" placeholder="shari@wearecalledtocare.com"></label></div>
      ${isNL(d) ? `<div class="em-ok">The one-page PDF is made and linked in the email when you send a test or send for real. <button type="button" class="btn" style="margin-left:6px" data-em-pdf>Download the PDF</button></div>` : ''}
      ${miss.length ? `<div class="em-warn"><b>Still to fill in:</b> ${miss.map(esc).join(', ')}. These are placeholder words from the template.</div>` : ''}
      ${problems.map((p) => `<div class="em-warn">${p}</div>`).join('')}
      <div class="em-blk"><header><b>Send yourself a test first</b></header><form id="em-test" style="display:flex;gap:8px;flex-wrap:wrap;align-items:end"><label class="field" for="em-testto" style="flex:1;min-width:220px">Send the test to<input id="em-testto" type="email" required value="${esc(X.ME.email || '')}"></label><button class="btn" type="submit">Send Test</button></form><p class="note" style="margin:0" id="em-testmsg">The test shows your first name where {{first_name}} is. Look at it on your phone too.</p></div>
      <div class="em-blk"><button class="btn pink" style="justify-self:start;padding:13px 26px;font-size:1rem" data-em-send ${problems.length ? 'disabled' : ''}>Send to ${n.toLocaleString()} ${n === 1 ? 'Person' : 'People'}…</button><p class="note" style="margin:0">You'll be asked to confirm. Once it starts, it can't be unsent.</p></div></div>`; }
  function results() { const d = ED; const s = SENDING; const left = Math.max(0, d.total - d.sent - d.failed); const pct = d.total ? Math.round((d.sent + d.failed) / d.total * 100) : 0;
    const head = d.status === 'sending' ? (s && s.running ? 'Sending…' : 'Sending stopped before it finished') : d.status === 'canceled' ? 'Stopped' : 'Sent';
    return `<div class="em-form"><div class="em-blk"><h2 style="font-family:var(--serif);font-weight:400;font-size:2rem;margin:0">${head}</h2>
      <div class="em-prog" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div>
      <div class="summary"><div><b>${d.sent.toLocaleString()}</b><span>Sent</span></div><div><b>${left.toLocaleString()}</b><span>Still to send</span></div><div><b>${d.failed}</b><span>Could not be sent</span></div></div>
      ${s && s.msg ? `<div class="em-warn">${esc(s.msg)}</div>` : ''}
      ${d.status === 'sending' && s && s.running ? `<p class="note" style="margin:0">Keep this page open until it finishes. If it closes, come back here and press Resume.</p>` : ''}
      ${d.status === 'sending' && !(s && s.running) ? `<div class="toolbar"><button class="btn pink" data-em-resume>Resume Sending to ${left.toLocaleString()} More</button><button class="btn" data-em-cancel>Stop Here</button></div>` : ''}
      ${d.status !== 'sending' ? `<p class="note" style="margin:0">${d.finished_at ? 'Finished ' + fmtDT(D(d.finished_at)) + '. ' : ''}Sent to: ${esc(audText(d.audience))}.${d.failed ? ' Addresses that could not be sent to are usually typos or closed accounts.' : ''}</p>` : ''}</div>
      ${d.status !== 'sending' && canEdit() ? `<div class="em-blk"><button class="btn" style="justify-self:start" data-em-copy>Use This Again as a New Draft</button></div>` : ''}</div>`; }

  function paint() { const f = $('#em-frame'); if (!f || !ED) return;
    // "Computer" shows the full 660px-wide email, shrunk to fit the panel; "Phone" shows it at phone width.
    const room = f.parentElement.clientWidth; f.style.width = WIDE ? '660px' : ''; f.style.zoom = WIDE && room < 660 ? String(room / 660) : ''; const html = sample(ED.status === 'draft' ? build(ED) : (ED.html || build(ED)));
    const doc = f.contentDocument; if (!doc) { f.srcdoc = html; return; } const y = doc.scrollingElement ? doc.scrollingElement.scrollTop : 0; doc.open(); doc.write(html); doc.close(); if (doc.scrollingElement) doc.scrollingElement.scrollTop = y; }
  function show() { render(); paint(); }
  function touch() { DIRTY = true; const s = $('#em-saved'); if (s) s.textContent = 'Saving…'; clearTimeout(SAVING); SAVING = setTimeout(save, 1200); clearTimeout(touch.p); touch.p = setTimeout(paint, 180); }
  async function save() { clearTimeout(SAVING); const d = ED; if (!d || d.status !== 'draft' || !canEdit()) return true;
    const row = { name: d.name.trim() || d.subject.trim() || 'Untitled email', template: d.template, subject: d.subject.trim(), preheader: d.preheader.trim(), reply_to: (d.reply_to || '').trim(), blocks: d.blocks, html: build(d), audience: d.audience, updated_at: new Date().toISOString() };
    const r = d.id ? await X.SB.from('email_campaigns').update(row).eq('id', d.id).eq('status', 'draft').select('id').maybeSingle() : await X.SB.from('email_campaigns').insert({ ...row, created_by: X.ME.name || X.ME.email || '' }).select('id').single();
    const s = $('#em-saved');
    if (r.error || !r.data) { if (s) s.textContent = 'Could not save'; toast(r.error ? r.error.message : 'This draft could not be saved.', true); return false; }
    d.id = r.data.id; DIRTY = false; if (s) s.textContent = 'Saved'; LIST = null; return true; }
  function start(key) { const t = TEMPLATES.find((x) => x.key === key); ED = { id: null, status: 'draft', template: t.key, name: '', subject: t.subject, preheader: t.preheader, reply_to: '', blocks: t.make(), audience: { mode: 'all', tags: [], skip: [] }, total: 0, sent: 0, failed: 0 };
    STEP = 'write'; DIRTY = true; SENDING = null; show(); window.scrollTo(0, 0); }
  async function open(id) { const r = await X.SB.from('email_campaigns').select('*').eq('id', id).single(); if (r.error) { toast('That email could not be opened.', true); return; }
    ED = { ...r.data, audience: { mode: 'all', tags: [], skip: [], ...(r.data.audience || {}) }, blocks: r.data.blocks || [] }; STEP = ED.status === 'draft' ? 'write' : 'send'; DIRTY = false; SENDING = null; show(); window.scrollTo(0, 0); }
  async function close() { if (ED && DIRTY) await save(); ED = null; SENDING = null; LIST = null; render(); }
  async function loop() { const d = ED; SENDING = { running: true, msg: '' }; show();
    for (;;) { if (ED !== d) return; const r = await fn({ action: 'batch', id: d.id });
      if (!r.ok) { SENDING = { running: false, msg: r.error || 'Sending paused.' }; break; }
      d.sent = r.sent; d.failed = r.failed; if (r.status) d.status = r.status;
      if (r.done) { d.status = d.status === 'canceled' ? 'canceled' : 'sent'; d.finished_at = new Date().toISOString(); SENDING = { running: false, msg: '' }; toast(`Sent to ${d.sent.toLocaleString()} people.`); break; }
      if (r.stop) { SENDING = { running: false, msg: r.stop }; break; }
      if (ED === d && STEP === 'send') show(); }
    LIST = null; if (ED === d) show(); }
  function confirmSend() { const d = ED; const n = reach(d.audience).length; const miss = blanks(d);
    layer(`<div class="drawer"><button class="scrim" data-close aria-label="Close"></button><div class="sheet" role="dialog" aria-modal="true" aria-label="Confirm sending"><button class="x" type="button" data-close aria-label="Close">×</button>
      <div><span class="label" style="color:var(--pink)">Last check</span><h2>Send to ${n.toLocaleString()} ${n === 1 ? 'person' : 'people'}?</h2></div>
      <dl class="fields"><dt>Subject</dt><dd>${esc(d.subject)}</dd><dt>Going to</dt><dd>${esc(audText(d.audience))}</dd></dl>
      ${miss.length ? `<div class="em-warn"><b>This email still has placeholder words:</b> ${miss.map(esc).join(', ')}. Go back and fill them in unless you meant to leave them.</div>` : ''}
      <p class="note">This sends right away and can't be unsent.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn pink" id="em-go">Yes, Send It Now</button><button class="btn" data-close>Not Yet</button></div></div></div>`);
    $('#em-go').addEventListener('click', async (ev) => { ev.target.disabled = true; ev.target.textContent = 'Starting…';
      if (!(await save())) { closeLayer(); return; }
      if (isNL(d)) { ev.target.textContent = 'Making the PDF…'; if (!(await ensurePdf())) { closeLayer(); return; } }
      const r = await fn({ action: 'start', id: d.id }); closeLayer();
      if (!r.ok) { toast(r.error || 'Sending could not start.', true); return; }
      d.status = 'sending'; d.total = r.total; d.sent = 0; d.failed = 0; STEP = 'send'; loop(); }); }

  /* ---------- events ---------- */
  document.addEventListener('click', async (ev) => {
    if (!X || !['email', 'newsletter'].includes(X.VIEW)) return; const t = ev.target.closest('button,[data-em-open]'); if (!t) return; const ds = t.dataset;
    if (ds.emNl) return startNewsletter(ds.emNl === 'copy');
    if (ds.emNew) return start(ds.emNew);
    if (ds.emOpen) return open(ds.emOpen);
    if (!ED) return;
    if ('emClose' in ds) return close();
    if (ds.emStep) { if (DIRTY) save(); STEP = ds.emStep; TAGQ = ''; return show(); }
    if (ds.emWide) { WIDE = ds.emWide === '1'; return show(); }
    if ('emPdf' in ds) return previewPdf(t);
    if ('emSend' in ds) return confirmSend();
    if ('emResume' in ds) return loop();
    if ('emCancel' in ds) { if (!confirm('Stop this email here? People who already got it keep it; nobody else will.')) return; const r = await fn({ action: 'cancel', id: ED.id }); if (r.ok) { ED.status = 'canceled'; ED.total = ED.sent + ED.failed; LIST = null; show(); } else toast(r.error || 'Could not stop it.', true); return; }
    if ('emCopy' in ds) { const src = ED; ED = { id: null, status: 'draft', template: src.template, name: (src.name || '') + ' (copy)', subject: src.subject, preheader: src.preheader, reply_to: src.reply_to || '', blocks: JSON.parse(JSON.stringify(src.blocks)), audience: JSON.parse(JSON.stringify(src.audience)), total: 0, sent: 0, failed: 0 }; STEP = 'write'; DIRTY = true; SENDING = null; show(); return save(); }
    if (ED.status !== 'draft') return;
    if (ds.emMove) { const i = +ds.emMove, j = i + +ds.dir; const b = ED.blocks; if (j < 1 || j > b.length - 2) return; [b[i], b[j]] = [b[j], b[i]]; touch(); return show(); }
    if (ds.emDel) { ED.blocks.splice(+ds.emDel, 1); touch(); return show(); }
    if (ds.emAdd) { const at = ED.blocks.findIndex((b) => b.type === 'footer'); ED.blocks.splice(at < 0 ? ED.blocks.length : at, 0, { type: ds.emAdd, ...JSON.parse(JSON.stringify(FRESH[ds.emAdd] || {})) }); touch(); show();
      const cards = document.querySelectorAll('.em-form > .em-blk'); const el = cards[cards.length - 3]; if (el) { el.scrollIntoView({ block: 'center' }); const f = el.querySelector('input,textarea'); if (f) f.focus(); } return; }
    if (ds.emPhoto) { ED.blocks[+ds.emPhoto].src = ds.src; touch(); return show(); }
    if (ds.emNopic) { ED.blocks[+ds.emNopic].src = ''; touch(); return show(); }
    if ('emAddsec' in ds) { const at = ED.blocks.findIndex((b) => b.type === 'footer'); ED.blocks.splice(at < 0 ? ED.blocks.length : at, 0, SEC({ label: '[Section heading]', text: '' })); touch(); show();
      const cards = document.querySelectorAll('.em-sec'); const el = cards[cards.length - 1]; if (el) { el.scrollIntoView({ block: 'center' }); const f = el.querySelector('input[type=text]'); if (f) { f.focus(); f.select(); } } return; }
  });
  document.addEventListener('input', (ev) => {
    if (!X || !['email', 'newsletter'].includes(X.VIEW) || !ED) return; const t = ev.target; const ds = t.dataset;
    if (t.id === 'em-tagq') { TAGQ = t.value; const pos = t.selectionStart; show(); const q = $('#em-tagq'); if (q) { q.focus(); q.setSelectionRange(pos, pos); } return; }
    if (ED.status !== 'draft') return;
    if (ds.emTop) { ED[ds.emTop] = t.value; return touch(); }
    if (ds.emB) { const b = ED.blocks[+ds.emB]; if (!b) return;
      if (ds.emP) { const [n, c] = ds.emP.split('.').map(Number); b[ds.emF] = b[ds.emF] || []; while (b[ds.emF].length <= n) b[ds.emF].push(['', '']); b[ds.emF][n][c] = t.value; }
      else b[ds.emF] = t.value;
      if (t.tagName === 'SELECT') { touch(); return show(); }
      return touch(); }
  });
  document.addEventListener('change', (ev) => {
    if (!X || !['email', 'newsletter'].includes(X.VIEW) || !ED || ED.status !== 'draft') return; const t = ev.target;
    if (t.dataset.emUp) return uploadPhoto(t);
    if (t.dataset.emOn) { ED.blocks[+t.dataset.emOn].on = t.checked; touch(); return show(); }
    if (t.name === 'em-mode') { ED.audience.mode = t.value; touch(); return show(); }
    if (t.dataset.emTag) { const k = t.dataset.emTag; const set = new Set(ED.audience[k] || []); t.checked ? set.add(t.value) : set.delete(t.value); ED.audience[k] = [...set]; touch();
      const n = reach(ED.audience).length; const el = $('#em-reach'); if (el) el.textContent = `${n.toLocaleString()} ${n === 1 ? 'person' : 'people'}`; }
  });
  document.addEventListener('submit', async (ev) => {
    if (ev.target.id !== 'em-test' || !ED) return; ev.preventDefault(); const b = ev.target.querySelector('button'); const msg = $('#em-testmsg'); b.disabled = true; b.textContent = 'Sending…';
    if (isNL(ED) && !(await ensurePdf())) { b.disabled = false; b.textContent = 'Send Test'; return; }
    const r = await fn({ action: 'test', subject: ED.subject, html: build(ED), reply_to: ED.reply_to, to: [$('#em-testto').value], first_name: (X.ME.name || '').split(' ')[0] });
    b.disabled = false; b.textContent = 'Send Test'; msg.textContent = r.ok ? `Test sent to ${$('#em-testto').value}. Check your inbox (and spam folder the first time).` : (r.error || 'The test could not be sent.'); msg.style.color = r.ok ? '' : 'var(--bad)';
  });
  window.addEventListener('beforeunload', (ev) => { if (SENDING && SENDING.running) { ev.preventDefault(); ev.returnValue = ''; } });
  return { init: (ctx) => { X = ctx; }, page, build, thumbs, paint, TEMPLATES };
})();
