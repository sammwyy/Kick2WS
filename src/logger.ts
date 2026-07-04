import { config } from './config.js';

/** Verbose debug logging, gated by LOGS_ENABLED=1. */
export function debug(scope: string, ...args: unknown[]): void {
  if (!config.logsEnabled) return;
  console.log(`[${new Date().toISOString()}] [${scope}]`, ...args);
}

/** Warnings and errors are always logged. */
export function warn(scope: string, ...args: unknown[]): void {
  console.warn(`[${scope}]`, ...args);
}

export function error(scope: string, ...args: unknown[]): void {
  console.error(`[${scope}]`, ...args);
}
