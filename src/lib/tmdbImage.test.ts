import { describe, expect, it } from 'vitest';
import { tmdbPoster, tmdbBackdrop, tmdbPosterFluid } from './tmdbImage';

const POSTER = 'https://image.tmdb.org/t/p/w500/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg';
const BACKDROP = 'https://image.tmdb.org/t/p/original/hZkgoQYus5vegHoetLkCJzb17zJ.jpg';

describe('tmdbPoster', () => {
  it('picks the smallest bucket that covers the box, not the stored size', () => {
    // The calendar row is 36px wide; w500 (the stored size) would be ~10x
    // more pixels than the box ever shows.
    expect(tmdbPoster(POSTER, 36)?.src).toBe(
      'https://image.tmdb.org/t/p/w92/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg',
    );
  });

  it('emits a 2x srcSet at double the requested width', () => {
    const result = tmdbPoster(POSTER, 48);
    expect(result?.src).toBe('https://image.tmdb.org/t/p/w92/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg');
    expect(result?.srcSet).toBe(
      'https://image.tmdb.org/t/p/w92/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg 1x, https://image.tmdb.org/t/p/w154/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg 2x',
    );
  });

  it('omits srcSet when 1x and 2x land on the same bucket', () => {
    // At the top of the scale, both the 1x and 2x targets exceed every real
    // bucket and clamp to the same w780 fallback — no point in a 2-entry
    // srcSet that names the same URL twice.
    const result = tmdbPoster(POSTER, 780);
    expect(result?.srcSet).toBeUndefined();
    expect(result?.src).toBe('https://image.tmdb.org/t/p/w780/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg');
  });

  it('clamps to the largest bucket for an oversized request rather than erroring', () => {
    expect(tmdbPoster(POSTER, 5000)?.src).toBe(
      'https://image.tmdb.org/t/p/w780/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg',
    );
  });

  it('passes through null/undefined so callers can render their existing fallback', () => {
    expect(tmdbPoster(null, 48)).toBeUndefined();
    expect(tmdbPoster(undefined, 48)).toBeUndefined();
  });

  it('hands back a non-TMDB URL untouched rather than mangling it', () => {
    const other = 'https://example.com/poster.jpg';
    expect(tmdbPoster(other, 48)).toEqual({ src: other });
  });

  it('rewrites an "original" URL, not just already-sized ones', () => {
    expect(tmdbPoster(BACKDROP.replace('/hZ', '/pB').replace(/\.jpg$/, '.jpg'), 48)?.src).toContain(
      '/t/p/w92/',
    );
  });
});

describe('tmdbBackdrop', () => {
  it('uses the backdrop bucket set, not the poster set', () => {
    // 700 CSS px: smallest backdrop bucket >=700 is 780, not poster's 780-vs-500 line.
    expect(tmdbBackdrop(BACKDROP, 700)?.src).toBe(
      'https://image.tmdb.org/t/p/w780/hZkgoQYus5vegHoetLkCJzb17zJ.jpg',
    );
  });

  it('escalates to the 1280 bucket only once 2x genuinely needs it', () => {
    const result = tmdbBackdrop(BACKDROP, 700);
    expect(result?.srcSet).toBe(
      'https://image.tmdb.org/t/p/w780/hZkgoQYus5vegHoetLkCJzb17zJ.jpg 1x, https://image.tmdb.org/t/p/w1280/hZkgoQYus5vegHoetLkCJzb17zJ.jpg 2x',
    );
  });
});

describe('tmdbPosterFluid', () => {
  it('produces a w-descriptor srcSet for the browser to pick from, not x-descriptors', () => {
    const result = tmdbPosterFluid(POSTER);
    expect(result?.srcSet).toMatch(/\d+w(, |$)/);
    expect(result?.srcSet).not.toMatch(/\dx/);
  });

  it('de-duplicates candidate widths that land on the same TMDB bucket', () => {
    // 154 and 185 both map to bucket 185 in the default candidates — should
    // appear once, not twice.
    const result = tmdbPosterFluid(POSTER, [154, 185]);
    const matches = result?.srcSet?.match(/w185/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it('passes through null the same as the fixed-width variant', () => {
    expect(tmdbPosterFluid(null)).toBeUndefined();
  });
});
