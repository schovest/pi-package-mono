import { describe, it, expect } from 'vitest';
import { formatOutput, formatCallLine } from '../src/renderUtils.ts';
import { ToolConfig } from '../src/config.ts';

describe('formatOutput', () => {
  it('should format output according to config in lines mode', () => {
    const input = "line1\n\nline2\n\nline3\nline4";
    const config: ToolConfig = { mode: 'lines', noPadding: true, outputLines: 2 };
    
    // Not expanded, limits to 2 lines and removes padding
    const res1 = formatOutput(input, config, false);
    expect(res1).toBe("line1\nline2");

    // Expanded, ignores outputLines but still applies padding removal
    // Actually, should it apply padding removal on expanded? The plan doesn't specify strictly,
    // but typically expanded means full output, though we might still want to trim empty lines.
    // Let's assume expanded = true returns all non-empty lines if noPadding is true.
    const res2 = formatOutput(input, config, true);
    expect(res2).toBe("line1\nline2\nline3\nline4");
  });

  it('should return empty array or string if no lines after padding removal', () => {
    const input = "\n\n";
    const config: ToolConfig = { mode: 'lines', noPadding: true, outputLines: 2 };
    const res = formatOutput(input, config, false);
    expect(res).toBe("");
  });

  it('should respect outputLines without noPadding', () => {
    const input = "line1\n\nline2\n\nline3\nline4";
    const config: ToolConfig = { mode: 'lines', outputLines: 3 };
    const res = formatOutput(input, config, false);
    expect(res).toBe("line1\n\nline2");
  });
  
  it('should return empty string when outputLines is 0', () => {
    const input = "line1\nline2\nline3";
    const config: ToolConfig = { mode: 'lines', outputLines: 0 };
    const res = formatOutput(input, config, false);
    expect(res).toBe("");
  });

  it('should handle noPadding with outputLines 0 - return empty', () => {
    const input = "\n\nline1\n\nline2\n\n";
    const config: ToolConfig = { mode: 'lines', noPadding: true, outputLines: 0 };
    const res = formatOutput(input, config, false);
    expect(res).toBe("");
  });

  it('should remove only leading/trailing/consecutive empty lines with noPadding', () => {
    const input = "\n\nline1\n\n\nline2\n\n";
    const config: ToolConfig = { mode: 'lines', noPadding: true, outputLines: 10 };
    const res = formatOutput(input, config, false);
    expect(res).toBe("line1\nline2");
  });

  it('should return input as-is for default mode', () => {
    const input = "line1\n\nline2";
    const config: ToolConfig = { mode: 'default' };
    const res = formatOutput(input, config, false);
    expect(res).toBe("line1\n\nline2");
  });

  it('should apply noPadding in default mode when configured', () => {
    const input = "\n\nline1\n\n\nline2\n\n";
    const config: ToolConfig = { mode: 'default', noPadding: true };
    const res = formatOutput(input, config, false);
    expect(res).toBe("line1\nline2");
  });

  it('should apply outputLines in default mode when configured', () => {
    const input = "line1\nline2\nline3\nline4";
    const config: ToolConfig = { mode: 'default', outputLines: 2 };
    const res = formatOutput(input, config, false);
    expect(res).toBe("line1\nline2");
  });

  it('should apply outputLines with noPadding together in default mode', () => {
    const input = "\n\nline1\n\nline2\n\nline3";
    const config: ToolConfig = { mode: 'default', noPadding: true, outputLines: 1 };
    const res = formatOutput(input, config, false);
    expect(res).toBe("line1");
  });
});

describe('formatCallLine', () => {
  it('should format bash command with $ prefix', () => {
    expect(formatCallLine('bash', { command: 'ls -la' })).toBe('$ ls -la');
  });

  it('should not truncate long bash command (full command is displayed)', () => {
    const cmd = 'x'.repeat(100);
    expect(formatCallLine('bash', { command: cmd })).toBe('$ ' + cmd);
  });

  it('should strip ANSI and OSC escape sequences from the call line', () => {
    const maliciousCmd = 'echo \x1b]0;EVIL\x07hello \x1b[31mworld\x1b[0m';
    expect(formatCallLine('bash', { command: maliciousCmd })).toBe('$ echo hello world');
  });

  it('should handle bash without command', () => {
    expect(formatCallLine('bash', {})).toBe('$ ');
  });

  it('should format write with path and line count', () => {
    expect(formatCallLine('write', { path: '/tmp/foo.txt', content: 'a\nb\nc' })).toBe('write /tmp/foo.txt (3 lines)');
  });

  it('should format write without content', () => {
    expect(formatCallLine('write', { path: '/tmp/foo.txt' })).toBe('write /tmp/foo.txt');
  });

  it('should format edit with path', () => {
    expect(formatCallLine('edit', { path: '/tmp/foo.txt' })).toBe('edit /tmp/foo.txt');
  });

  it('should format read with path and optional line ranges', () => {
    expect(formatCallLine('read', { path: '/tmp/foo.txt' })).toBe('read /tmp/foo.txt');
    expect(formatCallLine('read', { path: '/tmp/foo.txt', offset: 10, limit: 50 })).toBe('read /tmp/foo.txt:10-59');
    expect(formatCallLine('read', { path: '/tmp/foo.txt', offset: 10 })).toBe('read /tmp/foo.txt:10');
    expect(formatCallLine('read', { path: '/tmp/foo.txt', limit: 20 })).toBe('read /tmp/foo.txt:1-20');
    expect(formatCallLine('read', { file_path: '/tmp/bar.txt' })).toBe('read /tmp/bar.txt');
    expect(formatCallLine('read', {})).toBe('read ...');
  });

  it('should format ls with path and optional limit', () => {
    expect(formatCallLine('ls', { path: 'src', limit: 50 })).toBe('ls src (limit 50)');
    expect(formatCallLine('ls', {})).toBe('ls .');
  });

  it('should format find with pattern, path, and optional limit', () => {
    expect(formatCallLine('find', { pattern: '**/*.ts', path: 'src' })).toBe('find **/*.ts in src');
    expect(formatCallLine('find', { pattern: '**/*.ts', limit: 10 })).toBe('find **/*.ts in . (limit 10)');
    expect(formatCallLine('find', {})).toBe('find  in .');
  });

  it('should format grep with pattern, path, optional glob, and limit', () => {
    expect(formatCallLine('grep', { pattern: 'TODO', path: 'src', glob: '*.ts' })).toBe('grep /TODO/ in src (*.ts)');
    expect(formatCallLine('grep', { pattern: 'TODO', limit: 5 })).toBe('grep /TODO/ in . (limit 5)');
    expect(formatCallLine('grep', {})).toBe('grep // in .');
  });

  it('should format mcp call with raw arguments preserved', () => {
    const res = formatCallLine('mcp', {
      tool: 'read',
      args: JSON.stringify({ path: '/etc/hostname' }),
    });
    expect(res).toBe('mcp:read { tool: read, args: {"path":"/etc/hostname"} }');
  });

  it('should truncate long values in arguments to 30 chars', () => {
    const long = 'y'.repeat(40);
    const res = formatCallLine('mcp', {
      tool: 'write',
      args: long,
    });
    expect(res).toContain('mcp:write');
    expect(res).toContain('args: ' + 'y'.repeat(27) + '...');
  });

  it('should handle mcp with action only', () => {
    expect(formatCallLine('mcp', { action: 'list' })).toBe('mcp:list { action: list }');
  });

  it('should handle mcp with invalid JSON args gracefully', () => {
    const res = formatCallLine('mcp', { tool: 'status', args: '{not valid json' });
    expect(res).toBe('mcp:status { tool: status, args: {not valid json }');
  });

  it('should format extension tools with arguments preview', () => {
    expect(formatCallLine('worktree_create', { branch: 'fix/x' })).toBe('worktree_create { branch: fix/x }');
    expect(formatCallLine('search', { query: 'foo' })).toBe('search { query: foo }');
    expect(formatCallLine('custom', {})).toBe('custom');
  });

  it('should handle null/undefined and primitive args', () => {
    expect(formatCallLine('bash', null)).toBe('$ ');
    expect(formatCallLine('mcp', undefined)).toBe('mcp');
    expect(formatCallLine('mcp', 'not-an-object')).toBe('mcp');
  });
});

describe('formatOutput — 展開時上限なし (Q4)', () => {
  it('should return the full output when expanded (no hardcoded cap)', () => {
    const input = Array.from({ length: 1200 }, (_, i) => `line${i}`).join('\n');
    const config: ToolConfig = { mode: 'lines' };
    const res = formatOutput(input, config, true);
    expect(res.split('\n').length).toBe(1200);
  });

  it('should still honor outputLines when NOT expanded', () => {
    const input = Array.from({ length: 50 }, (_, i) => `line${i}`).join('\n');
    const config: ToolConfig = { mode: 'lines', outputLines: 3 };
    expect(formatOutput(input, config, false).split('\n').length).toBe(3);
  });
});

describe('formatOutput — ツール出力のサニタイズ (S1)', () => {
  it('should strip ANSI color sequences from tool output', () => {
    const input = '\x1b[31mred\x1b[0m\nplain';
    const config: ToolConfig = { mode: 'lines' };
    expect(formatOutput(input, config, false)).toBe('red\nplain');
  });

  it('should strip OSC-8 hyperlink sequences from tool output', () => {
    const input = '\x1b]8;;http://example.com\x1b\\link\x1b]8;;\x1b\\';
    const config: ToolConfig = { mode: 'lines' };
    expect(formatOutput(input, config, false)).toBe('link');
  });

  it('should remove control characters but keep tab/newline', () => {
    const input = 'a\x00b\x1fc\td\ne\rf';
    const config: ToolConfig = { mode: 'lines' };
    // \x00 / \x1f (制御文字) と \r は除去、\t と \n は保持
    expect(formatOutput(input, config, false)).toBe('abc\td\nef');
  });
});
