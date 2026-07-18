function setMediaStatus(status, messageElement, message) {
  messageElement.textContent = message;
  status.hidden = false;
}

function clearMediaStatus(status) {
  status.hidden = true;
}

function attemptPlayback(video, onSuccess, onFailure) {
  let playback;
  try {
    playback = video.play();
  } catch (error) {
    onFailure(error);
    return Promise.resolve(false);
  }

  return Promise.resolve(playback).then(
    () => {
      onSuccess();
      return true;
    },
    (error) => {
      onFailure(error);
      return false;
    },
  );
}

export function bindIntroMedia(root, { reduceMotion = false } = {}) {
  const video = root.querySelector('.intro-film');
  const status = root.querySelector('.intro-media-status');
  const message = root.querySelector('[data-intro-media-message]');
  const retry = root.querySelector('[data-retry-intro]');
  if (!video || !status || !message || !retry) return;

  const showAutoplayFailure = () => {
    setMediaStatus(status, message, '背景影片未能自动播放');
  };
  const showLoadFailure = () => {
    setMediaStatus(status, message, '背景影片加载失败');
  };
  const play = () => attemptPlayback(video, () => clearMediaStatus(status), showAutoplayFailure);

  video.addEventListener('error', showLoadFailure);
  video.addEventListener('playing', () => clearMediaStatus(status));
  retry.addEventListener('click', () => {
    if (video.error) video.load();
    play();
  });

  if (reduceMotion) {
    video.pause();
  } else {
    play();
  }
}

export function bindFilmMedia(root, { playImmediately = false } = {}) {
  const video = root.querySelector('.film-video');
  const status = root.querySelector('.film-media-status');
  const message = root.querySelector('[data-film-media-message]');
  const retry = root.querySelector('[data-retry-film]');
  if (!video || !status || !message || !retry) return;

  const showFailure = () => {
    setMediaStatus(status, message, '影片加载失败或未能开始播放，请重试。');
  };
  const play = () => attemptPlayback(video, () => clearMediaStatus(status), showFailure);

  video.addEventListener('error', showFailure);
  video.addEventListener('playing', () => clearMediaStatus(status));
  retry.addEventListener('click', () => {
    if (video.error) video.load();
    play();
  });

  if (playImmediately) play();
}

export function focusRenderedView(app, { preferFilm = false } = {}) {
  const target = preferFilm ? app.querySelector('.film-video') ?? app : app;
  target.focus({ preventScroll: true });
}
