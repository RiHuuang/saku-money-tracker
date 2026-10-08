export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname === 'www.sakumoney.my.id') {
      url.hostname = 'sakumoney.my.id';
      return Response.redirect(url.toString(), 308);
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    }
    return env.ASSETS.fetch(request);
  },
};
