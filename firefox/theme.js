export async function applyTheme() {
  const {theme = 'system'} = await browser.storage.local.get('theme');
  document.documentElement.dataset.theme = theme;
  return theme;
}
