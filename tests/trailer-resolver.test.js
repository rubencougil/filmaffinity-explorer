const assert = require('node:assert/strict');
const https = require('node:https');
const { EventEmitter } = require('node:events');
const { test } = require('node:test');
const { buildTrailerQuery, extractYoutubeVideoId, resolveYoutubeTrailer } = require('../trailer-resolver');

test('trailer queries and IDs retain the existing playback contract', () => {
  assert.equal(buildTrailerQuery('Movie', '2026'), 'Movie 2026 trailer');
  assert.equal(extractYoutubeVideoId('"videoId":"abcdefghijk","videoId":"12345678901"'), 'abcdefghijk');
  assert.equal(extractYoutubeVideoId('no video results'), '');
});

function mockSearch(t, { statusCode = 200, body = '', timeout = false, respond } = {}) {
  t.mock.method(https, 'get', (url, options, callback) => {
    const request = new EventEmitter();
    request.destroy = (error) => request.emit('error', error);
    request.setTimeout = (milliseconds, onTimeout) => {
      assert.equal(milliseconds, 15_000);
      if (timeout) process.nextTick(onTimeout);
    };
    if (!timeout) {
      process.nextTick(() => {
        const response = new EventEmitter();
        const result = respond ? respond(url, options) : { statusCode, body };
        response.headers = result.headers || {};
        response.statusCode = result.statusCode;
        response.resume = () => {};
        callback(response);
        response.emit('data', Buffer.from(result.body || ''));
        response.emit('end');
      });
    }
    return request;
  });
}

test('trailer lookup returns a privacy-enhanced YouTube embed', async (t) => {
  mockSearch(t, { body: '"videoId":"abcdefghijk"' });
  const trailer = await resolveYoutubeTrailer({ title: 'Movie', year: '2026' });
  assert.equal(trailer.videoId, 'abcdefghijk');
  assert.equal(trailer.embedUrl, 'https://www.youtube-nocookie.com/embed/abcdefghijk?autoplay=1&rel=0');
});

test('an unsuccessful trailer search surfaces its HTTP status', async (t) => {
  mockSearch(t, { statusCode: 503 });
  await assert.rejects(resolveYoutubeTrailer({ title: 'Movie' }), /HTTP 503/);
});

test('trailer lookup times out instead of holding a sync indefinitely', async (t) => {
  mockSearch(t, { timeout: true });
  await assert.rejects(resolveYoutubeTrailer({ title: 'Movie' }), /timed out/);
});

test('oversized trailer responses are rejected', async (t) => {
  mockSearch(t, { body: 'x'.repeat(10_000_001) });
  await assert.rejects(resolveYoutubeTrailer({ title: 'Movie' }), /exceeds 10 MB/);
});

test('YouTube searches reject optional cookies instead of looping through consent', async (t) => {
  mockSearch(t, {
    respond(_url, options) {
      return options.headers.Cookie === 'SOCS=CAI'
        ? { statusCode: 200, body: '"videoId":"abcdefghijk"' }
        : { statusCode: 302, headers: { location: '/results?consent=required' } };
    }
  });

  const trailer = await resolveYoutubeTrailer({ title: 'Movie' });
  assert.equal(trailer.videoId, 'abcdefghijk');
});

test('relative redirects are followed and cookies are not sent to other domains', async (t) => {
  const visited = [];
  mockSearch(t, {
    respond(url, options) {
      visited.push(url);
      if (visited.length === 1) {
        return { statusCode: 302, headers: { location: '/redirected' } };
      }
      if (visited.length === 2) {
        return { statusCode: 302, headers: { location: 'https://example.com/search' } };
      }
      assert.equal(options.headers.Cookie, undefined);
      return { statusCode: 200, body: '"videoId":"abcdefghijk"' };
    }
  });

  const trailer = await resolveYoutubeTrailer({ title: 'Movie' });
  assert.equal(trailer.videoId, 'abcdefghijk');
  assert.equal(visited[1], 'https://www.youtube.com/redirected');
  assert.equal(visited.length, 3);
});

test('redirect loops report the limit instead of a generic HTTP 302 error', async (t) => {
  let requests = 0;
  mockSearch(t, {
    respond() {
      requests += 1;
      return { statusCode: 302, headers: { location: '/loop' } };
    }
  });

  await assert.rejects(resolveYoutubeTrailer({ title: 'Movie' }), /exceeded redirect limit \(HTTP 302\)/);
  assert.equal(requests, 5);
});
