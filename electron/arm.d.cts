/**
 * Types for `arm.cjs`, so its validation can be unit-tested from TypeScript.
 *
 * The implementation is CommonJS because Electron's main process loads it
 * directly, and it stays outside the app's TypeScript project — which is
 * browser-targeted and has no Node types on purpose. This declaration is the
 * seam: the test gets a checked view of the module without `src` gaining
 * `process` and `Buffer`.
 */

export interface ArmTarget {
  host: string;
  port: number;
}

export type ArmAxisName = 'X' | 'Y' | 'Z' | 'B' | 'E';

export declare const AXES: Record<ArmAxisName, { min: number; max: number }>;
export declare const DEFAULT_ADDRESS: string;

export declare function getAddress(): string;
export declare function setAddress(input: unknown): void;
/** Throws unless `input` is an IPv4 literal on a private/loopback/link-local range. */
export declare function parseAddress(input: unknown): ArmTarget;
/** Throws unless the value is in range; returns the firmware's decimal form. */
export declare function formatAngle(axis: string, value: number): string;
/** Throws unless the name is one of the five axes; returns it upper-cased. */
export declare function axisName(axis: unknown): ArmAxisName;

export declare function health(): Promise<{ runtime: string }>;
export declare function readAngles(): Promise<Record<string, number>>;
export declare function readWifi(): Promise<{
  station: string;
  address?: string;
  selected?: string;
}>;
export declare function setAngles(
  moves: readonly { axis: string; value: number }[],
): Promise<Record<string, number>>;
export declare function home(): Promise<Record<string, number>>;
