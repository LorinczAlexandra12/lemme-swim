/**
 * Vállalati proxy mögött a Node `fetch`-e nem talál ki az internetre.
 *
 * A `curl` és a böngésző figyelembe veszi a `HTTPS_PROXY` környezeti változót,
 * a Node 20 beépített `fetch`-e (undici) viszont nem — és közvetlen DNS sincs,
 * így minden szerveroldali kérés `fetch failed`-del hal el. Ez üti ki a
 * címkeresőt (`/api/geocode`) és a `next/font` Google Fonts letöltését is.
 *
 * Ezt a fájlt a `npm run dev` tölti be a `NODE_OPTIONS=--require` kapcsolóval,
 * ami a Next munkafolyamataira is öröklődik — ott futnak a route handlerek.
 *
 * Proxy nélküli gépen (és éles környezetben) nem csinál semmit.
 */

const proxy =
  process.env.HTTPS_PROXY ||
  process.env.https_proxy ||
  process.env.HTTP_PROXY ||
  process.env.http_proxy;

if (proxy) {
  try {
    const { setGlobalDispatcher, ProxyAgent } = require('undici');
    setGlobalDispatcher(new ProxyAgent(proxy));
  } catch (error) {
    // Nem végzetes: a proxy nélküli hálózaton a fetch amúgy is működik.
    console.warn(`[proxy-boot] a proxy beállítása nem sikerült: ${error.message}`);
  }
}
