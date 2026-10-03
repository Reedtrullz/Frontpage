const upstream = { async fetch(request) {
  return Response.json({ path: new URL(request.url).pathname, query: new URL(request.url).search, method: request.method, body: await request.text(), token: request.headers.get('X-Frontpage-Origin-Token') });
} };

export default upstream;
