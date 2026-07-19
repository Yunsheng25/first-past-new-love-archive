export function createBgmController({ document, button, manager }) {
  let stateVersion = 0;
  let gestureStarted = false;

  const sync = () => {
    if (!button) return;
    const { enabled, unavailable } = manager.state();
    button.setAttribute('aria-pressed', String(enabled));
    button.disabled = unavailable;
    button.setAttribute('aria-label', unavailable
      ? '背景音乐不可用'
      : enabled ? '关闭背景音乐' : '开启背景音乐');
  };

  const run = async (action, version) => {
    try {
      return await action();
    } catch {
      return false;
    } finally {
      if (version === stateVersion) sync();
    }
  };

  const startFromGesture = (event) => {
    if (gestureStarted || event.target?.closest?.('[data-bgm-toggle]')) return Promise.resolve(false);
    gestureStarted = true;
    return run(() => manager.startFromGesture(), ++stateVersion);
  };

  const toggle = () => run(() => manager.toggle(), ++stateVersion);

  const setRoute = (route) => {
    const version = ++stateVersion;
    sync();
    return run(
      () => (route.name === 'film' ? manager.enterFilm() : manager.leaveFilm()),
      version,
    );
  };

  const bind = () => {
    const onGesture = (event) => {
      if (event.target?.closest?.('[data-bgm-toggle]')) return;
      document.removeEventListener('pointerdown', onGesture, true);
      document.removeEventListener('keydown', onGesture, true);
      void startFromGesture(event);
    };
    document.addEventListener('pointerdown', onGesture, { capture: true });
    document.addEventListener('keydown', onGesture, { capture: true });
    button?.addEventListener('click', () => { void toggle(); });
    sync();
  };

  return { bind, setRoute, startFromGesture, toggle };
}
