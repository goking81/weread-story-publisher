import qrcode from '/qrcode.mjs';

const capture = Number(new URLSearchParams(location.search).get('slide'));
let pageObserver;
activatePages();

function activatePages() {
  const pages = [...document.querySelectorAll('.page')];
  pageObserver?.disconnect();
  if (capture >= 1 && capture <= pages.length) {
    document.querySelector('.report').classList.add('capture');
    pages.forEach((page, index) => page.style.display = index === capture - 1 ? 'flex' : 'none');
    pages[capture - 1].classList.add('seen');
    return;
  }
  pageObserver = new IntersectionObserver(entries => entries.forEach(entry => entry.isIntersecting && entry.target.classList.add('seen')), { threshold: .45 });
  pages.forEach(page => pageObserver.observe(page));
}

const shareSheet = document.querySelector('#shareSheet');
document.addEventListener('click', event => {
  if (event.target.closest('#shareLaunch')) shareSheet?.showModal();
});

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
    const key = location.hash.slice(1);
    if (!key) throw new Error('这份阅读故事需要完整的加密分享链接。');
    const response = await fetch(`/api/stories/${slug}`);
    if (!response.ok) throw new Error('这份阅读故事已失效或不存在。');
    const { envelope, expiresAt } = await response.json();
    renderStory(await decryptStory(envelope, key), expiresAt);
  } catch (error) {
    showUnavailable(error.message || '这份阅读故事无法打开。');
  }
}

async function decryptStory(envelope, key) {
  const rawKey = base64UrlToBytes(key);
  if (rawKey.length !== 32) throw new Error('这份阅读故事的加密密钥无效。');
  const cryptoKey = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['decrypt']);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64UrlToBytes(envelope.iv) }, cryptoKey, base64UrlToBytes(envelope.ciphertext));
  return JSON.parse(new TextDecoder().decode(plaintext));
}

function renderStory(story, expiresAt) {
  if (Array.isArray(story?.narrative?.pages)) return renderDynamicStory(story, expiresAt);
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
  const expiry = new Date(expiresAt).toLocaleString('zh-CN', { hour12: false });
  identityNote.textContent = `本次发布署名：${identityLabel(identity.mode)}。有效期至 ${expiry}。`;
  renderShareCode(expiry);
  document.title = `${report.year} 阅读故事`;
}

function renderDynamicStory(story, expiresAt) {
  const report = document.querySelector('.report');
  const main = document.createElement('main');
  main.className = 'report dynamic-report';
  main.setAttribute('aria-label', `${story.report.year} 阅读故事`);
  story.narrative.pages.forEach((page, index) => main.append(renderDynamicPage(page, index, story.narrative.pages.length, story.identity)));
  report.replaceWith(main);
  activatePages();
  document.querySelector('#identityOptions').hidden = true;
  const expiry = new Date(expiresAt).toLocaleString('zh-CN', { hour12: false });
  identityNote.textContent = `本次发布署名：${identityLabel(story.identity.mode)}。有效期至 ${expiry}。`;
  renderShareCode(expiry);
  document.title = `${story.report.year} 阅读故事`;
}

function renderDynamicPage(page, index, total, identity) {
  const section = document.createElement('section');
  section.className = `page dynamic-page ${index % 2 ? 'night' : 'paper'} dynamic-${page.type}`;
  section.append(renderHeader(page.label, index, total));
  if (index === 0 && identity?.mode !== 'anonymous' && identity?.nickname) section.append(renderIdentity(identity));

  const body = document.createElement('div');
  body.className = 'dynamic-body';
  addText(body, 'p', 'dynamic-kicker', page.type === 'opening' ? 'MY READING STORY' : page.label);
  addText(body, 'h1', 'dynamic-title', page.title);
  if (page.coverUrl) body.append(renderCover(page.coverUrl, page.title));
  if (Array.isArray(page.books)) body.append(renderBookShelf(page.books));
  if (Array.isArray(page.topics)) body.append(renderTopics(page.topics));
  addText(body, 'strong', 'dynamic-metric', page.metric);
  addText(body, 'p', 'dynamic-copy', page.body);
  section.append(body);

  const footer = document.createElement('footer');
  addText(footer, 'p', '', page.type === 'closing' ? '由年度阅读记录生成' : `阅读故事 · ${String(index + 1).padStart(2, '0')}`);
  addText(footer, 'b', '', String(index + 1).padStart(2, '0'));
  section.append(footer);
  if (page.type === 'closing') {
    const launch = document.createElement('button');
    launch.id = 'shareLaunch';
    launch.className = 'share-launch';
    launch.type = 'button';
    launch.textContent = '生成分享链接';
    section.insertBefore(launch, footer);
  }
  return section;
}

function renderHeader(label, index, total) {
  const header = document.createElement('header');
  addText(header, 'span', 'label', label);
  const dots = document.createElement('span');
  dots.className = 'dots';
  for (let position = 0; position < total; position += 1) {
    const dot = document.createElement('i');
    if (position === index) dot.className = 'on';
    dots.append(dot);
  }
  header.append(dots);
  addText(header, 'span', 'page-no', `${String(index + 1).padStart(2, '0')}/${String(total).padStart(2, '0')}`);
  return header;
}

function renderIdentity(identity) {
  const mark = document.createElement('div');
  mark.className = 'reader-mark';
  if (identity.mode === 'name_avatar' && identity.avatarUrl) {
    const avatar = document.createElement('img');
    avatar.src = identity.avatarUrl;
    avatar.alt = '';
    mark.append(avatar);
  }
  addText(mark, 'span', '', `${identity.nickname} 的阅读视界`);
  return mark;
}

function renderCover(url, title) {
  const cover = document.createElement('div');
  cover.className = 'book dynamic-cover';
  const image = document.createElement('img');
  image.src = url;
  image.alt = `${title} 书封`;
  cover.append(image);
  return cover;
}

function renderBookShelf(books) {
  const shelf = document.createElement('div');
  shelf.className = 'dynamic-shelf';
  books.forEach(book => shelf.append(renderCover(book.coverUrl, book.title)));
  return shelf;
}

function renderTopics(topics) {
  const list = document.createElement('div');
  list.className = 'dynamic-topics';
  topics.forEach(topic => addText(list, 'span', '', topic));
  return list;
}

function addText(parent, tagName, className, value) {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  node.textContent = value || '';
  parent.append(node);
  return node;
}

function renderShareCode(expiry) {
  const qr = document.querySelector('#storyQr');
  const storyLink = document.querySelector('#storyLink');
  qr.hidden = true;
  storyLink.replaceChildren(
    document.createTextNode(`加密阅读故事 · ${expiry} 到期`),
    document.createElement('br'),
    Object.assign(document.createElement('small'), { textContent: '请在微信右上角转发给朋友。' })
  );
  const code = qrcode(0, 'M');
  code.addData(location.href, 'Byte');
  code.make();
  qr.src = code.createDataURL(4, 16);
  qr.alt = '阅读故事二维码';
  qr.hidden = false;
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

function base64UrlToBytes(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return Uint8Array.from(atob(padded), character => character.charCodeAt(0));
}

function showUnavailable(message) {
  document.querySelector('.report').replaceWith(Object.assign(document.createElement('main'), {
    className: 'story-unavailable', textContent: message
  }));
  document.title = '阅读故事不可用';
}
