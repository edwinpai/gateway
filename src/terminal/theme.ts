import chalk, { Chalk } from "chalk";
import { EDWINPAI_PALETTE } from "./palette.js";

const hasForceColor =
  typeof process.env.FORCE_COLOR === "string" &&
  process.env.FORCE_COLOR.trim().length > 0 &&
  process.env.FORCE_COLOR.trim() !== "0";

const baseChalk = process.env.NO_COLOR && !hasForceColor ? new Chalk({ level: 0 }) : chalk;

const hex = (value: string) => baseChalk.hex(value);

export const theme = {
  accent: hex(EDWINPAI_PALETTE.accent),
  accentBright: hex(EDWINPAI_PALETTE.accentBright),
  accentDim: hex(EDWINPAI_PALETTE.accentDim),
  info: hex(EDWINPAI_PALETTE.info),
  success: hex(EDWINPAI_PALETTE.success),
  warn: hex(EDWINPAI_PALETTE.warn),
  error: hex(EDWINPAI_PALETTE.error),
  muted: hex(EDWINPAI_PALETTE.muted),
  heading: baseChalk.bold.hex(EDWINPAI_PALETTE.accent),
  command: hex(EDWINPAI_PALETTE.accentBright),
  option: hex(EDWINPAI_PALETTE.warn),
} as const;

export const isRich = () => Boolean(baseChalk.level > 0);

export const colorize = (rich: boolean, color: (value: string) => string, value: string) =>
  rich ? color(value) : value;
