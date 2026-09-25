import { expect, test } from '@playwright/test';
import { pickedProjects, serverlessRun } from '@/lib/cli-args';

// 🔴 The parser that decides whether Playwright starts a web server.
//
// Its first version read only the argument after `--project`, so
// `--project unit tablet` looked like a unit-only run and 177 browser
// tests ran against nothing. It lived in the config file, which is
// exactly why nobody could test it.

const SERVERLESS = new Set(['unit']);
const argv = (s: string) => ['node', 'playwright', 'test', ...s.split(' ')];

test.describe('pickedProjects', () => {
  test('--project=a', () => {
    expect(pickedProjects(argv('--project=unit'))).toEqual(['unit']);
  });

  test('--project a', () => {
    expect(pickedProjects(argv('--project unit'))).toEqual(['unit']);
  });

  test('🔴 --project is variadic: a b c all count', () => {
    // The regression. Playwright declares `--project <project-name...>`,
    // and `--project unit tablet` really does select both.
    expect(pickedProjects(argv('--project unit tablet'))).toEqual([
      'unit',
      'tablet',
    ]);
  });

  test('repeated flags accumulate', () => {
    expect(pickedProjects(argv('--project=unit --project=tablet'))).toEqual([
      'unit',
      'tablet',
    ]);
  });

  test('a following flag ends the list', () => {
    expect(pickedProjects(argv('--project unit --ui'))).toEqual(['unit']);
    expect(pickedProjects(argv('--project unit --reporter=line'))).toEqual([
      'unit',
    ]);
  });

  test('no --project selects nothing', () => {
    expect(pickedProjects(argv('tests/unit/search.spec.ts'))).toEqual([]);
  });
});

test.describe('serverlessRun', () => {
  test('a unit-only run needs no server', () => {
    expect(serverlessRun(argv('--project unit'), SERVERLESS)).toBe(true);
    expect(serverlessRun(argv('--project=unit'), SERVERLESS)).toBe(true);
  });

  test('🔴 one browser project among them and the server starts', () => {
    for (const cmd of [
      '--project unit tablet',
      '--project=unit --project=tablet',
      '--project tablet',
      '--project unit chromium-desktop',
    ]) {
      expect(serverlessRun(argv(cmd), SERVERLESS), cmd).toBe(false);
    }
  });

  test('🔴 no selection at all starts the server', () => {
    // A plain `playwright test` runs everything, including e2e.
    expect(serverlessRun(argv('tests/unit/x.spec.ts'), SERVERLESS)).toBe(false);
    expect(serverlessRun(['node', 'playwright', 'test'], SERVERLESS)).toBe(
      false,
    );
  });

  test('an unknown project name starts the server', () => {
    // Conservative by design: a name we do not recognise might need one.
    expect(serverlessRun(argv('--project=visual'), SERVERLESS)).toBe(false);
  });
});
