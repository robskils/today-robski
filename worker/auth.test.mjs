// Allowlist matching. Run: node worker/auth.test.mjs
//
// Wildcards are where a lookalike domain sneaks in, so the negative cases
// matter more than the positive ones here.

import { isAllowed } from './auth.js';

const env = { ADMIN_EMAILS: 'robin@lumley-savile.com,robin@incremento.co,*@robski.uk' };
let failed = 0;

function check(email, want) {
  const got = isAllowed(email, env);
  const ok = got === want;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${String(email).padEnd(34)} -> ${got}${ok ? '' : `  (wanted ${want})`}`);
  if (!ok) failed++;
}

console.log('\nallowed');
check('robin@lumley-savile.com', true);
check('robin@incremento.co', true);
check('anything@robski.uk', true);
check('hello@robski.uk', true);
check('ROBIN@LUMLEY-SAVILE.COM', true);      // case folded
check('  robin@incremento.co  ', true);      // trimmed

console.log('\nrejected');
check('someone@lumley-savile.com', false);   // exact entry, not a wildcard
check('someone@incremento.co', false);
check('robin@notrobski.uk', false);          // suffix lookalike
check('robin@robski.uk.evil.com', false);    // domain is evil.com
check('robin@mail.robski.uk', false);        // subdomain is not the domain
check('robin@robski.co.uk', false);
check('robin@evil.com', false);
check('', false);
check('@robski.uk', false);                  // no local part
check('notanemail', false);
check(null, false);
check(undefined, false);

console.log('\nan empty allowlist locks everyone out, rather than letting them in');
{
  const got = isAllowed('robin@lumley-savile.com', { ADMIN_EMAILS: '' });
  const ok = got === false;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} empty ADMIN_EMAILS -> ${got}`);
  if (!ok) failed++;
}

console.log(failed ? `\n${failed} failed\n` : '\nall passed\n');
process.exit(failed ? 1 : 0);
