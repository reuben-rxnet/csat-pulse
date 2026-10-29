'use strict';
// Which email domains count as "company" addresses (for stakeholder surveys and reports).
// A pattern without a dot is the company part of the address and may use "*": "essilor*" matches essilor.co.th,
// essilorusa.com, essilorluxottica.id and subdomains such as cn.essilor.com – but not notessilor.com or essilor.evil.org.
// A pattern with a dot ("nikonlenswear.com") is that exact domain or a subdomain of it. No patterns = any address.
function domainAllowed(host, patterns) {
  if (!patterns || !patterns.length) return true;
  const parts = String(host || '').toLowerCase().split('.'), suffixes = parts.map((_, i) => parts.slice(i).join('.'));
  return patterns.some(raw => {
    const p = String(raw).toLowerCase().replace(/^@/, '').replace(/[^a-z0-9.*-]/g, '');
    if (!p) return false;
    if (p.includes('.')) return suffixes.includes(p);
    const label = new RegExp('^' + p.split('*').join('[a-z0-9-]*') + '$');
    return suffixes.some(s => { const [company, ...end] = s.split('.'); return label.test(company) && end.length >= 1 && end.length <= 2 && end.every(x => /^[a-z]{2,3}$/.test(x)); });
  });
}

module.exports = { domainAllowed };
