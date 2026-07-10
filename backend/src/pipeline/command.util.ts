import { spawn } from 'child_process';
import { ProjectLogger } from '../common/logger/pipeline-logger.service';

export interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Kill the process after this many ms (0 = no timeout). */
  timeoutMs?: number;
}

export class CommandError extends Error {
  constructor(
    message: string,
    readonly code: number | null,
    readonly stderrTail: string,
  ) {
    super(message);
    this.name = 'CommandError';
  }
}

/**
 * Spawns an external process (the Python stitcher), streams
 * its output to the project log, and resolves on exit code 0. Rejects with a
 * {@link CommandError} otherwise — including on timeout — so the pipeline can
 * mark the failing step and surface a meaningful message.
 */
export function runCommand(
  command: string,
  args: string[],
  logger: ProjectLogger,
  options: RunOptions = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    logger.info(`$ ${command} ${args.join(' ')}`, { cwd: options.cwd });
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      shell: false,
    });

    let stderrTail = '';
    let fullOutput = '';
    const appendTail = (chunk: string) => {
      stderrTail = (stderrTail + chunk).slice(-4000);
    };

    let timer: NodeJS.Timeout | undefined;
    if (options.timeoutMs && options.timeoutMs > 0) {
      timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(
          new CommandError(
            `Command timed out after ${options.timeoutMs}ms: ${command}`,
            null,
            stderrTail,
          ),
        );
      }, options.timeoutMs);
    }

    child.stdout.on('data', (d: Buffer) => {
      const s = d.toString();
      fullOutput += s;
      logger.raw(`${command}:stdout`, s);
    });
    child.stderr.on('data', (d: Buffer) => {
      const s = d.toString();
      fullOutput += s;
      appendTail(s);
      logger.raw(`${command}:stderr`, s);
    });

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(
        new CommandError(
          `Failed to start "${command}": ${err.message}. Is it installed and on PATH?`,
          null,
          stderrTail,
        ),
      );
    });

    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (code === 0) {
        resolve(fullOutput);
      } else {
        reject(
          new CommandError(
            `Command "${command}" exited with code ${code}`,
            code,
            stderrTail,
          ),
        );
      }
    });
  });
}
