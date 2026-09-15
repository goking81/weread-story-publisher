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
const storySlug = location.pathname.match(/^\/s\/([A-Za-z0-9_-]{12,})$/)?.[1];
let loadSequence = 0;
if (storySlug) loadPublishedStory(storySlug);
else showUnavailable('请使用完整的阅读故事链接。');
addEventListener('hashchange', () => { if (storySlug) loadPublishedStory(storySlug); });

async function loadPublishedStory(slug) {
  const sequence = ++loadSequence;
  showUnavailable('正在打开您的阅读故事…');
  shareSheet.close();
  try {
    const key = location.hash.slice(1);
    if (!key) throw new Error('这份阅读故事需要完整的加密分享链接。');
    const response = await fetch(`/api/stories/${slug}`, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error('这份阅读故事已失效或不存在。');
    const { envelope, expiresAt } = await response.json();
    const story = await decryptStory(envelope, key);
    if (sequence === loadSequence) renderStory(story, expiresAt);
  } catch (error) {
    if (sequence === loadSequence) showUnavailable(error.message || '这份阅读故事无法打开。');
  }
}

async function decryptStory(envelope, key) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(key)) throw new Error('这份阅读故事的加密密钥无效。');
  const rawKey = base64UrlToBytes(key);
  if (rawKey.length !== 32) throw new Error('这份阅读故事的加密密钥无效。');
  const cryptoKey = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['decrypt']);
  let plaintext;
  try { plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64UrlToBytes(envelope.iv) }, cryptoKey, base64UrlToBytes(envelope.ciphertext)); }
  catch { throw new Error('故事解密失败，请确认使用了完整且正确的分享链接。'); }
  return JSON.parse(new TextDecoder().decode(plaintext));
}

function renderStory(story, expiresAt) {
  // 旧加密报告按自身数据转换，页面中不再保留任何原型数据。
  if (!Array.isArray(story?.narrative?.pages)) {
    const { report } = story;
    const duration = value => `${Math.floor(value / 60)}小时${value % 60}分`;
    story.narrative = { version: 1, pages: [
      { type: 'opening', label: '年度阅读', title: `${report.year}，您留给阅读`, metric: duration(report.totalMinutes) },
      { type: 'book', label: '投入最多的一本书', title: report.topBook.title, coverUrl: report.topBook.coverUrl, metric: duration(report.topBook.minutes) },
      { type: 'closing', label: 'MY READING STORY', title: `${report.year}，阅读留下了一条自己的路径。`,
        metric: duration(report.totalMinutes), body: (report.topics || []).join(' · '), coverUrl: report.topBook.coverUrl }
    ] };
  }
  if (!story.narrative.pages.length || story.narrative.pages.length > 20) throw new Error('故事页面数据无效。');
  renderDynamicStory(story, expiresAt);
}

function renderDynamicStory(story, expiresAt) {
  const report = document.querySelector('.report');
  const main = document.createElement('main');
  main.className = 'report dynamic-report';
  main.setAttribute('aria-label', `${story.report.year} 阅读故事`);
  story.narrative.pages.forEach((page, index) => main.append(renderDynamicPage(page, index, story.narrative.pages.length, story.identity)));
  report.replaceWith(main);
  activatePages();
  const expiry = new Date(expiresAt).toLocaleString('zh-CN', { hour12: false });
  identityNote.textContent = `本次发布署名：${identityLabel(story.identity.mode)}。有效期至 ${expiry}。`;
  renderShareCode(expiry);
  document.title = story.share?.title || `${story.report.year} 阅读故事`;
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
    launch.textContent = '查看分享二维码';
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
  const shareUrl = new URL(location.href);
  shareUrl.search = '';
  code.addData(shareUrl.href, 'Byte');
  code.make();
  qr.src = code.createDataURL(4, 16);
  qr.alt = '阅读故事二维码';
  qr.hidden = false;
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
    className: 'report story-unavailable', textContent: message
  }));
  document.title = '阅读故事不可用';
}
