/* Render PostgreSQL-backed accounts and profile sync. Sessions are server-side, HttpOnly cookies. */
(() => {
  const $ = (selector) => document.querySelector(selector);
  let currentUser = null;
  let applyingRemoteProfile = false;

  const status = (message, isError = false) => {
    const el = $('#accountStatus');
    if (el) { el.textContent = message; el.style.color = isError ? 'var(--danger, #b42318)' : ''; }
  };
  const setSignedInUI = (user) => {
    const heading = $('#accountHeading');
    const signIn = $('#accountSignIn');
    const signUp = $('#accountSignUp');
    const signOut = $('#accountSignOut');
    const email = $('#accountEmail');
    const password = $('#accountPassword');
    if (heading) heading.textContent = user ? `Signed in as ${user.email || 'listener'}` : 'Sync your profile';
    if (signIn) signIn.hidden = Boolean(user);
    if (signUp) signUp.hidden = Boolean(user);
    if (signOut) signOut.hidden = !user;
    if (email) { email.disabled = Boolean(user); if (user) email.value = user.email || ''; }
    if (password) { password.disabled = Boolean(user); if (user) password.value = ''; }
  };
  async function api(path, options = {}) {
    const response = await fetch(path, {
      credentials: 'same-origin',
      ...options,
      headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
    return data;
  }
  async function fetchProfile() {
    if (!currentUser) return null;
    const data = await api('/api/profile');
    return data.profile || null;
  }
  async function syncProfile(profile) {
    if (!currentUser || applyingRemoteProfile) return false;
    try {
      await api('/api/profile', { method: 'PUT', body: JSON.stringify({ profile }) });
      status('Your profile is synced to your account.');
      return true;
    } catch (error) {
      status(`Your profile is saved on this device, but cloud sync failed: ${error.message}`, true);
      return false;
    }
  }
  async function applyRemoteProfile() {
    if (!currentUser) return;
    try {
      const profile = await fetchProfile();
      if (profile && typeof profile === 'object') {
        applyingRemoteProfile = true;
        localStorage.setItem('laila-profile', JSON.stringify(profile));
        localStorage.setItem('laila-visited', 'yes');
        window.dispatchEvent(new CustomEvent('laila-cloud-profile-loaded', { detail: profile }));
        status('Your profile has been loaded from your account.');
      } else {
        let local = {};
        try { local = JSON.parse(localStorage.getItem('laila-profile') || '{}'); } catch {}
        if (Object.keys(local).length) await syncProfile(local);
        else status('Account ready. Save your profile to sync it across devices.');
      }
    } catch (error) { status(`Signed in, but profile loading failed: ${error.message}`, true); }
    finally { applyingRemoteProfile = false; }
  }
  async function runAuth(action) {
    const email = $('#accountEmail')?.value.trim();
    const password = $('#accountPassword')?.value;
    if (!email || !password) { status('Enter your email and password first.', true); return; }
    const signIn = $('#accountSignIn'); const signUp = $('#accountSignUp');
    if (signIn) signIn.disabled = true; if (signUp) signUp.disabled = true;
    try {
      const result = await api(action === 'signup' ? '/api/auth/signup' : '/api/auth/login', {
        method: 'POST', body: JSON.stringify({ email, password })
      });
      currentUser = result.user;
      setSignedInUI(currentUser);
      status(action === 'signup' ? 'Account created successfully.' : 'You are signed in. Loading your profile…');
      await applyRemoteProfile();
    } catch (error) { status(error.message || 'Authentication failed. Please try again.', true); }
    finally { if (signIn) signIn.disabled = false; if (signUp) signUp.disabled = false; }
  }
  async function init() {
    try {
      const result = await api('/api/auth/me');
      currentUser = result.user;
      setSignedInUI(currentUser);
      if (currentUser) await applyRemoteProfile();
      else status('Create an account to keep your preferences across devices.');
    } catch (error) {
      currentUser = null; setSignedInUI(null);
      status(error.message.includes('Database is not configured') || error.message.includes('temporarily unavailable')
        ? 'Cloud accounts are unavailable until the Render database is configured.'
        : 'Create an account to keep your preferences across devices.', true);
    }
  }
  document.addEventListener('DOMContentLoaded', () => {
    $('#accountForm')?.addEventListener('submit', (event) => { event.preventDefault(); runAuth('login'); });
    $('#accountSignUp')?.addEventListener('click', () => runAuth('signup'));
    $('#accountSignOut')?.addEventListener('click', async () => {
      try { await api('/api/auth/logout', { method: 'POST', body: '{}' }); currentUser = null; setSignedInUI(null); status('You are signed out. Your local profile is still available on this device.'); }
      catch (error) { status(error.message, true); }
    });
    init();
  });
  window.LailaCloud = { isConfigured: () => true, isSignedIn: () => Boolean(currentUser), syncProfile, getProfile: fetchProfile };
})();
