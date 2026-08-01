import { readdir } from 'node:fs/promises';

const directory = new URL('./', import.meta.url);

const testFiles = (await readdir(directory))
  .filter((file) => file.endsWith('.test.ts'))
  .sort();

for (const file of testFiles) {
  await import(new URL(file, directory).href);
}
