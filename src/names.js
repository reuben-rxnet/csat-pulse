'use strict';
// First name for "Hello <name>". HDA contacts often store the full name as "SURNAME Firstname" (e.g. "DSOUZA REUBEN"),
// so: 1) use the contact's first-name field; 2) else take it from a first.last email when that word is part of the name
//     (but not when it's the capitalised surname at the start); 3) else no name – "Hello," beats greeting by surname.

const titleCase = s => String(s).trim().toLocaleLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (m, sep, ch) => sep + ch.toLocaleUpperCase());

function firstName({ firstName: given, fullName, email } = {}) {
  if (given && String(given).trim()) return titleCase(given);
  const m = /^([\p{L}]{2,})[._-]\p{L}/u.exec(String(email || '').split('@')[0]);
  if (!m || !fullName) return '';
  const words = String(fullName).trim().split(/[\s,]+/);
  const i = words.findIndex(w => w.toLocaleLowerCase() === m[1].toLocaleLowerCase());
  if (i < 0) return '';
  if (i === 0 && words.length > 1 && words[0] === words[0].toLocaleUpperCase()) return ''; // "DSOUZA Reuben" + dsouza.reuben@ → surname
  return titleCase(m[1]);
}

// For a stored survey row (older rows have no requester_first_name yet).
const greetingName = s => s.requester_first_name || firstName({ fullName: s.requester_name, email: s.requester_email });

module.exports = { firstName, greetingName, titleCase };
