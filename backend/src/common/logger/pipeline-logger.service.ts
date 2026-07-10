import { Injectable, LoggerService } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Writes structured, append-only logs for a single project's pipeline run to
 * `<outputPath>/<projectId>/logs/pipeline.log`. Each processing step records
 * its start time, end time, duration, status and any errors — as required by
 * the logging spec.
 *
 * Instances are created per project via {@link PipelineLoggerFactory}.
 */
export class ProjectLogger {
  private readonly logFile: string;

  constructor(
    private readonly projectId: string,
    logsDir: string,
  ) {
    fs.mkdirSync(logsDir, { recursive: true });
    this.logFile = path.join(logsDir, 'pipeline.log');
  }

  private write(level: string, message: string, meta?: Record<string, unknown>): void {
    const entry = {
      ts: new Date().toISOString(),
      projectId: this.projectId,
      level,
      message,
      ...(meta ?? {}),
    };
    const line = JSON.stringify(entry) + '\n';
    // Synchronous append keeps ordering guarantees during sequential steps.
    fs.appendFileSync(this.logFile, line, { encoding: 'utf8' });
    // Mirror to stdout for docker log aggregation.
    // eslint-disable-next-line no-console
    console.log(`[${entry.level}] [${this.projectId}] ${message}`);
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.write('info', message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.write('warn', message, meta);
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.write('error', message, meta);
  }

  /** Convenience for command output captured from FFmpeg/COLMAP/OpenMVS. */
  raw(source: string, chunk: string): void {
    // Keep raw tool output on its own lines for readability.
    fs.appendFileSync(this.logFile, `--- ${source} ---\n${chunk}\n`, { encoding: 'utf8' });
  }

  get filePath(): string {
    return this.logFile;
  }
}

@Injectable()
export class PipelineLoggerFactory {
  create(projectId: string, logsDir: string): ProjectLogger {
    return new ProjectLogger(projectId, logsDir);
  }
}

/**
 * Minimal app-wide logger that also prefixes context. Nest's default logger is
 * fine, but we expose this for consistency and future transport swapping.
 */
@Injectable()
export class AppLogger implements LoggerService {
  log(message: unknown, context?: string) {
    // eslint-disable-next-line no-console
    console.log(this.fmt('LOG', message, context));
  }
  error(message: unknown, trace?: string, context?: string) {
    // eslint-disable-next-line no-console
    console.error(this.fmt('ERROR', message, context), trace ?? '');
  }
  warn(message: unknown, context?: string) {
    // eslint-disable-next-line no-console
    console.warn(this.fmt('WARN', message, context));
  }
  debug(message: unknown, context?: string) {
    // eslint-disable-next-line no-console
    console.debug(this.fmt('DEBUG', message, context));
  }
  verbose(message: unknown, context?: string) {
    // eslint-disable-next-line no-console
    console.log(this.fmt('VERBOSE', message, context));
  }

  private fmt(level: string, message: unknown, context?: string): string {
    return `${new Date().toISOString()} [${level}]${context ? ` [${context}]` : ''} ${String(
      message,
    )}`;
  }
}
