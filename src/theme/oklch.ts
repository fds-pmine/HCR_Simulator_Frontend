/**
 * `oklch()` to sRGB, because three.js cannot read the palette.
 *
 * The stylesheet is the single source of truth for colour, and it is authored
 * in `oklch()`. `THREE.Color.setStyle` accepts hex, the X11 names, and
 * comma-separated `rgb()`/`hsl()` — it has no `oklch()` branch. Nor can the
 * browser be asked to do the conversion: an unregistered custom property
 * computes to its own token stream, so `getPropertyValue('--stage')` hands back
 * the literal text `oklch(0.945 0.012 198)`, and `color-mix(in srgb, …)`
 * serializes as `color(srgb …)`, which three cannot parse either.
 *
 * So the conversion lives here. It is the standard OKLab pipeline
 * (Björn Ottosson, 2020), which is what the browser runs too.
 */

/** Values outside sRGB are clamped, not scaled. */
export interface Rgb {
  /** `0xRRGGBB`, ready for `new THREE.Color(hex)`. */
  hex: number;
  /** 0–1. Separate because three carries opacity on the material, not the colour. */
  alpha: number;
}

const OKLCH = /^oklch\(\s*([\d.]+%?)\s+([\d.]+%?)\s+([\d.]+)(?:deg)?\s*(?:\/\s*([\d.]+%?)\s*)?\)$/i;

function ratio(token: string | undefined, fallback: number): number {
  if (token === undefined) return fallback;
  return token.endsWith('%') ? Number.parseFloat(token) / 100 : Number.parseFloat(token);
}

/** Linear-light channel to the sRGB transfer function. */
function encode(channel: number): number {
  const clamped = Math.min(1, Math.max(0, channel));
  return clamped <= 0.0031308
    ? clamped * 12.92
    : 1.055 * clamped ** (1 / 2.4) - 0.055;
}

/**
 * Parse `oklch(L C H)` or `oklch(L C H / A)`.
 *
 * Returns `null` for anything else, including an empty string — which is what
 * `getPropertyValue` returns under jsdom, where custom properties do not
 * resolve. Callers fall back to a baked table rather than rendering `NaN`.
 */
export function parseOklch(value: string): Rgb | null {
  const match = OKLCH.exec(value.trim());
  if (!match) return null;

  const lightness = ratio(match[1], 0);
  const chroma = ratio(match[2], 0);
  const hue = (Number.parseFloat(match[3]) * Math.PI) / 180;
  const alpha = ratio(match[4], 1);

  // OKLCH is OKLab in polar form.
  const a = chroma * Math.cos(hue);
  const b = chroma * Math.sin(hue);

  // OKLab to the cone responses, cubed back out of the perceptual space.
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;

  const red = encode(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
  const green = encode(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
  const blue = encode(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);

  const channel = (value_: number) => Math.round(value_ * 255);
  return {
    hex: (channel(red) << 16) | (channel(green) << 8) | channel(blue),
    alpha,
  };
}

/** `0xRRGGBB` as `#rrggbb`, for the APIs that want a string. */
export function toHex(value: number): string {
  return `#${value.toString(16).padStart(6, '0')}`;
}
