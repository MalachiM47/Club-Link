// Capture only original interface copy, never officer-authored content.
const copy = [];
const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
while (walker.nextNode()) {
  const node = walker.currentNode;
  if (!node.parentElement.closest('script,style,[data-brand-ignore]') && /club/i.test(node.textContent)) copy.push([node, node.textContent]);
}
const labels = [...document.querySelectorAll('[aria-label]')].filter(node=>!node.closest('[data-brand-ignore]')).map(node => [node, node.getAttribute('aria-label')]);
const originalTitle = document.title;
export function applyBranding(settings) {
  const name = String(settings?.club_name || 'Club Link').trim() || 'Club Link';
  const scheme = ['forest','plum','sunset'].includes(settings?.color_scheme) ? settings.color_scheme : 'default';
  const replace = text => name === 'Club Link' ? text : text.replace(/Club Link|the club|\bclub\b/gi, match => match.toLowerCase() === 'club link' ? match : name);
  for (const [node, text] of copy) if (node.isConnected) node.textContent = replace(text);
  for (const [node, text] of labels) if (/club/i.test(text)) node.setAttribute('aria-label', replace(text));
  document.title = settings ? `${name} | Club Link` : originalTitle;
  document.documentElement.dataset.colorScheme = scheme;
  for (const mark of document.querySelectorAll('.brand-mark')) mark.textContent = 'CL';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = {default:'#102a43',forest:'#173e31',plum:'#3d2352',sunset:'#512c22'}[scheme];
}
