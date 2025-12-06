export const LOG_LEVELS = [
  'verbose',
  'debug',
  'log',
  'warn',
  'error',
  'fatal',
] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

export abstract class ILogger {
  /**
   * Write a 'log' level log.
   */
  abstract log(message: any, ...optionalParams: any[]): any;
  /**
   * Write an 'error' level log.
   */
  abstract error(message: any, ...optionalParams: any[]): any;
  /**
   * Write a 'warn' level log.
   */
  abstract warn(message: any, ...optionalParams: any[]): any;
  /**
   * Write a 'debug' level log.
   */
  abstract debug?(message: any, ...optionalParams: any[]): any;
  /**
   * Write a 'verbose' level log.
   */
  abstract verbose?(message: any, ...optionalParams: any[]): any;
  /**
   * Write a 'fatal' level log.
   */
  abstract fatal?(message: any, ...optionalParams: any[]): any;
  /**
   * Set log levels.
   * @param levels log levels
   */
  abstract setLogLevels?(levels: LogLevel[]): any;
}
