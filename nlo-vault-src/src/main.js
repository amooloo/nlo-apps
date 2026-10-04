/* NLO Vault — start-up */
import * as S from './store.js';
import { initLock, showSignIn, showResetLink, notConfigured, showEmailVerified } from './ui/lock.js';
import { showVault } from './ui/vault.js';

function boot() {
  // never run inside someone else's frame (the server forbids it too)
  if (window.top !== window.self) { document.body.textContent = ''; return; }
  if (!S.init()) { notConfigured(); return; }
  initLock(() => showVault());
  const p = new URLSearchParams(location.search);
  const mode = p.get('mode'), oob = p.get('oobCode');
  // links in emails from the vault's sign-in service (when its action link points here)
  if (mode === 'resetPassword' && oob) { showResetLink(oob); return; }
  if (mode === 'verifyEmail' && oob) {
    history.replaceState(null, '', location.pathname);
    S.verifyEmailLink(oob).then(() => showEmailVerified(true), () => showEmailVerified(false));
    return;
  }
  const locked = p.get('locked');
  if (locked || location.search) history.replaceState(null, '', location.pathname);
  showSignIn({
    setupLink: p.has('setup'),
    msg: locked === 'idle' ? 'The vault locked itself after a while without use.' : locked === 'removed' ? 'Your access to the vault was turned off.' : '',
    kind: 'soft'
  });
}
// test build only (removed from the production build): lets the browser tests look at the state
if (__VAULT_EMU__) window.__vault = { S, V: S.V }; // eslint-disable-line no-undef
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
