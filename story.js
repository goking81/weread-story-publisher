const pages = document.querySelectorAll('.page');
const capture = Number(new URLSearchParams(location.search).get('slide'));
if (capture >= 1 && capture <= pages.length) {
  document.querySelector('.report').classList.add('capture');
  pages.forEach((page, index) => page.style.display = index === capture - 1 ? 'flex' : 'none');
  pages[capture - 1].classList.add('seen');
} else {
  const observer = new IntersectionObserver(entries => entries.forEach(entry => entry.isIntersecting && entry.target.classList.add('seen')), {threshold:.45});
  pages.forEach(page => observer.observe(page));
}

const shareSheet = document.querySelector('#shareSheet');
document.querySelector('#shareLaunch')?.addEventListener('click', () => shareSheet?.showModal());

const identityNote = document.querySelector('#identityNote');
document.querySelectorAll('[data-identity]').forEach(option => option.addEventListener('click', () => {
  document.querySelectorAll('[data-identity]').forEach(button => button.setAttribute('aria-pressed', String(button === option)));
  identityNote.textContent = option.dataset.identity === '匿名'
    ? '当前预览：匿名。正式生成时可以选择是否显示微信读书昵称和头像。'
    : `当前预览：${option.dataset.identity}。正式生成时将按你的选择写入分享页。`;
}));

const storySlug = location.pathname.match(/^\/s\/([A-Za-z0-9_-]{12,})$/)?.[1];
if (storySlug) loadPublishedStory(storySlug);

async function loadPublishedStory(slug) {
  try {
    const response = await fetch(`/api/stories/${slug}`);
    if (!response.ok) throw new Error('故事链接已失效');
    renderStory(await response.json(), slug);
  } catch {
    document.querySelector('.report').replaceWith(Object.assign(document.createElement('main'), {
      className: 'story-unavailable', textContent: '这份阅读故事已失效或不存在。'
    }));
    document.title = '阅读故事不可用';
  }
}

function renderStory(story, slug) {
  const { report, identity } = story;
  const set = (name, value) => document.querySelectorAll(`[data-story="${name}"]`).forEach(node => node.textContent = String(value));
  const totalHours = Math.floor(report.totalMinutes / 60);
  const totalMinutes = report.totalMinutes % 60;
  const topHours = Math.floor(report.topBook.minutes / 60);
  const topMinutes = report.topBook.minutes % 60;
  set('year', report.year);
  set('focusPercent', report.focusPercent);
  set('totalHours', totalHours);
  set('totalMinutes', totalMinutes);
  set('topHours', topHours);
  set('topMinutes', topMinutes);
  set('booksRead', report.booksRead);
  document.querySelectorAll('[data-story-cover]').forEach(image => {
    image.src = report.topBook.coverUrl;
    image.alt = `《${report.topBook.title}》书封`;
  });
  document.querySelectorAll('[data-topic]').forEach((topic, index) => topic.textContent = report.topics[index] || '阅读');
  const topicLine = document.querySelector('#storyTopics');
  topicLine.replaceChildren(...report.topics.slice(0, 3).flatMap((topic, index) => index ? [document.createElement('br'), document.createTextNode(topic)] : [document.createTextNode(topic)]));
  applyIdentity(identity);
  document.querySelector('#identityOptions').hidden = true;
  identityNote.textContent = `本次发布署名：${identityLabel(identity.mode)}。`;
  const publicUrl = new URL(`/s/${slug}`, location.origin).href;
  document.querySelector('#storyQr').src = `/api/stories/${slug}/qr.png`;
  document.querySelector('#storyQr').alt = '阅读故事二维码';
  const storyLink = document.querySelector('#storyLink');
  storyLink.replaceChildren(
    document.createTextNode(`专属地址 · ${publicUrl}`),
    document.createElement('br'),
    Object.assign(document.createElement('small'), { textContent: '链接可在微信中直接打开和转发。' })
  );
  document.title = `${report.year} 阅读故事`;
}

function applyIdentity(identity) {
  const mark = document.querySelector('#readerMark');
  const name = document.querySelector('#readerName');
  const avatar = document.querySelector('#readerAvatar');
  if (identity.mode === 'anonymous' || !identity.nickname) return;
  name.textContent = `${identity.nickname} 的阅读视界`;
  mark.hidden = false;
  if (identity.mode === 'name_avatar' && identity.avatarUrl) {
    avatar.src = identity.avatarUrl;
    avatar.hidden = false;
  } else {
    avatar.hidden = true;
  }
}

function identityLabel(mode) {
  return ({ name_avatar: '昵称与头像', name: '仅昵称', anonymous: '匿名' })[mode] || '匿名';
}
