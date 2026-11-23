import {describe, expect, it} from 'vitest';
import {npmInvocation, remotionPropsArgument, waitForLoopbackHttpReady} from '../src/main/tasks';

describe('Windows npm invocation', () => {
  it('bypasses cmd.exe and keeps each argument separate', () => {
    const command = npmInvocation('C:\\Meapp\\node\\npm.cmd', ['run', 'start', '--', '--no-open']);
    expect(command).toEqual({
      file: 'C:\\Meapp\\node\\node.exe',
      args: [
        'C:\\Meapp\\node\\node_modules\\npm\\bin\\npm-cli.js',
        'run',
        'start',
        '--',
        '--no-open',
      ],
    });
    expect(command.args.join(' ')).not.toContain('\\"');
  });
});

describe('Studio HTTP readiness', () => {
  it('retries connection failures until the loopback server responds', async () => {
    let attempts = 0;
    const fetcher = (async () => {
      attempts += 1;
      if (attempts < 3) throw new TypeError('fetch failed');
      return new Response('', {status: 200});
    }) as typeof fetch;

    await waitForLoopbackHttpReady('http://localhost:3000/', {
      timeoutMs: 500,
      intervalMs: 1,
      requestTimeoutMs: 50,
      fetcher,
    });

    expect(attempts).toBe(3);
  });

  it('refuses non-loopback addresses', async () => {
    await expect(waitForLoopbackHttpReady('https://example.com')).rejects.toThrow('非本机');
  });
});

describe('Remotion input props', () => {
  it('passes a Unicode project JSON as one CLI argument', () => {
    expect(remotionPropsArgument('F:\\工程', '参数/默认设置.json')).toBe('--props=参数/默认设置.json');
  });

  it('refuses a settings file outside the project', () => {
    expect(() => remotionPropsArgument('F:\\工程', '../outside.json')).toThrow('超出工程目录');
  });
});
